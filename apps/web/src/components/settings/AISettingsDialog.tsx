import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cpu, CreditCard, Download, KeyRound, Loader2, Plug, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { formatBytes } from '@form3d/shared';
import { api, type AiSettings, type ModelInfo, type ModelSel, type ProviderId, type ProviderInfo, type SelfTestState, type TestResult, type UsageRow } from '../../lib/api';
import { loadAiStatus, saveAiSettings } from '../../lib/aiSettings';
import { refreshServer } from '../../lib/project';
import { useAiSettings, type SettingsTab } from '../../state/aiSettingsStore';
import { useProjectStore } from '../../state/projectStore';
import { Button } from '../ui/Button';

const TABS: [SettingsTab, string][] = [
  ['providers', 'AI 제공자'],
  ['models', '기본·작업별 모델'],
  ['selftest', '실제 AI 점검'],
  ['usage', '사용량·비용'],
  ['engines', '크리에이티브 엔진'],
  ['oni', '온이 연결'],
];
const STATE: Record<string, [string, string]> = {
  ready: ['bg-emerald-400', '사용 가능'],
  no_key: ['bg-zinc-500', '키 없음'],
  offline: ['bg-amber-400', '꺼짐'],
  error: ['bg-red-400', '오류'],
  unknown: ['bg-zinc-500', '확인 중'],
};
const inputCls = 'h-7 rounded border border-line bg-bg px-2 text-[12px] text-white focus:border-accent focus:outline-none';
const usd = (v: number | null | undefined) => (v == null ? '-' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

export function CostBadge({ paid }: { paid: boolean }) {
  return paid ? (
    <span className="inline-flex items-center gap-1 rounded border border-amber-500/50 px-1.5 py-px text-[10px] text-amber-300">
      <CreditCard size={10} /> 유료 API
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/50 px-1.5 py-px text-[10px] text-emerald-300">
      <Cpu size={10} /> 무료 · 내 PC
    </span>
  );
}

function TestBox({ r }: { r: TestResult | 'running' | null }) {
  if (!r) return null;
  if (r === 'running')
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted">
        <Loader2 size={12} className="animate-spin" /> 테스트 중… (로컬 모델은 처음에 오래 걸릴 수 있음)
      </p>
    );
  return r.ok ? (
    <p className="flex items-center gap-1 text-[11px] text-emerald-300" data-testid="test-result" data-ok="true">
      <CheckCircle2 size={12} /> 연결 성공 · {r.model} · {r.latencyMs}ms
      {r.formatOk === false && <span className="text-amber-300"> · 응답 형식이 불안정함(더 큰 모델 권장)</span>}
      {r.usage?.estimatedCostUsd != null && ` · 예상 비용 ${usd(r.usage.estimatedCostUsd)}`}
    </p>
  ) : (
    <div className="text-[11px] text-red-300" data-testid="test-result" data-ok="false">
      <p className="flex items-center gap-1">
        <XCircle size={12} /> 실패: {r.error}
      </p>
      {r.hint && <p className="pl-4 text-muted">해결 방법: {r.hint}</p>}
    </div>
  );
}

function ModelPicker({ pid, value, onChange }: { pid: ProviderId; value: string; onChange: (m: string) => void }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    api.aiModels(pid).then(setModels, (e) => {
      setModels([]);
      setErr(e.message);
    });
  };
  useEffect(load, [pid]);
  const ids = new Set((models ?? []).map((m) => m.id));
  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={`${pid} 모델`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} min-w-0 flex-1`}
      >
        {!value && <option value="">모델 선택</option>}
        {value && !ids.has(value) && <option value={value}>{value}</option>}
        {(models ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.label || m.id}
            {m.note ? ` — ${m.note}` : ''}
            {m.size ? ` (${formatBytes(m.size)})` : ''}
          </option>
        ))}
      </select>
      <button type="button" title="모델 목록 새로 고침" onClick={load} className="text-muted hover:text-text">
        <RefreshCw size={12} />
      </button>
      {err && <span className="text-[10px] text-red-300">{err}</span>}
    </div>
  );
}

function KeyField({ p, onChanged }: { p: ProviderInfo; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[11px]">
        <KeyRound size={12} className="text-muted" />
        {p.key?.set ? (
          <span>
            등록됨 <span className="font-mono text-muted">{p.key.masked}</span>
            {p.key.source === 'env' && <span className="text-muted"> (backend/.env)</span>}
          </span>
        ) : (
          <span className="text-muted">API 키 없음</span>
        )}
      </div>
      <div className="flex gap-1">
        <input
          type="password"
          autoComplete="off"
          aria-label={`${p.label} API 키`}
          placeholder={p.key?.set ? '새 키로 바꾸기' : 'API 키 붙여넣기'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className={`${inputCls} flex-1`}
        />
        <Button
          variant="subtle"
          disabled={key.trim().length < 8}
          onClick={async () => {
            setMsg(null);
            try {
              await api.aiSetKey(p.id, key.trim());
              setKey('');
              setMsg('저장했습니다 (이 PC의 로컬 서버에만 저장, 화면에는 다시 표시되지 않음)');
              onChanged();
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          저장
        </Button>
        {p.key?.source === 'settings' && (
          <Button
            variant="ghost"
            icon={<Trash2 size={12} />}
            title="키 삭제"
            onClick={async () => {
              await api.aiDeleteKey(p.id);
              setMsg('키를 삭제했습니다');
              onChanged();
            }}
          />
        )}
      </div>
      {msg && <p className="text-[10px] text-muted">{msg}</p>}
    </div>
  );
}

function OllamaPull({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('qwen3:8b');
  const [prog, setProg] = useState<{ status: string; pct: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const start = async () => {
    setErr(null);
    ctrl.current = new AbortController();
    setProg({ status: '시작 중', pct: null });
    try {
      await api.ollamaPull(
        name.trim(),
        (p) => setProg({ status: p.status, pct: p.total ? Math.round(((p.completed ?? 0) / p.total) * 100) : null }),
        ctrl.current.signal,
      );
      setProg({ status: '완료', pct: 100 });
      onDone();
    } catch (e) {
      const ex = e as Error & { hint?: string };
      setErr(ex.name === 'AbortError' ? '취소했습니다' : `${ex.message}${ex.hint ? ` — ${ex.hint}` : ''}`);
      setProg(null);
    } finally {
      ctrl.current = null;
    }
  };
  return (
    <div className="space-y-1 rounded border border-line p-2">
      <p className="text-[11px] text-muted">모델 내려받기 (인터넷 필요, 한 번만 — 이후에는 인터넷 없이 사용)</p>
      <div className="flex gap-1">
        <input aria-label="내려받을 모델" value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} flex-1 font-mono`} />
        {ctrl.current ? (
          <Button variant="ghost" onClick={() => ctrl.current?.abort()}>
            취소
          </Button>
        ) : (
          <Button variant="subtle" icon={<Download size={12} />} disabled={!/^[A-Za-z0-9._:/-]+$/.test(name.trim())} onClick={() => void start()}>
            내려받기
          </Button>
        )}
      </div>
      {prog && (
        <div className="text-[10px] text-muted">
          <div className="h-1.5 overflow-hidden rounded bg-bg">
            <div className="h-full bg-accent transition-all" style={{ width: `${prog.pct ?? 5}%` }} />
          </div>
          {prog.status} {prog.pct != null && `${prog.pct}%`}
        </div>
      )}
      {err && <p className="text-[10px] text-red-300">{err}</p>}
    </div>
  );
}

function ProviderCard({ p, settings }: { p: ProviderInfo; settings: AiSettings }) {
  const [test, setTest] = useState<TestResult | 'running' | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [color, label] = STATE[p.state] ?? STATE.unknown;
  const reload = () => void loadAiStatus().then(() => refreshServer());
  const saveProvider = async (patch: Record<string, string>) => {
    const providers = { ...settings.providers, [p.id]: { ...settings.providers[p.id], ...patch } } as AiSettings['providers'];
    setSaveErr(await saveAiSettings({ providers }));
  };
  const model = settings.providers[p.id].model;
  return (
    <section className="space-y-2 rounded-md border border-line bg-panel-2 p-3" data-testid={`provider-${p.id}`} data-state={p.state}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="text-[13px] font-semibold text-white">{p.label}</span>
        <CostBadge paid={p.paid} />
        <span className="ml-auto text-[11px] text-muted">{label}</span>
      </div>
      <p className="text-[11px] text-text">{p.message}</p>
      {p.hint && p.state !== 'ready' && <p className="text-[11px] text-amber-200/90">해결 방법: {p.hint}</p>}
      {p.key && <KeyField p={p} onChanged={reload} />}
      {p.id === 'dashscope' && p.regions && (
        <label className="flex items-center gap-2 text-[11px]">
          <span className="w-12 text-muted">지역</span>
          <select aria-label="DashScope 지역" value={settings.providers.dashscope.region} onChange={(e) => void saveProvider({ region: e.target.value })} className={inputCls}>
            {Object.entries(p.regions).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <span className="text-muted">키를 발급한 지역과 같아야 합니다</span>
        </label>
      )}
      {p.id === 'ollama' && (
        <label className="flex items-center gap-2 text-[11px]">
          <span className="w-12 text-muted">주소</span>
          <input
            aria-label="Ollama 주소"
            defaultValue={settings.providers.ollama.url}
            onBlur={(e) => e.target.value !== settings.providers.ollama.url && void saveProvider({ url: e.target.value.trim() })}
            className={`${inputCls} w-56 font-mono`}
          />
          <span className="text-muted">이 PC만 허용</span>
        </label>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-12 text-muted">모델</span>
        <div className="flex-1">
          <ModelPicker pid={p.id} value={model} onChange={(m) => void saveProvider({ model: m })} />
        </div>
        <Button
          variant="subtle"
          icon={<Plug size={12} />}
          disabled={test === 'running'}
          data-testid={`test-${p.id}`}
          onClick={async () => {
            setTest('running');
            try {
              setTest(await api.aiTest(p.id, model));
            } catch (e) {
              setTest({ ok: false, provider: p.id, model, error: (e as Error).message });
            }
          }}
        >
          연결 테스트
        </Button>
      </div>
      <TestBox r={test} />
      {p.id === 'ollama' && p.state === 'ready' && <OllamaPull onDone={reload} />}
      {p.id === 'ollama' && p.recommended && (
        <p className="text-[10px] leading-relaxed text-muted">추천: {p.recommended.map((m) => `${m.id} (${m.note})`).join(' · ')}</p>
      )}
      {saveErr && <p className="text-[11px] text-red-300">{saveErr}</p>}
    </section>
  );
}

function SelEditor({ label, value, onChange, allowDefault, providers }: {
  label: string;
  value: ModelSel | null;
  onChange: (v: ModelSel | null) => void;
  allowDefault?: boolean;
  providers: ProviderInfo[];
}) {
  const pid = value?.provider;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-32 text-muted">{label}</span>
      <select
        aria-label={`${label} 제공자`}
        value={pid ?? ''}
        className={inputCls}
        onChange={(e) => {
          const v = e.target.value as ProviderId | '';
          if (!v) return onChange(null);
          onChange({ provider: v, model: providers.find((p) => p.id === v)?.model ?? '' });
        }}
      >
        {allowDefault && <option value="">기본 모델 사용</option>}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} {p.paid ? '(유료)' : '(무료·로컬)'}
          </option>
        ))}
      </select>
      {pid && (
        <div className="min-w-0 flex-1">
          <ModelPicker pid={pid} value={value!.model} onChange={(m) => onChange({ provider: pid, model: m })} />
        </div>
      )}
    </div>
  );
}

function ModelsTab({ settings, providers }: { settings: AiSettings; providers: ProviderInfo[] }) {
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useState(settings.params);
  const save = async (patch: Partial<AiSettings>) => setErr(await saveAiSettings(patch));
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-md border border-line bg-panel-2 p-3">
        <p className="text-[12px] font-semibold text-white">기본 모델</p>
        <SelEditor label="기본" value={settings.default} providers={providers} onChange={(v) => v && void save({ default: v })} />
        <p className="text-[12px] font-semibold text-white">작업 종류별 모델</p>
        <SelEditor label="AI Assistant (편집)" allowDefault value={settings.tasks.assistant} providers={providers}
          onChange={(v) => void save({ tasks: { ...settings.tasks, assistant: v } })} />
        <SelEditor label="온이 요청" allowDefault value={settings.tasks.oni} providers={providers}
          onChange={(v) => void save({ tasks: { ...settings.tasks, oni: v } })} />
      </section>
      <section className="space-y-2 rounded-md border border-line bg-panel-2 p-3">
        <label className="flex items-center gap-2 text-[12px] text-white">
          <input type="checkbox" checked={settings.fallback.enabled} data-testid="fallback-toggle"
            onChange={(e) => void save({ fallback: { enabled: e.target.checked, order: settings.fallback.order.length ? settings.fallback.order : (['ollama', 'dashscope', 'claude'] as ProviderId[]) } })} />
          연결 실패 시 다른 모델로 자동 대체
        </label>
        {settings.fallback.enabled && (
          <p className="text-[11px] text-muted">
            대체 순서: {settings.fallback.order.join(' → ')} (유료 API로 넘어갈 수 있으니 비용에 주의하세요. 넘어가면 대화창에 표시됩니다)
          </p>
        )}
      </section>
      <section className="space-y-2 rounded-md border border-line bg-panel-2 p-3 text-[11px]">
        <p className="text-[12px] font-semibold text-white">모델 공통 설정</p>
        {(
          [
            ['temperature', '창의성 (0~1.5, 낮을수록 정확)', 0.1],
            ['max_tokens', '최대 응답 길이 (토큰)', 256],
            ['timeout', '시간 제한 (초)', 10],
            ['history', '기억할 이전 대화 수', 1],
          ] as const
        ).map(([k, label, step]) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-48 text-muted">{label}</span>
            <input type="number" step={step} value={params[k]} aria-label={label}
              onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })} className={`${inputCls} w-24`} />
          </label>
        ))}
        <Button variant="subtle" onClick={() => void save({ params })}>
          저장
        </Button>
      </section>
      {err && <p className="text-[11px] text-red-300">{err}</p>}
    </div>
  );
}

function UsageTab({ settings }: { settings: AiSettings }) {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [days, setDays] = useState(30);
  const [prices, setPrices] = useState(settings.prices);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.aiUsage(days).then((r) => setRows(r.rows), () => setRows([]));
  }, [days]);
  const total = (rows ?? []).reduce((a, r) => a + r.estimatedCostUsd, 0);
  return (
    <div className="space-y-3 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-muted">기간</span>
        {[1, 30, 365].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={`rounded border px-2 py-0.5 ${days === d ? 'border-accent text-white' : 'border-line text-muted'}`}>
            {d === 1 ? '오늘' : d === 30 ? '30일' : '1년'}
          </button>
        ))}
        <span className="ml-auto text-white">예상 비용 합계: {usd(total)}</span>
      </div>
      <table className="w-full" data-testid="usage-table">
        <thead className="text-muted">
          <tr className="text-left">
            <th>제공자</th><th>모델</th><th>요청</th><th>입력 토큰</th><th>출력 토큰</th><th>예상 비용</th><th>평균 응답</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.provider + r.model} className="border-t border-line">
              <td>{r.provider}</td><td className="font-mono">{r.model}</td><td>{r.succeeded}/{r.requests}</td>
              <td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td>
              <td>{r.provider === 'ollama' ? '무료' : r.unpricedRequests ? `${usd(r.estimatedCostUsd)} (+단가 없음 ${r.unpricedRequests})` : usd(r.estimatedCostUsd)}</td>
              <td>{(r.avgLatencyMs / 1000).toFixed(1)}초</td>
            </tr>
          ))}
          {rows && rows.length === 0 && (
            <tr><td colSpan={7} className="py-2 text-muted">아직 사용 기록이 없습니다.</td></tr>
          )}
        </tbody>
      </table>
      <p className="text-muted">예상 비용은 아래 단가표로 계산한 값입니다. 실제 청구 금액은 Anthropic 콘솔 / Alibaba Cloud 콘솔에서 확인하세요.</p>
      <section className="space-y-1 rounded-md border border-line bg-panel-2 p-3">
        <p className="font-semibold text-white">단가표 (1백만 토큰당 USD, 직접 수정 가능)</p>
        {Object.entries(prices).map(([m, p]) => (
          <div key={m} className="flex items-center gap-2">
            <span className="w-40 font-mono">{m}</span>
            입력 <input type="number" step="0.01" min={0} value={p.in} aria-label={`${m} 입력 단가`} className={`${inputCls} w-20`}
              onChange={(e) => setPrices({ ...prices, [m]: { ...p, in: Number(e.target.value) } })} />
            출력 <input type="number" step="0.01" min={0} value={p.out} aria-label={`${m} 출력 단가`} className={`${inputCls} w-20`}
              onChange={(e) => setPrices({ ...prices, [m]: { ...p, out: Number(e.target.value) } })} />
          </div>
        ))}
        <Button variant="subtle" onClick={async () => setMsg((await saveAiSettings({ prices })) ?? '저장했습니다')}>
          단가 저장
        </Button>
        {msg && <span className="ml-2 text-muted">{msg}</span>}
      </section>
    </div>
  );
}

/** AI 설정 (제공자 · 모델 · 키 · Ollama · 테스트 · 사용량 · 엔진 · 온이) */
const PN: Record<string, string> = { claude: 'Claude', dashscope: 'Qwen API', ollama: 'Ollama' };
const RES: Record<string, [string, string]> = {
  pending: ['대기', 'text-muted'],
  running: ['진행 중…', 'text-accent'],
  pass: ['✅ 통과', 'text-emerald-400'],
  fail: ['❌ 실패', 'text-red-400'],
  skip: ['⏭ 건너뜀', 'text-muted'],
};

/** 실제 AI 점검: 이 PC에 연결된 실제 모델로 완료 조건 1~8을 자동 확인하고 보고서를 만듦 */
function SelfTestTab({ providers }: { providers: ProviderInfo[] }) {
  const ready = providers.filter((p) => p.state === 'ready');
  const active = useProjectStore((s) => s.health?.ai);
  const [pid, setPid] = useState<string>(active?.configured && active.provider ? active.provider : ready[0]?.id ?? '');
  const [run, setRun] = useState<SelfTestState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const sel = ready.find((p) => p.id === pid);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);
  const poll = (id: string) => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const s = await api.aiSelfTestGet(id);
        setRun(s);
        if (s.state !== 'running' && timer.current) window.clearInterval(timer.current);
      } catch {
        /* 다음에 다시 */
      }
    }, 1000);
  };
  const start = async () => {
    setErr(null);
    setCopied(false);
    try {
      const s = await api.aiSelfTestStart(pid || undefined);
      setRun(s);
      poll(s.id);
    } catch (e) {
      const x = e as { message: string; hint?: string };
      setErr([x.message, x.hint].filter(Boolean).join(' — '));
    }
  };
  const done = run && run.state !== 'running';
  const counts = run ? { pass: run.items.filter((i) => i.result === 'pass').length, fail: run.items.filter((i) => i.result === 'fail').length, skip: run.items.filter((i) => i.result === 'skip').length } : null;

  return (
    <div className="space-y-3 text-[12px]" data-testid="selftest-tab">
      <p className="text-[11px] text-muted">
        이 PC에 연결된 <b className="text-text">실제 AI 모델</b>로 1단계 완료 조건 8가지를 자동으로 확인합니다. 장면은 바꾸지 않고(계획만 받아 검증), 임시 대화는 끝나면 지웁니다.
        결과 보고서는 <span className="text-text">문서\FORM3D\reports</span>에 저장됩니다.
      </p>
      {ready.length === 0 ? (
        <p className="text-amber-300">연결된 AI가 없습니다. "AI 제공자" 탭에서 Ollama·Qwen API·Claude 중 하나를 먼저 연결하세요.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">점검할 모델</span>
          <select aria-label="점검할 모델" data-testid="selftest-provider" value={pid} onChange={(e) => setPid(e.target.value)} disabled={run?.state === 'running'} className={inputCls}>
            {ready.map((p) => (
              <option key={p.id} value={p.id}>
                {PN[p.id] ?? p.id}
                {p.model ? ` · ${p.model}` : ''} {p.paid ? '(유료)' : '(무료)'}
              </option>
            ))}
          </select>
          {run?.state === 'running' ? (
            <Button variant="ghost" onClick={() => void api.aiSelfTestCancel(run.id)} data-testid="selftest-cancel">
              중단
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void start()} data-testid="selftest-start">
              점검 시작
            </Button>
          )}
          {sel?.paid && <span className="text-[10px] text-amber-300">유료 모델: 약 10~12회 요청 (몇십 원 이하 예상)</span>}
          {sel && !sel.paid && <span className="text-[10px] text-muted">로컬 모델은 PC 사양에 따라 몇 분 걸릴 수 있습니다</span>}
        </div>
      )}
      {err && <p className="text-red-400" data-testid="selftest-error">{err}</p>}
      {run && (
        <div className="space-y-1.5" data-testid="selftest-result" data-state={run.state}>
          <p className="text-muted">
            {run.providerName} · {run.model} — {run.state === 'running' ? `${run.current}번 점검 중…` : run.state === 'cancelled' ? '중단됨' : '완료'}
            {done && counts && ` · 통과 ${counts.pass} · 실패 ${counts.fail} · 건너뜀 ${counts.skip}`}
          </p>
          {run.items.map((it) => {
            const [label, cls] = RES[it.result] ?? [it.result, ''];
            return (
              <div key={it.no} className="rounded border border-line bg-panel-2" data-testid={`selftest-item-${it.no}`} data-result={it.result}>
                <button type="button" className="flex w-full items-center gap-2 px-2 py-1 text-left" onClick={() => setOpen(open === it.no ? null : it.no)}>
                  <span className="w-4 text-muted">{it.no}</span>
                  <span className="flex-1 text-text">{it.title}</span>
                  <span className={cls}>{label}</span>
                  {it.seconds != null && <span className="w-12 text-right text-[10px] text-muted">{it.seconds}초</span>}
                </button>
                {(it.note || open === it.no) && <p className="px-2 pb-1 pl-8 text-[11px] text-muted">{it.note}</p>}
                {open === it.no && (it.log ?? []).map((l, i) => (
                  <div key={i} className="mx-2 mb-1.5 ml-8 rounded bg-bg p-1.5 text-[11px] select-text">
                    <div className="text-muted">요청: {l.request}</div>
                    <div className="text-violet-200">AI({l.response.kind}): {l.response.message || '(메시지 없음)'}</div>
                    {l.response.options && l.response.options.length > 0 && <div className="text-muted">선택지: {l.response.options.join(', ')}</div>}
                    {l.response.steps && l.response.steps.length > 0 && <div className="font-mono text-[10px] text-muted">{JSON.stringify(l.response.steps).slice(0, 400)}</div>}
                  </div>
                ))}
              </div>
            );
          })}
          {done && run.report && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="subtle"
                data-testid="selftest-copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(run.report ?? '');
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? '복사됨' : '보고서 복사'}
              </Button>
              {run.reportPath && <span className="break-all text-[10px] text-muted">저장: {run.reportPath}</span>}
            </div>
          )}
          {done && <p className="text-[10px] text-muted">보고서를 복사해 개발 담당(Claude)에게 붙여 넣어 주시면, 실제 결과를 바탕으로 고칩니다.</p>}
        </div>
      )}
    </div>
  );
}

export function AISettingsDialog() {
  const { open, tab, status, loading, error, set } = useAiSettings();
  const health = useProjectStore((s) => s.health);
  const server = useProjectStore((s) => s.server);
  if (!open) return null;
  const close = () => set({ open: false });
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
      <div role="dialog" aria-modal="true" aria-label="AI 설정" className="flex h-[640px] max-h-[92vh] w-[860px] max-w-[96vw] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex items-center border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold text-white">AI 설정</span>
          {loading && <Loader2 size={13} className="ml-2 animate-spin text-accent" />}
          <button type="button" aria-label="닫기" onClick={close} className="ml-auto text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 space-y-0.5 border-r border-line p-2">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => set({ tab: id })}
                className={`block w-full rounded px-2 py-1.5 text-left text-[12px] ${tab === id ? 'bg-accent/20 text-white' : 'text-muted hover:text-text'}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {server !== 'online' ? (
              <p className="text-[12px] text-amber-300">로컬 서버가 꺼져 있어 AI 설정을 쓸 수 없습니다. 터미널에서 npm run dev 로 실행하세요.</p>
            ) : error ? (
              <p className="text-[12px] text-red-300">불러오기 실패: {error}</p>
            ) : !status ? (
              <p className="text-[12px] text-muted">불러오는 중…</p>
            ) : status.test ? (
              <p className="text-[12px] text-amber-300">테스트 전용 서버입니다 (test-planner). 실제 제공자 설정은 npm run dev 로 실행한 서버에서 할 수 있습니다.</p>
            ) : tab === 'providers' ? (
              <div className="space-y-3">
                <p className="text-[11px] text-muted">
                  셋 중 하나만 준비되어도 AI를 쓸 수 있습니다. API 키는 이 PC의 로컬 서버 파일에만 저장되며 화면에는 가린 값만 보입니다.
                </p>
                {status.providers.map((p) => (
                  <ProviderCard key={p.id} p={p} settings={status.settings} />
                ))}
              </div>
            ) : tab === 'models' ? (
              <ModelsTab settings={status.settings} providers={status.providers} />
            ) : tab === 'selftest' ? (
              <SelfTestTab providers={status.providers} />
            ) : tab === 'usage' ? (
              <UsageTab settings={status.settings} />
            ) : tab === 'engines' ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted">각 엔진은 독립 모듈로 연결·교체됩니다. 현재는 아무 엔진도 연결되어 있지 않습니다.</p>
                {status.engines.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-[12px]" data-testid={`engine-${e.id}`}>
                    <span className={`h-2 w-2 rounded-full ${e.available ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                    <span className="text-white">{e.name}</span>
                    <span className={`rounded border px-1.5 py-px text-[10px] ${e.available ? 'border-emerald-500/50 text-emerald-300' : 'border-line text-muted'}`}>
                      {e.available ? '사용 가능' : '준비 안 됨'}
                    </span>
                    <span className="text-[11px] text-muted">{e.phase}{e.backends.length ? ` · 연결 후보: ${e.backends.join(', ')}` : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 text-[12px]">
                <p>온이 같은 외부 AI는 이 PC 안에서만 FORM3D를 조작할 수 있습니다.</p>
                {health && (
                  <div className="space-y-1 rounded bg-bg p-3 font-mono text-[11px] text-muted select-text">
                    <div>API 주소: {health.externalApi.base}</div>
                    <div className="break-all">토큰 파일: {health.externalApi.tokenFile}</div>
                  </div>
                )}
                <p className="text-[11px] text-muted">
                  새 기능: POST /api/v1/assist (자연어 작업 요청), GET /api/v1/jobs/작업ID (진행 상태), GET /api/v1/ai/models (사용 가능한 모델).
                  처리 방법(거부 / 확인 후 실행 / 자동 실행)은 AI Assistant 탭의 "외부 AI(온이)" 버튼에서 정합니다. 자세한 내용은 docs/ONI-API.md.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
