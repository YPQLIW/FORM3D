import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, CircleSlash, Cpu, Loader2, MessageSquarePlus, Plug, Send, Settings, Undo2, User, Wrench, X } from 'lucide-react';
import { loadAiStatus, openAiSettings, saveAiSettings } from '../../lib/aiSettings';
import { useAiSettings } from '../../state/aiSettingsStore';
import { describeStep } from '@form3d/editor-core';
import { useAssistantStore, type AssistantEntry, type ExternalPolicy } from '../../state/assistantStore';
import { useProjectStore } from '../../state/projectStore';
import { useEngineRevision } from '../../state/engine';
import { aiAvailable, askFix, cancelThinking, restoreConversation, canUndoJob, cancelEntry, executeEntry, metaLabel, newConversation, submitRequest, undoJob } from '../../lib/assistant';
import { Button } from '../ui/Button';

type JobEntry = Extract<AssistantEntry, { kind: 'job' }>;

const STATE_LABEL: Record<JobEntry['state'], [string, string]> = {
  pending: ['실행 대기', 'text-amber-300'],
  running: ['실행 중', 'text-accent'],
  done: ['완료', 'text-emerald-400'],
  failed: ['실패 (전체 취소됨)', 'text-red-400'],
  cancelled: ['취소함', 'text-muted'],
  invalid: ['검증 실패 · 실행 안 함', 'text-red-400'],
};

function Elapsed() {
  const since = useAssistantStore((s) => s.thinkingSince);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.round((now - since) / 1000));
  return <span data-testid="thinking-elapsed">{sec}초</span>;
}

function SourceBadge({ e }: { e: JobEntry }) {
  const src = e.job.source;
  const [label, cls] =
    src === 'ai'
      ? [`AI · ${e.by ?? ''}`, 'border-accent-2/50 text-violet-300']
      : src === 'external'
        ? [`외부 AI · ${e.by ?? ''}`, 'border-sky-500/50 text-sky-300']
        : ['규칙 기반 해석기 · AI 아님', 'border-line text-muted'];
  return <span className={`rounded border px-1.5 py-px text-[10px] ${cls}`}>{label}</span>;
}

function JobCard({ e }: { e: JobEntry }) {
  useEngineRevision();
  const [showJson, setShowJson] = useState(false);
  const [label, cls] = STATE_LABEL[e.state];
  const stepResults = e.result?.steps ?? [];
  return (
    <div className="max-w-2xl rounded-md border border-line bg-panel-2 text-[11px]" data-testid="job-card" data-job-id={e.job.id} data-state={e.state}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="font-mono text-[10px] text-muted">{e.job.id}</span>
        <SourceBadge e={e} />
        <span className={`ml-auto font-medium ${cls}`} data-testid="job-state">
          {label}
        </span>
      </div>
      <div className="space-y-1.5 px-3 py-2">
        {e.say && (
          <p className="text-[12px] text-violet-200 select-text" data-testid="job-say">
            {e.say}
          </p>
        )}
        {(e.job.summary || e.job.request) && <p className="text-text">{e.job.summary || e.job.request}</p>}
        {e.meta && <p className="text-[10px] text-muted" data-testid="job-meta">{metaLabel(e.meta)}</p>}
        <ol className="space-y-0.5">
          {e.job.steps.map((s, i) => {
            const r = stepResults.find((x) => x.index === i);
            return (
              <li key={i} className="flex gap-2" data-testid="job-step">
                <span className="w-4 shrink-0 text-right text-muted">{i + 1}.</span>
                <span className="flex-1">
                  {describeStep(s)} <span className="font-mono text-[10px] text-muted">({s.command})</span>
                  {r && (
                    <span className={`ml-1.5 ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.ok ? '✓' : '✗'} {r.message}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {e.errors && e.errors.length > 0 && (
          <ul className="space-y-0.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-300" data-testid="job-errors">
            {e.errors.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
        {e.result && e.state !== 'done' && <p className="text-red-300">{e.result.message}</p>}
        {e.result && e.state === 'done' && (
          <p className="text-emerald-300">
            {e.result.message}
            {e.result.created.length > 0 && ` · 새로 만든 오브젝트: ${e.result.created.map((c) => c.name).join(', ')}`}
          </p>
        )}
        {showJson && (
          <pre className="max-h-40 overflow-auto rounded bg-bg p-2 font-mono text-[10px] text-muted select-text">
            {JSON.stringify(e.job, null, 2)}
          </pre>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
        <button type="button" className="text-[10px] text-muted hover:text-text" onClick={() => setShowJson(!showJson)}>
          {showJson ? 'JSON 닫기' : 'JSON 보기'}
        </button>
        <div className="flex-1" />
        {e.state === 'pending' && (
          <>
            <Button variant="ghost" icon={<X size={12} />} onClick={() => cancelEntry(e.id)} data-testid="job-cancel">
              취소
            </Button>
            <Button variant="primary" icon={<Check size={12} />} onClick={() => executeEntry(e.id)} data-testid="job-run">
              실행
            </Button>
          </>
        )}
        {e.state === 'failed' && e.job.source === 'ai' && aiAvailable() && (
          <Button variant="subtle" icon={<Wrench size={12} />} onClick={() => askFix(e.id)} data-testid="job-fix">
            AI에게 수정 요청
          </Button>
        )}
        {e.state === 'done' && canUndoJob(e.job.id) && (
          <Button variant="subtle" icon={<Undo2 size={12} />} onClick={() => undoJob(e.job.id)} data-testid="job-undo">
            이 작업 실행 취소
          </Button>
        )}
      </div>
    </div>
  );
}

function EntryView({ e }: { e: AssistantEntry }) {
  if (e.kind === 'user')
    return (
      <div className="flex gap-2" data-entry="">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10">
          <User size={12} />
        </div>
        <p className="pt-1 text-[12px] text-white select-text" data-testid="user-message">
          {e.text}
        </p>
      </div>
    );
  const icon = (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2">
      <Bot size={13} className="text-white" />
    </div>
  );
  if (e.kind === 'note')
    return (
      <div className="flex gap-2" data-entry="">
        {icon}
        <div
          className={`max-w-2xl rounded-md border px-3 py-1.5 text-[11px] leading-relaxed ${e.level === 'error' ? 'border-red-500/40 text-red-300' : e.level === 'warn' ? 'border-amber-500/40 text-amber-200' : 'border-line text-text'}`}
          data-testid="assistant-note"
        >
          {e.text}
          {e.details && (
            <ul className="mt-0.5 list-disc pl-4 text-muted">
              {e.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {e.options && e.options.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1" data-testid="question-options">
              {e.options.map((o) => (
                <button key={o} type="button" onClick={() => void submitRequest(o)}
                  className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] text-white hover:bg-accent/30">
                  {o}
                </button>
              ))}
            </div>
          )}
          {e.meta && <p className="mt-1 text-[10px] text-muted">{metaLabel(e.meta)}</p>}
        </div>
      </div>
    );
  return (
    <div className="flex gap-2" data-entry="">
      {icon}
      <JobCard e={e} />
    </div>
  );
}

const POLICY_LABEL: Record<ExternalPolicy, string> = { deny: '거부', confirm: '확인 후 실행', auto: '자동 실행' };

function ExternalSettings() {
  const [open, setOpen] = useState(false);
  const policy = useAssistantStore((s) => s.externalPolicy);
  const connected = useAssistantStore((s) => s.bridgeConnected);
  const set = useAssistantStore((s) => s.set);
  const health = useProjectStore((s) => s.health);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-testid="external-settings"
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-white/5 hover:text-text"
      >
        <Plug size={11} className={connected ? 'text-emerald-400' : ''} /> 외부 AI(온이): {POLICY_LABEL[policy]}
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-50 w-80 space-y-2 rounded-md border border-line bg-panel-2 p-3 text-[11px] shadow-xl">
          <p className="font-semibold text-white">외부 AI 연결 (온이 등)</p>
          <p className="text-muted">
            상태:{' '}
            {connected ? (
              <span className="text-emerald-400">이 편집기가 로컬 서버에 연결됨 — 외부 명령을 받을 수 있음</span>
            ) : (
              <span className="text-amber-300">연결 안 됨 (로컬 서버 필요)</span>
            )}
          </p>
          <div>
            <p className="mb-1 text-muted">외부에서 온 명령 처리 방법</p>
            <div className="flex gap-1">
              {(['deny', 'confirm', 'auto'] as ExternalPolicy[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  data-testid={`policy-${p}`}
                  onClick={() => set({ externalPolicy: p })}
                  className={`flex-1 rounded border px-1 py-1 ${policy === p ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted hover:text-text'}`}
                >
                  {POLICY_LABEL[p]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              확인 후 실행: 여기 대화창에 명령 미리보기가 뜨고, [실행]을 눌러야 적용됩니다. 자동 실행: 바로 적용(실행 취소 가능).
            </p>
          </div>
          {health && (
            <div className="space-y-0.5 rounded bg-bg p-2 font-mono text-[10px] text-muted select-text">
              <div>주소: {health.externalApi.base}</div>
              <div className="break-all">토큰 파일: {health.externalApi.tokenFile}</div>
            </div>
          )}
          <p className="text-[10px] text-muted">이 컴퓨터 안에서만 접근할 수 있고, 토큰과 권한(scope)이 필요합니다.</p>
        </div>
      )}
    </div>
  );
}

const PNAME: Record<string, string> = { claude: 'Claude', dashscope: 'Qwen API', ollama: 'Ollama' };

/** Assistant에서 바로 AI 모델 바꾸기 (연결된 것만 표시) */
function ModelSwitch() {
  const status = useAiSettings((s) => s.status);
  const health = useProjectStore((s) => s.health);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = (status?.providers ?? []).filter((p) => p.state === 'ready');
  if (!status || ready.length === 0) return null;
  const current = health?.ai.configured ? health.ai.provider ?? '' : '';
  return (
    <label className="flex items-center gap-1 text-[10px] text-muted" title={err ?? 'AI Assistant가 쓸 모델'}>
      모델
      <select
        data-testid="model-switch"
        aria-label="AI 모델 전환"
        disabled={busy}
        value={current}
        onChange={async (e) => {
          const p = ready.find((x) => x.id === e.target.value);
          if (!p) return;
          setBusy(true);
          setErr(await saveAiSettings({ default: { provider: p.id, model: p.model || '' }, tasks: { ...status.settings.tasks, assistant: null } }));
          setBusy(false);
        }}
        className="rounded border border-line bg-panel-2 px-1 py-0.5 text-[10px] text-text"
      >
        {!current && <option value="">선택</option>}
        {ready.map((p) => (
          <option key={p.id} value={p.id}>
            {PNAME[p.id] ?? p.id}
            {p.model ? ` · ${p.model}` : ''} {p.paid ? '(유료)' : '(무료)'}
          </option>
        ))}
      </select>
      {err && <span className="text-red-400">{err}</span>}
    </label>
  );
}

/** AI Assistant: 자연어 → 구조화된 JSON 명령 → 검증 → 미리보기 → 실행 */
export function AssistantPanel() {
  const entries = useAssistantStore((s) => s.entries);
  const mode = useAssistantStore((s) => s.mode);
  const thinking = useAssistantStore((s) => s.thinking);
  const set = useAssistantStore((s) => s.set);
  const server = useProjectStore((s) => s.server);
  const health = useProjectStore((s) => s.health);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const ai = aiAvailable();
  const effective = mode === 'ai' && ai ? 'ai' : 'rules';

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [entries.length, entries.at(-1)]);
  useEffect(() => {
    if (server === 'online') {
      void restoreConversation();
      void loadAiStatus();
    }
  }, [server]);

  const aiStatus =
    server !== 'online'
      ? 'AI 연결 안 됨 (로컬 서버 꺼짐)'
      : health?.ai.configured
        ? `AI 연결됨 · ${health.ai.label ?? health.ai.provider} · ${health.ai.model}${health.ai.paid ? ' (유료)' : ' (무료·로컬)'}`
        : 'AI 연결 안 됨 — 상단 "AI 설정"에서 Claude·Qwen API·Ollama 중 하나를 연결하세요';

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1">
        <span className="text-[10px] text-muted">해석기</span>
        <div className="flex rounded border border-line text-[10px]">
          <button
            type="button"
            data-testid="mode-ai"
            disabled={!ai}
            title={ai ? 'AI가 문장을 명령으로 바꿉니다' : aiStatus}
            onClick={() => set({ mode: 'ai' })}
            className={`flex items-center gap-1 px-2 py-0.5 disabled:opacity-40 ${effective === 'ai' ? 'bg-accent/30 text-white' : 'text-muted'}`}
          >
            <Bot size={11} /> AI
          </button>
          <button
            type="button"
            data-testid="mode-rules"
            onClick={() => set({ mode: 'rules' })}
            className={`flex items-center gap-1 border-l border-line px-2 py-0.5 ${effective === 'rules' ? 'bg-white/10 text-white' : 'text-muted'}`}
          >
            <Cpu size={11} /> 규칙 기반
          </button>
        </div>
        <span className={`text-[10px] ${ai ? 'text-emerald-400' : 'text-muted'}`} data-testid="ai-status">
          {aiStatus}
        </span>
        <ModelSwitch />
        <div className="flex-1" />
        <button type="button" onClick={newConversation} data-testid="new-conversation" title="새 대화 (AI가 이전 대화를 잊음)"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-white/5 hover:text-text">
          <MessageSquarePlus size={11} /> 새 대화
        </button>
        <button type="button" onClick={() => openAiSettings()} title="AI 설정"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-white/5 hover:text-text">
          <Settings size={11} /> AI 설정
        </button>
        <ExternalSettings />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3" data-testid="assistant-log">
        {entries.length === 0 && (
          <div className="flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2">
              <Bot size={13} className="text-white" />
            </div>
            <div className="max-w-2xl rounded-md border border-line px-3 py-2 text-[11px] leading-relaxed text-muted">
              <p className="text-text">
                {effective === 'ai'
                  ? 'AI가 요청을 편집 계획으로 바꿔 미리 보여 드립니다. [실행]을 눌러야 적용됩니다. 모호하면 먼저 되묻고, 이전 대화도 기억합니다.'
                  : '지금은 기본 명령 해석기(규칙 기반 · AI 아님)로 정해진 표현만 이해합니다.'}
              </p>
              <p className="mt-1">
                예: “큐브 하나 만들어 줘” · “선택한 오브젝트를 오른쪽으로 3만큼 이동해 줘” · “모든 오브젝트를 선택해 줘” · “선택한 물체의 색상을
                파란색으로 변경해 줘” · “이 오브젝트를 복제해 줘” · “선택한 물체들을 하나의 그룹으로 묶어 줘”
              </p>
            </div>
          </div>
        )}
        {entries.map((e) => (
          <EntryView key={e.id} e={e} />
        ))}
        {thinking && (
          <div className="flex items-center gap-2 pl-8 text-[11px] text-muted" data-testid="assistant-thinking">
            <Loader2 size={12} className="animate-spin text-accent" /> AI가 생각하는 중… <Elapsed />
            <button type="button" onClick={cancelThinking} data-testid="thinking-cancel"
              className="rounded border border-line px-1.5 py-px text-[10px] hover:bg-white/5 hover:text-text">
              취소
            </button>
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void submitRequest(text);
          setText('');
        }}
      >
        {mode === 'ai' && !ai && (
          <span className="flex items-center gap-1 text-[10px] text-amber-300" title={aiStatus}>
            <AlertTriangle size={11} /> 규칙 기반으로 처리
          </span>
        )}
        {effective === 'rules' && mode === 'rules' && <CircleSlash size={12} className="text-muted" aria-hidden />}
        <input
          aria-label="AI 명령 입력"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder={effective === 'ai' ? '무엇을 할까요? (예: 빨간 구 3개를 만들고 나란히 정렬해 줘)' : '명령 입력 (규칙 기반 해석기)'}
          className="h-7 flex-1 rounded border border-line bg-bg px-2 text-[12px] placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || thinking}
          aria-label="전송"
          className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white disabled:opacity-40"
        >
          <Send size={13} />
        </button>
      </form>
    </div>
  );
}
