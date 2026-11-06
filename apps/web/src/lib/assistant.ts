/**
 * AI Assistant 처리 흐름
 *
 *   사용자 문장 → 해석(AI 연결부 또는 규칙 기반 해석기) → JSON 명령(작업) → 검증
 *   → 미리보기(작업 ID·단계) → 사용자가 [실행] → 편집 명령 실행(Undo 1회 단위) → 결과 표시
 *
 * AI는 코드를 실행하지 않고 commands.json 에 정의된 명령만 만들 수 있습니다.
 * AI가 연결되지 않았으면 그렇다고 표시하고, 규칙 기반 해석기(AI 아님)만 사용합니다.
 */
import { buildSceneSummary, executeJob, makeJob, parseRules, validateJob } from '@form3d/editor-core';
import type { CommandJob, JobResult, ViewPreset } from '@form3d/model-types';
import { engine } from '../state/engine';
import { useAppStore } from '../state/appStore';
import { newConversationId, useAssistantStore, type AiMeta } from '../state/assistantStore';
import { useProjectStore } from '../state/projectStore';
import { ApiError, api, type AiPlanResponse } from './api';
import { undo } from './actions';

const st = () => useAssistantStore.getState();
const app = () => useAppStore.getState();

export function aiAvailable(): boolean {
  const p = useProjectStore.getState();
  return p.server === 'online' && !!p.health?.ai.configured;
}

/** 가장 최근 작업에서 새로 만든 오브젝트 ("그거", "방금 만든 것" 이해용) */
let recentlyCreated: { id: string; name: string }[] = [];

export function sceneSummary() {
  const s = buildSceneSummary(engine, app().projectName);
  const alive = recentlyCreated.filter((c) => {
    const o = engine.getObject(c.id);
    return !!o && engine.isInScene(o);
  });
  return alive.length ? { ...s, recentlyCreated: alive } : s;
}

/** 진행 중인 AI 요청 취소 */
let aborter: AbortController | null = null;
export function cancelThinking(): void {
  aborter?.abort();
}

function objectNames(): string[] {
  const names = new Set<string>();
  engine.root.traverse((o) => {
    if (o !== engine.root && o.name) names.add(o.name);
  });
  return [...names];
}

/** 대화창 입력 처리 */
export async function submitRequest(text: string): Promise<void> {
  const t = text.trim();
  if (!t || st().thinking) return;
  st().add({ kind: 'user', text: t });
  const useAi = st().mode === 'ai' && aiAvailable();
  if (useAi) await planWithAi(t);
  else planWithRules(t);
}

function planWithRules(text: string): void {
  const { steps, errors } = parseRules(text, { names: objectNames() });
  if (errors.length || !steps.length) {
    st().add({
      kind: 'note',
      level: 'warn',
      text: '기본 명령 해석기가 이 문장을 이해하지 못해 아무것도 실행하지 않았습니다.',
      details: [...errors, '예: "큐브 하나 만들어 줘", "선택한 오브젝트를 오른쪽으로 3만큼 이동해 줘", "모두 선택해 줘"'],
    });
    return;
  }
  const job = makeJob(steps, 'rules', text);
  const invalid = validateJob(job);
  st().add({ kind: 'job', job, by: '규칙 기반 해석기', state: invalid.length ? 'invalid' : 'pending', errors: invalid });
}

const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', dashscope: 'Qwen API', ollama: 'Ollama', test: '테스트' };

function metaOf(plan: AiPlanResponse): AiMeta {
  return {
    provider: plan.provider,
    model: plan.model,
    paid: plan.paid,
    costUsd: plan.usage?.estimatedCostUsd ?? null,
    tokens: (plan.usage?.inputTokens ?? 0) + (plan.usage?.outputTokens ?? 0),
    latencyMs: plan.latencyMs ?? 0,
    fallbackFrom: (plan.fallbackFrom ?? []).map((f) => `${PROVIDER_NAMES[f.provider] ?? f.provider}: ${f.error}`),
  };
}

export function metaLabel(m: AiMeta): string {
  const cost = m.paid ? (m.costUsd != null ? ` · 예상 $${m.costUsd < 0.01 ? m.costUsd.toFixed(4) : m.costUsd.toFixed(2)}` : '') : ' · 무료';
  return `${PROVIDER_NAMES[m.provider] ?? m.provider} · ${m.model}${m.tokens ? ` · ${m.tokens.toLocaleString()} 토큰` : ''}${cost}${m.latencyMs ? ` · ${(m.latencyMs / 1000).toFixed(1)}초` : ''}`;
}

async function planWithAi(text: string): Promise<void> {
  st().set({ thinking: true, thinkingSince: Date.now() });
  aborter = new AbortController();
  try {
    const plan = await api.aiPlan(text, sceneSummary(), st().conversation, aborter.signal);
    const meta = metaOf(plan);
    if (meta.fallbackFrom?.length) {
      st().add({ kind: 'note', level: 'warn', text: `기본 모델 연결에 실패해 ${PROVIDER_NAMES[plan.provider] ?? plan.provider}(${plan.model})로 대신 처리했습니다.`, details: meta.fallbackFrom });
    }
    if (plan.status === 'reject') {
      st().add({ kind: 'note', level: 'warn', text: `할 수 없는 요청입니다: ${plan.reason || plan.message}`, meta });
      return;
    }
    if (plan.status === 'question') {
      st().add({ kind: 'note', level: 'info', text: plan.message || '조금 더 알려 주세요.', options: plan.options, meta });
      return;
    }
    if (plan.status === 'answer') {
      st().add({ kind: 'note', level: 'info', text: plan.message, meta });
      return;
    }
    const job: CommandJob = { id: plan.jobId, source: 'ai', request: text, summary: plan.summary || plan.message || undefined, steps: plan.steps };
    const errors = plan.status === 'invalid' ? [plan.reason, ...validateJob(job)] : validateJob(job);
    const say = plan.message && plan.message !== job.summary ? plan.message : undefined;
    st().add({ kind: 'job', job, by: plan.model, state: errors.length ? 'invalid' : 'pending', errors, meta, say });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'cancelled') {
      st().add({ kind: 'note', level: 'info', text: 'AI 요청을 취소했습니다. (이미 보낸 요청의 비용은 청구될 수 있습니다)' });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const hint = e instanceof ApiError ? e.hint : '';
    st().add({
      kind: 'note',
      level: 'error',
      text: `AI 요청 실패: ${msg}`,
      details: [...(hint ? [`해결 방법: ${hint}`] : []), '상단 "AI 설정"에서 연결 상태를 확인하거나, 위쪽 "규칙 기반"으로 AI 없이 기본 명령을 쓸 수 있습니다.'],
    });
    if (e instanceof ApiError && e.offline) useProjectStore.getState().set({ server: 'offline' });
  } finally {
    aborter = null;
    st().set({ thinking: false });
  }
}

/** 실행 결과를 AI 대화 맥락에 남김 (다음 요청에서 "그거", "방금 만든 것" 등을 이해하도록) */
function feedback(entryJob: CommandJob, note: string): void {
  if (entryJob.source !== 'ai' || !aiAvailable()) return;
  void api.aiFeedback(st().conversation, `작업 ${entryJob.id}: ${note}`).catch(() => undefined);
}

/** 새 대화 (이전 맥락 지우기) */
export function newConversation(): void {
  const old = st().conversation;
  st().set({ conversation: newConversationId() });
  st().clear();
  if (aiAvailable()) void api.aiClearConversation(old).catch(() => undefined);
}

/** 실패한 작업 → AI에게 수정 계획 요청 */
export function askFix(entryId: number): void {
  const entry = findJobEntry(entryId);
  if (!entry?.result) return;
  void submitRequest(`직전 작업(${entry.job.id})이 실패했습니다: ${entry.result.message}. 원인을 고려해 수정된 계획을 제안해 주세요.`);
}

// ------------------------------------------------------------ 실행 · 취소

/** 외부(온이) 작업의 결과를 기다리는 쪽 */
const waiters = new Map<string, (r: { result?: JobResult; cancelled?: boolean }) => void>();

export function waitForJob(jobId: string): Promise<{ result?: JobResult; cancelled?: boolean }> {
  return new Promise((resolve) => waiters.set(jobId, resolve));
}

function findJobEntry(entryId: number) {
  const e = st().entries.find((x) => x.id === entryId);
  return e && e.kind === 'job' ? e : null;
}

export function executeEntry(entryId: number): JobResult | null {
  const entry = findJobEntry(entryId);
  if (!entry || entry.state !== 'pending') return null;
  st().update(entryId, { state: 'running' });
  const result = executeJob(engine, entry.job, {
    setView: (preset: ViewPreset) => app().requestView(preset),
    frame: () => app().requestFrame(),
  });
  const state = result.status === 'success' ? 'done' : result.status === 'invalid' ? 'invalid' : 'failed';
  st().update(entryId, { state, result });
  const who = entry.job.source === 'external' ? '외부 AI' : entry.job.source === 'ai' ? 'AI' : '명령';
  app().log(state === 'done' ? 'success' : 'error', `${who} 작업 ${entry.job.id}: ${result.message}`);
  waiters.get(entry.job.id)?.({ result });
  waiters.delete(entry.job.id);
  if (state === 'done' && result.created.length) recentlyCreated = result.created.map((c) => ({ id: c.id, name: c.name }));
  feedback(entry.job, `${state === 'done' ? '성공' : '실패'} — ${result.message}${result.created.length ? ` (만든 것: ${result.created.map((c) => `${c.name}(id ${c.id})`).join(', ')})` : ''}`);
  return result;
}

export function cancelEntry(entryId: number): void {
  const entry = findJobEntry(entryId);
  if (!entry || entry.state !== 'pending') return;
  st().update(entryId, { state: 'cancelled' });
  feedback(entry.job, '사용자가 실행하지 않고 취소함');
  waiters.get(entry.job.id)?.({ cancelled: true });
  waiters.delete(entry.job.id);
}

/** 이 작업이 실행 취소 목록의 맨 위에 있으면 되돌릴 수 있음 */
export function canUndoJob(jobId: string): boolean {
  const top = engine.history.undoRecords.at(-1)?.command;
  return !!top && top.name === 'CommandJob' && top.label.startsWith(`작업 ${jobId}`);
}

export function undoJob(jobId: string): void {
  if (!canUndoJob(jobId)) return;
  undo();
}
