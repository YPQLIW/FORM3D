import { api, type AiSettings } from './api';
import { useAiSettings, type SettingsTab } from '../state/aiSettingsStore';
import { refreshServer } from './project';

export async function loadAiStatus(): Promise<void> {
  const st = useAiSettings.getState();
  st.set({ loading: true, error: null });
  try {
    st.set({ status: await api.aiStatus() });
  } catch (e) {
    st.set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    st.set({ loading: false });
  }
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<string | null> {
  try {
    await api.aiSaveSettings(patch);
    await loadAiStatus();
    void refreshServer();
    return null;
  } catch (e) {
    const err = e as { message: string; errors?: string[] };
    return [err.message, ...(err.errors ?? [])].join(' · ');
  }
}

export function openAiSettings(tab?: SettingsTab): void {
  useAiSettings.getState().set({ open: true, ...(tab ? { tab } : {}) });
  void loadAiStatus();
}
