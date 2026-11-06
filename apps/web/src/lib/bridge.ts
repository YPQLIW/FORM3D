/**
 * 외부 AI(온이) 연결 통로 — 편집기 쪽.
 *
 * 로컬 서버의 /api/v1 으로 들어온 요청을 서버가 이 WebSocket으로 전달합니다.
 * 편집기는 설정한 정책(거부 / 확인 후 실행 / 자동 실행)에 따라 처리하고 결과를 돌려줍니다.
 * 명령은 다시 한 번 검증하며, 실행은 다른 편집과 똑같이 실행 취소할 수 있습니다.
 */
import { validateJob } from '@form3d/editor-core';
import type { CommandJob } from '@form3d/model-types';
import { APP_VERSION } from '@form3d/shared';
import { engine } from '../state/engine';
import { useAppStore } from '../state/appStore';
import { useAssistantStore, type ExternalPolicy } from '../state/assistantStore';
import { useProjectStore } from '../state/projectStore';
import { executeEntry, sceneSummary, waitForJob } from './assistant';
import { isProjectDirty } from './project';

let ws: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;

type Reply = { ok: true; data: unknown } | { ok: false; error: { status: number; code: string; message: string } };

const fail = (status: number, code: string, message: string): Reply => ({ ok: false, error: { status, code, message } });

async function handle(kind: string, msg: Record<string, unknown>): Promise<Reply> {
  const app = useAppStore.getState();
  if (kind === 'get_scene') return { ok: true, data: sceneSummary() };
  if (kind === 'get_project') {
    const p = useProjectStore.getState();
    return {
      ok: true,
      data: {
        app: 'FORM3D',
        version: APP_VERSION,
        projectId: p.projectId,
        name: app.projectName,
        dirty: isProjectDirty(),
        objectCount: engine.root.children.length,
        selection: engine.getSelectedObjects().map((o) => ({ id: o.uuid, name: o.name })),
        lastSavedAt: p.lastSavedAt ? new Date(p.lastSavedAt).toISOString() : null,
        canUndo: engine.history.canUndo,
        canRedo: engine.history.canRedo,
      },
    };
  }
  if (kind === 'run_job') {
    const job = msg.job as CommandJob;
    const client = String(msg.client ?? 'external');
    const policy = useAssistantStore.getState().externalPolicy;
    if (policy === 'deny') return fail(403, 'rejected_by_policy', '편집기 설정에서 외부 AI 명령이 꺼져 있습니다');
    if (!job || job.source !== 'external') return fail(400, 'invalid_job', '외부 작업 형식이 아닙니다');
    const errors = validateJob(job);
    const st = useAssistantStore.getState();
    if (errors.length) {
      st.add({ kind: 'job', job, by: client, state: 'invalid', errors });
      return fail(422, 'invalid_job', errors.join('; '));
    }
    const entryId = st.add({ kind: 'job', job, by: client, state: 'pending' });
    app.log('info', `외부 AI(${client})가 작업 ${job.id}를 보냈습니다 (${job.steps.length}단계)`);
    if (policy === 'auto') {
      const result = executeEntry(entryId);
      return { ok: true, data: result };
    }
    app.setBottomTab('ai');
    const outcome = await waitForJob(job.id);
    if (outcome.cancelled) return fail(409, 'cancelled', '사용자가 편집기에서 작업을 취소했습니다');
    return { ok: true, data: outcome.result };
  }
  return fail(400, 'unknown_request', `알 수 없는 요청: ${kind}`);
}

function send(data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

export function sendPolicy(policy: ExternalPolicy) {
  send({ type: 'policy', policy });
}

function connect() {
  if (ws || useProjectStore.getState().server !== 'online') return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/api/bridge`);
  ws = socket;
  socket.onopen = () => {
    backoff = 1000;
    useAssistantStore.getState().set({ bridgeConnected: true });
    send({ type: 'hello', app: 'FORM3D', version: APP_VERSION, policy: useAssistantStore.getState().externalPolicy });
  };
  socket.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type !== 'request') return;
    void handle(String(msg.kind), msg)
      .catch((e): Reply => fail(500, 'editor_error', e instanceof Error ? e.message : String(e)))
      .then((reply) => send({ type: 'response', reqId: msg.reqId, ...reply }));
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    useAssistantStore.getState().set({ bridgeConnected: false });
    schedule();
  };
  socket.onerror = () => socket.close();
}

function schedule() {
  if (retry) return;
  retry = setTimeout(() => {
    retry = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 30000);
}

let started = false;
export function startBridge(): void {
  if (started) return;
  started = true;
  // 서버가 켜질 때 연결, 정책이 바뀌면 서버에 알림
  useProjectStore.subscribe((s, prev) => {
    if (s.server === 'online' && prev.server !== 'online') connect();
  });
  useAssistantStore.subscribe((s, prev) => {
    if (s.externalPolicy !== prev.externalPolicy) sendPolicy(s.externalPolicy);
  });
  connect();
}
