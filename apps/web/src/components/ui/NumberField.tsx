import { useEffect, useRef, useState } from 'react';
import { evaluateExpression } from '@form3d/shared';

interface Props {
  /** null이면 여러 오브젝트의 값이 서로 다름(혼합) */
  value: number | null;
  onCommit: (v: number) => void;
  step?: number;
  precision?: number;
  axis?: 'x' | 'y' | 'z';
  disabled?: boolean;
  ariaLabel?: string;
  /** 축 라벨을 좌우로 드래그해 값 조절 (드래그 중 실시간 반영) */
  onScrubStart?: () => void;
  onScrub?: (v: number) => void;
  onScrubEnd?: (committed: boolean) => void;
}

const axisColor = { x: 'text-red-400', y: 'text-green-400', z: 'text-blue-400' };

/**
 * 정밀 숫자 입력
 * - Enter/포커스 해제 시 확정, Esc 취소, 잘못된 값은 이전 값으로 복원
 * - 수식 입력: "1.5*2", "(3+1)/4" 등
 * - ↑/↓: step만큼 증감 (Shift ×10, Alt ×0.1)
 * - 축 라벨 드래그: 값 스크럽 (Shift 정밀)
 */
export function NumberField({
  value,
  onCommit,
  step = 0.1,
  precision = 3,
  axis,
  disabled,
  ariaLabel,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: Props) {
  const fmt = (v: number | null) => (v === null ? '' : Number.isFinite(v) ? String(Number(v.toFixed(precision))) : '0');
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const scrub = useRef<{ x: number; start: number; last: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const commit = () => {
    const n = evaluateExpression(text);
    if (text.trim() === '' || n === null) {
      setText(fmt(value));
      return;
    }
    if (value === null || Math.abs(n - value) > 1e-9) onCommit(n);
    else setText(fmt(value));
  };

  const nudge = (dir: 1 | -1, mult: number) => {
    const base = evaluateExpression(text) ?? value ?? 0;
    const next = Number((base + dir * step * mult).toFixed(Math.max(precision, 4)));
    setText(fmt(next));
    onCommit(next);
  };

  const scrubbable = !!onScrub && !disabled;

  return (
    <label className="flex h-6 min-w-0 flex-1 items-center rounded border border-line bg-bg focus-within:border-accent">
      {axis && (
        <span
          data-scrub={scrubbable ? ariaLabel : undefined}
          title={scrubbable ? '좌우로 드래그해 값 조절 (Shift: 정밀)' : undefined}
          className={`w-4 shrink-0 text-center text-[10px] font-bold ${axisColor[axis]} ${scrubbable ? 'cursor-ew-resize' : ''}`}
          onPointerDown={(e) => {
            if (!scrubbable) return;
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const start = value ?? 0;
            scrub.current = { x: e.clientX, start, last: start, moved: false };
          }}
          onPointerMove={(e) => {
            const s = scrub.current;
            if (!s) return;
            const dx = e.clientX - s.x;
            if (!s.moved && Math.abs(dx) < 2) return;
            if (!s.moved) {
              s.moved = true;
              onScrubStart?.();
            }
            const perPx = (e.shiftKey ? step * 0.1 : step) / 2;
            const v = Number((s.start + dx * perPx).toFixed(Math.max(precision, 4)));
            if (v !== s.last) {
              s.last = v;
              setText(fmt(v));
              onScrub?.(v);
            }
          }}
          onClick={(e) => {
            // 라벨 클릭이 입력칸 포커스로 이어지지 않게 함 (스크럽 후 Ctrl+Z가 입력칸에 먹히는 문제 방지)
            if (scrubbable) e.preventDefault();
          }}
          onPointerUp={() => {
            const s = scrub.current;
            scrub.current = null;
            if (s?.moved) onScrubEnd?.(s.last !== s.start);
          }}
        >
          {axis.toUpperCase()}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        aria-label={ariaLabel ?? axis}
        placeholder={value === null ? '—' : undefined}
        title={value === null ? '선택한 오브젝트들의 값이 다릅니다. 입력하면 모두 같은 값이 됩니다.' : '수식 입력 가능 (예: 1.5*2) · ↑↓ 증감'}
        className="h-full w-full min-w-0 bg-transparent px-1 font-mono text-[11px] text-text outline-none placeholder:text-muted disabled:opacity-50"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
          }
        }}
      />
    </label>
  );
}
