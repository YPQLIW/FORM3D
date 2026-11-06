import { create } from 'zustand';
import type { ProjectMeta, ServerHealth } from '../lib/api';
import type { RecoverySnapshot } from '../lib/recoveryDb';

export type ServerStatus = 'checking' | 'online' | 'offline';

interface ProjectState {
  server: ServerStatus;
  health: ServerHealth | null;
  /** 서버 저장소의 프로젝트 ID (아직 서버에 저장한 적 없으면 null) */
  projectId: string | null;
  createdAt: string | null;
  lastSavedAt: number | null;
  saving: boolean;
  /** 자동 저장(서버 프로젝트 덮어쓰기) 켜짐 */
  autoSave: boolean;
  lastAutoSnapshotAt: number | null;
  recent: ProjectMeta[];
  recentLoading: boolean;
  recovery: RecoverySnapshot | null;
  set: (patch: Partial<ProjectState>) => void;
}

const loadAutoSave = () => {
  try {
    return localStorage.getItem('form3d.autoSave') !== 'off';
  } catch {
    return true;
  }
};

export const useProjectStore = create<ProjectState>((set) => ({
  server: 'checking',
  health: null,
  projectId: null,
  createdAt: null,
  lastSavedAt: null,
  saving: false,
  autoSave: loadAutoSave(),
  lastAutoSnapshotAt: null,
  recent: [],
  recentLoading: false,
  recovery: null,
  set: (patch) => {
    if ('autoSave' in patch) {
      try {
        localStorage.setItem('form3d.autoSave', patch.autoSave ? 'on' : 'off');
      } catch {
        /* 무시 */
      }
    }
    set(patch);
  },
}));
