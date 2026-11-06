import { create } from 'zustand';
import type { AiStatus } from '../lib/api';

export type SettingsTab = 'providers' | 'models' | 'selftest' | 'usage' | 'engines' | 'oni';

interface S {
  open: boolean;
  tab: SettingsTab;
  status: AiStatus | null;
  loading: boolean;
  error: string | null;
  set: (p: Partial<Omit<S, 'set'>>) => void;
}

export const useAiSettings = create<S>((set) => ({
  open: false,
  tab: 'providers',
  status: null,
  loading: false,
  error: null,
  set: (p) => set(p),
}));
