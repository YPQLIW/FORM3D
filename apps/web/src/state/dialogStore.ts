import { create } from 'zustand';

/**
 * 화면 안 대화상자 (브라우저 기본 confirm/prompt 대신 사용 — 다크 테마 유지, 테스트 가능)
 */
export interface DialogButton<T extends string = string> {
  value: T;
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
}

export interface DialogState {
  title: string;
  message?: string;
  /** 텍스트 입력이 필요한 경우 기본값 */
  input?: { value: string; label: string; maxLength?: number };
  buttons: DialogButton[];
  resolve: (r: { button: string; input?: string }) => void;
}

interface Store {
  dialog: DialogState | null;
  open: (d: Omit<DialogState, 'resolve'>) => Promise<{ button: string; input?: string }>;
  close: (button: string, input?: string) => void;
}

export const useDialogStore = create<Store>((set, get) => ({
  dialog: null,
  open: (d) =>
    new Promise((resolve) => {
      get().dialog?.resolve({ button: 'cancel' });
      set({ dialog: { ...d, resolve } });
    }),
  close: (button, input) => {
    const d = get().dialog;
    set({ dialog: null });
    d?.resolve({ button, input });
  },
}));

export const dialog = {
  /** 저장하지 않은 변경이 있을 때: 'save' | 'discard' | 'cancel' */
  unsaved: async (action: string) =>
    (
      await useDialogStore.getState().open({
        title: '저장하지 않은 변경 사항',
        message: `현재 프로젝트에 저장하지 않은 변경이 있습니다. ${action} 전에 저장할까요?`,
        buttons: [
          { value: 'cancel', label: '취소', variant: 'ghost' },
          { value: 'discard', label: '저장 안 함', variant: 'danger' },
          { value: 'save', label: '저장', variant: 'primary' },
        ],
      })
    ).button as 'save' | 'discard' | 'cancel',
  prompt: async (title: string, label: string, value: string, okLabel = '확인') => {
    const r = await useDialogStore.getState().open({
      title,
      input: { value, label, maxLength: 120 },
      buttons: [
        { value: 'cancel', label: '취소', variant: 'ghost' },
        { value: 'ok', label: okLabel, variant: 'primary' },
      ],
    });
    return r.button === 'ok' ? (r.input ?? '').trim() || null : null;
  },
};
