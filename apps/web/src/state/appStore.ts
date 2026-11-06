import { create } from 'zustand';
import type { ViewPreset } from '@form3d/model-types';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type SelectionMode = 'object' | 'mesh';
export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export type LeftTab = 'scene' | 'models' | 'projects' | 'files';
export type BottomTab = 'ai' | 'history' | 'log';

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

export interface SnapSettings {
  /** 스냅 켜짐 (Ctrl을 누른 채 드래그하면 일시적으로 반대로 동작) */
  enabled: boolean;
  /** 이동 단위 (m) */
  translate: number;
  /** 회전 단위 (도) */
  rotateDeg: number;
  /** 크기 단위 */
  scale: number;
}

export type AlignReference = 'selection' | 'active';

export interface ImportedFileEntry {
  id: number;
  fileName: string;
  size: number;
  time: number;
  objectId: string;
}

interface AppState {
  projectName: string;
  transformMode: TransformMode;
  transformSpace: 'world' | 'local';
  selectionMode: SelectionMode;
  showGrid: boolean;
  leftTab: LeftTab;
  bottomTab: BottomTab;
  busy: string | null;
  logs: LogEntry[];
  importedFiles: ImportedFileEntry[];
  /** 증가할 때마다 뷰포트가 선택 대상(없으면 전체)에 카메라를 맞춤 */
  frameRequest: number;
  /** 카메라 시점 프리셋 요청 (seq가 바뀔 때마다 적용) */
  viewRequest: { preset: ViewPreset; seq: number } | null;
  snap: SnapSettings;
  /** Ctrl 키를 누르고 있는지 (스냅 일시 전환용) */
  snapInvert: boolean;
  /** 기즈모 드래그 중 표시할 실시간 값 */
  dragReadout: string | null;
  alignReference: AlignReference;

  setProjectName: (v: string) => void;
  setTransformMode: (v: TransformMode) => void;
  toggleTransformSpace: () => void;
  setSelectionMode: (v: SelectionMode) => void;
  toggleGrid: () => void;
  setLeftTab: (v: LeftTab) => void;
  setBottomTab: (v: BottomTab) => void;
  setBusy: (v: string | null) => void;
  log: (level: LogLevel, message: string) => void;
  addImportedFile: (e: Omit<ImportedFileEntry, 'id' | 'time'>) => void;
  requestFrame: () => void;
  requestView: (preset: ViewPreset) => void;
  setSnap: (patch: Partial<SnapSettings>) => void;
  setSnapInvert: (v: boolean) => void;
  setDragReadout: (v: string | null) => void;
  setAlignReference: (v: AlignReference) => void;
}

let logSeq = 0;
const MAX_LOGS = 300;

export const useAppStore = create<AppState>((set) => ({
  projectName: 'Untitled Project',
  transformMode: 'translate',
  transformSpace: 'world',
  selectionMode: 'object',
  showGrid: true,
  leftTab: 'scene',
  bottomTab: 'log',
  busy: null,
  logs: [{ id: logSeq++, time: Date.now(), level: 'info', message: 'FORM3D 에디터가 시작되었습니다.' }],
  importedFiles: [],
  frameRequest: 0,
  viewRequest: null,
  snap: { enabled: false, translate: 0.5, rotateDeg: 15, scale: 0.1 },
  snapInvert: false,
  dragReadout: null,
  alignReference: 'selection',

  setProjectName: (projectName) => set({ projectName }),
  setTransformMode: (transformMode) => set({ transformMode }),
  toggleTransformSpace: () =>
    set((s) => ({ transformSpace: s.transformSpace === 'world' ? 'local' : 'world' })),
  setSelectionMode: (selectionMode) => set({ selectionMode }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setLeftTab: (leftTab) => set({ leftTab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setBusy: (busy) => set({ busy }),
  log: (level, message) =>
    set((s) => ({
      logs: [...s.logs, { id: logSeq++, time: Date.now(), level, message }].slice(-MAX_LOGS),
    })),
  addImportedFile: (e) =>
    set((s) => ({ importedFiles: [...s.importedFiles, { ...e, id: logSeq++, time: Date.now() }] })),
  requestFrame: () => set((s) => ({ frameRequest: s.frameRequest + 1 })),
  requestView: (preset) => set((s) => ({ viewRequest: { preset, seq: (s.viewRequest?.seq ?? 0) + 1 } })),
  setSnap: (patch) => set((s) => ({ snap: { ...s.snap, ...patch } })),
  setSnapInvert: (snapInvert) => set({ snapInvert }),
  setDragReadout: (dragReadout) => set({ dragReadout }),
  setAlignReference: (alignReference) => set({ alignReference }),
}));

/** 현재 스냅이 실제로 적용되는지 (설정 XOR Ctrl) */
export function isSnapActive(s: Pick<AppState, 'snap' | 'snapInvert'>): boolean {
  return s.snap.enabled !== s.snapInvert;
}

// E2E 테스트·디버그용 (엔진과 같은 방식)
if (typeof window !== 'undefined') (window as unknown as { __FORM3D_APP__: unknown }).__FORM3D_APP__ = useAppStore;
