import { useEffect, useRef, useState } from 'react';
import { useDialogStore } from '../../state/dialogStore';
import { Button } from './Button';

/** 화면 안 대화상자 (확인 / 이름 입력). Enter = 기본 버튼, Esc = 취소 */
export function DialogHost() {
  const dialog = useDialogStore((s) => s.dialog);
  const close = useDialogStore((s) => s.close);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const primary = dialog?.buttons.find((b) => b.variant === 'primary')?.value ?? dialog?.buttons.at(-1)?.value;

  useEffect(() => {
    if (!dialog) return;
    setValue(dialog.input?.value ?? '');
    setTimeout(() => inputRef.current?.select(), 0);
  }, [dialog]);

  if (!dialog) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close('cancel');
        if (e.key === 'Enter' && primary && (!dialog.input || value.trim())) close(primary, value);
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={dialog.title} className="w-[380px] rounded-lg border border-line bg-panel shadow-2xl">
        <div className="border-b border-line px-4 py-3 text-[13px] font-semibold text-white">{dialog.title}</div>
        <div className="space-y-3 px-4 py-3">
          {dialog.message && <p className="text-[12px] leading-relaxed text-text">{dialog.message}</p>}
          {dialog.input && (
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">{dialog.input.label}</span>
              <input
                ref={inputRef}
                autoFocus
                aria-label={dialog.input.label}
                value={value}
                maxLength={dialog.input.maxLength}
                onChange={(e) => setValue(e.target.value)}
                className="h-8 w-full rounded border border-line bg-bg px-2 text-[12px] text-white focus:border-accent focus:outline-none"
              />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">
          {dialog.buttons.map((b) => (
            <Button
              key={b.value}
              autoFocus={!dialog.input && b.value === primary}
              variant={b.variant === 'primary' ? 'primary' : b.variant === 'danger' ? 'subtle' : 'ghost'}
              className={b.variant === 'danger' ? 'text-red-300' : ''}
              disabled={b.value === primary && !!dialog.input && !value.trim()}
              onClick={() => close(b.value, value)}
            >
              {b.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
