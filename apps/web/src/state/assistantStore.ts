import { create } from 'zustand';
import type { CommandJob, JobResult } from '@form3d/model-types';

export type InterpreterMode = 'ai' | 'rules';
export type ExternalPolicy = 'deny' | 'confirm' | 'auto';
export type JobState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'invalid';

export type AssistantEntry =
  | { kind: 'user'; id: number; text: string; time: number }
  | {
      kind: 'note';
      id: number;
      level: 'info' | 'warn' | 'error';
      text: string;
      time: number;
      details?: string[];
      /** AI가 되물을 때 고를 수 있는 답 */
      options?: string[];
      meta?: AiMeta;
    }
  | {
      kind: 'job';
      id: number;
      time: number;
      job: CommandJob;
      /** AI 모델 이름 또는 외부 클라이언트 이름 */
      by?: string;
      state: JobState;
      errors?: string[];
      result?: JobResult;
      meta?: AiMeta;
      /** AI가 사용자에게 한 말 (예: "원기둥을 하나 만들겠습니다.") */
      say?: string;
    };

export interface AiMeta {
  provider: string;
  model: string;
  paid: boolean;
  costUsd: number | null;
  tokens: number;
  latencyMs: number;
  fallbackFrom?: string[];
}

type NewEntry =
  | Omit<Extract<AssistantEntry, { kind: 'user' }>, 'id' | 'time'>
  | Omit<Extract<AssistantEntry, { kind: 'note' }>, 'id' | 'time'>
  | Omit<Extract<AssistantEntry, { kind: 'job' }>, 'id' | 'time'>;

interface AssistantState {
  entries: AssistantEntry[];
  mode: InterpreterMode;
  thinking: boolean;
  /** AI 응답을 기다리기 시작한 시각 (경과 시간 표시용) */
  thinkingSince: number;
  externalPolicy: ExternalPolicy;
  bridgeConnected: boolean;
  /** 대화 맥락 ID (새 대화를 누르면 바뀜) */
  conversation: string;
  add: (e: NewEntry) => number;
  update: (id: number, patch: Partial<Extract<AssistantEntry, { kind: 'job' }>>) => void;
  set: (patch: Partial<Pick<AssistantState, 'mode' | 'thinking' | 'thinkingSince' | 'externalPolicy' | 'bridgeConnected' | 'conversation'>>) => void;
  clear: () => void;
}

const loadPolicy = (): ExternalPolicy => {
  try {
    const v = localStorage.getItem('form3d.externalPolicy');
    return v === 'deny' || v === 'auto' || v === 'confirm' ? v : 'confirm';
  } catch {
    return 'confirm';
  }
};

let seq = 1;
export function newConversationId(): string {
  const id = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem('form3d.conversation', id);
  } catch {
    /* 무시 */
  }
  return id;
}

/** 프로그램을 다시 켜도 마지막 대화를 이어가도록 대화 ID를 기억 */
function lastConversationId(): string {
  try {
    const v = localStorage.getItem('form3d.conversation');
    if (v && /^conv-[\w-]{4,60}$/.test(v)) return v;
  } catch {
    /* 무시 */
  }
  return newConversationId();
}
const MAX = 200;

export const useAssistantStore = create<AssistantState>((set) => ({
  entries: [],
  mode: 'ai',
  thinking: false,
  thinkingSince: 0,
  externalPolicy: loadPolicy(),
  bridgeConnected: false,
  conversation: lastConversationId(),
  add: (e) => {
    const id = seq++;
    set((s) => ({ entries: [...s.entries, { ...e, id, time: Date.now() } as AssistantEntry].slice(-MAX) }));
    return id;
  },
  update: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id && e.kind === 'job' ? { ...e, ...patch } : e)),
    })),
  set: (patch) => {
    if (patch.externalPolicy) {
      try {
        localStorage.setItem('form3d.externalPolicy', patch.externalPolicy);
      } catch {
        /* 무시 */
      }
    }
    set(patch);
  },
  clear: () => set({ entries: [] }),
}));
