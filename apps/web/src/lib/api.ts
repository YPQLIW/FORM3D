/**
 * 로컬 서버(backend) 호출. 서버는 이 컴퓨터(127.0.0.1:8765)에서만 동작하며 Vite가 /api 로 연결해 줍니다.
 * API 키 등 비밀 값은 서버에만 있고, 이 파일은 키를 다루지 않습니다.
 */
import type { CommandStep, SceneSummary } from '@form3d/model-types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errors: string[] = [],
    public hint = '',
  ) {
    super(message);
  }
  /** 서버가 꺼져 있거나 연결할 수 없음 */
  get offline(): boolean {
    return this.code === 'server_offline';
  }
}

export interface ServerHealth {
  ok: boolean;
  version: string;
  dataDir: string;
  ai: AiActive;
  externalApi: {
    base: string;
    tokenFile: string;
    editorConnected: boolean;
    policy: string;
    scopes: Record<string, string>;
  };
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  openedAt: string;
  size: number;
  objects: number;
  triangles: number;
  hasThumbnail: boolean;
}

export interface VersionMeta {
  id: string;
  size: number;
  savedAt: string;
}

export interface AiActive {
  configured: boolean;
  provider: string | null;
  model: string | null;
  label?: string;
  paid?: boolean;
  local?: boolean;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface AiPlanResponse {
  jobId: string;
  status: 'plan' | 'reject' | 'invalid' | 'question' | 'answer';
  summary: string;
  reason: string;
  message: string;
  options: string[];
  steps: CommandStep[];
  provider: string;
  model: string;
  paid: boolean;
  usage: AiUsage;
  latencyMs: number;
  fallbackFrom: { provider: string; model: string; error: string }[];
}

export type ProviderId = 'claude' | 'dashscope' | 'ollama';
export interface ModelSel {
  provider: ProviderId;
  model: string;
}
export interface ModelInfo {
  id: string;
  label: string;
  size: number | null;
  note: string;
}
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  paid: boolean;
  local: boolean;
  state: 'ready' | 'no_key' | 'offline' | 'error' | 'unknown';
  message: string;
  hint: string;
  model: string;
  key?: { set: boolean; masked: string | null; source: 'settings' | 'env' | null };
  region?: string;
  regions?: Record<string, string>;
  url?: string;
  recommended?: ModelInfo[];
}
export interface AiSettings {
  default: ModelSel;
  tasks: { assistant: ModelSel | null; oni: ModelSel | null };
  fallback: { enabled: boolean; order: ProviderId[] };
  providers: {
    claude: { model: string };
    dashscope: { model: string; region: string };
    ollama: { model: string; url: string };
  };
  params: { temperature: number; max_tokens: number; timeout: number; history: number };
  prices: Record<string, { in: number; out: number }>;
}
export interface EngineInfo {
  id: string;
  kind: string;
  name: string;
  status: string;
  available: boolean;
  phase: string;
  backends: string[];
  note: string;
}
export interface AiStatus {
  providers: ProviderInfo[];
  default: ModelSel;
  available: boolean;
  settings: AiSettings;
  engines: EngineInfo[];
  active: AiActive;
  test?: boolean;
}
export interface TestResult {
  ok: boolean;
  provider: string;
  model: string | null;
  latencyMs?: number;
  formatOk?: boolean;
  reply?: string;
  usage?: AiUsage;
  code?: string;
  error?: string;
  hint?: string;
}
export interface UsageRow {
  provider: string;
  model: string;
  requests: number;
  succeeded: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  unpricedRequests: number;
  avgLatencyMs: number;
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 60000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init.signal;
  const onOuter = () => ctrl.abort();
  outer?.addEventListener('abort', onOuter);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError' && outer?.aborted) throw new ApiError(0, 'cancelled', '사용자가 요청을 취소했습니다');
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'timeout', '서버 응답 시간이 초과되었습니다');
    throw new ApiError(0, 'server_offline', '로컬 서버에 연결할 수 없습니다');
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
  if (res.ok) return res;
  let detail: { code?: string; message?: string; errors?: string[]; hint?: string } | null = null;
  try {
    const body = await res.json();
    detail = typeof body?.detail === 'object' ? body.detail : null;
  } catch {
    /* JSON이 아님 → 프록시 오류(서버 꺼짐) */
  }
  if (!detail) {
    if (res.status >= 500) throw new ApiError(res.status, 'server_offline', '로컬 서버에 연결할 수 없습니다');
    throw new ApiError(res.status, 'http_error', `서버 오류 (${res.status})`);
  }
  throw new ApiError(res.status, detail.code ?? 'error', detail.message ?? '요청 실패', detail.errors ?? [], detail.hint ?? '');
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});
const json = async <T>(p: Promise<Response>) => (await p).json() as Promise<T>;
const bytes = async (p: Promise<Response>) => new Uint8Array(await (await p).arrayBuffer());
const octet = (data: Uint8Array): RequestInit => ({
  body: data as BodyInit,
  headers: { 'Content-Type': 'application/octet-stream' },
});
const q = (name?: string) => (name ? `?name=${encodeURIComponent(name)}` : '');

export const api = {
  health: async () => {
    const h = await json<ServerHealth & { offline?: boolean }>(request('/health', {}, 4000));
    if (!h.ok) throw new ApiError(0, 'server_offline', '로컬 서버가 꺼져 있습니다');
    return h as ServerHealth;
  },
  listProjects: () => json<{ projects: ProjectMeta[] }>(request('/projects')).then((r) => r.projects),
  createProject: (data: Uint8Array, name?: string) =>
    json<ProjectMeta>(request(`/projects${q(name)}`, { method: 'POST', ...octet(data) }, 300000)),
  saveProject: (id: string, data: Uint8Array, name?: string) =>
    json<ProjectMeta>(request(`/projects/${id}${q(name)}`, { method: 'PUT', ...octet(data) }, 300000)),
  renameProject: (id: string, name: string) =>
    json<ProjectMeta>(
      request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } }),
    ),
  readProject: (id: string) => bytes(request(`/projects/${id}/file`, {}, 300000)),
  versions: (id: string) => json<{ versions: VersionMeta[] }>(request(`/projects/${id}/versions`)).then((r) => r.versions),
  readVersion: (id: string, vid: string) => bytes(request(`/projects/${id}/versions/${vid}`, {}, 300000)),
  thumbnailUrl: (p: ProjectMeta) => `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.updatedAt)}`,
  aiPlan: (text: string, scene: SceneSummary, conversation?: string, signal?: AbortSignal) =>
    json<AiPlanResponse>(request('/ai/plan', { ...jsonBody('POST', { text, scene, conversation }), signal }, 700000)),
  aiStatus: () => json<AiStatus>(request('/ai/status', {}, 15000)),
  aiSaveSettings: (patch: Partial<AiSettings>) =>
    json<{ settings: AiSettings }>(request('/ai/settings', jsonBody('PUT', patch))).then((r) => r.settings),
  aiSetKey: (pid: ProviderId, key: string) => json<ProviderInfo>(request(`/ai/keys/${pid}`, jsonBody('PUT', { key }))),
  aiDeleteKey: (pid: ProviderId) => json<ProviderInfo>(request(`/ai/keys/${pid}`, { method: 'DELETE' })),
  aiModels: (pid: ProviderId) =>
    json<{ models: ModelInfo[]; error?: string }>(request(`/ai/providers/${pid}/models`, {}, 20000)).then((r) => {
      if (r.error) throw new ApiError(503, 'models_unavailable', r.error);
      return r.models;
    }),
  aiTest: (pid: ProviderId, model?: string) =>
    json<TestResult>(request(`/ai/providers/${pid}/test`, jsonBody('POST', { model: model || null }), 700000)),
  aiUsage: (days = 30) => json<{ rows: UsageRow[]; note: string }>(request(`/ai/usage?days=${days}`)),
  aiFeedback: (conversation: string, note: string) =>
    request('/ai/feedback', jsonBody('POST', { conversation, note })).then(() => undefined),
  aiClearConversation: (conversation: string) =>
    request(`/ai/conversations/${encodeURIComponent(conversation)}`, { method: 'DELETE' }).then(() => undefined),
  /** Ollama 모델 내려받기 (진행률 콜백). signal 로 취소 */
  ollamaPull: async (model: string, onProgress: (p: { status: string; total?: number; completed?: number }) => void, signal: AbortSignal) => {
    const res = await fetch('/api/ai/ollama/pull', { ...jsonBody('POST', { model }), signal });
    if (!res.ok || !res.body) throw new ApiError(res.status, 'pull_failed', '내려받기를 시작할 수 없습니다');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.status === 'error') throw new ApiError(502, 'pull_failed', ev.error, [], ev.hint ?? '');
        onProgress(ev);
      }
    }
  },
};
