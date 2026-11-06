import { useRef, useState, type ReactNode } from 'react';
import { Box, Camera, ChevronDown, Focus, Globe, Grid3x3, Magnet, Maximize2, Move, Rotate3d, Shapes } from 'lucide-react';
import { VIEW_PRESETS, type ViewPreset } from '@form3d/model-types';
import { IconButton } from '../ui/Button';
import { isSnapActive, useAppStore } from '../../state/appStore';
import { VIEW_LABELS } from './CameraController';

const VIEW_KEY: Record<ViewPreset, string> = { front: '1', back: '2', right: '3', left: '4', top: '5', bottom: '6', iso: '0' };

/** 버튼 + 드롭다운 패널 (포커스가 밖으로 나가면 닫힘) */
function Dropdown({
  label,
  testId,
  button,
  children,
}: {
  label: string;
  testId: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen(!open)}
        className={
          'inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 transition-colors ' +
          (open ? 'bg-accent/25 text-white' : 'text-muted hover:bg-white/5 hover:text-text')
        }
      >
        {button}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-50 min-w-40 rounded-md border border-line bg-panel-2 py-1 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function SnapField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) onChange(n);
    else setText(String(value));
  };
  return (
    <label className="flex items-center justify-between gap-2 px-3 py-1 text-[11px]">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        aria-label={label}
        step={step}
        min={0}
        className="h-6 w-16 rounded border border-line bg-bg px-1 text-right font-mono text-[11px] focus:border-accent focus:outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function ViewportToolbar() {
  const s = useAppStore();
  const snapOn = isSnapActive(s);
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex gap-2">
      <div className="pointer-events-auto flex gap-0.5 rounded-md border border-line bg-panel/90 p-0.5 backdrop-blur">
        <IconButton label="이동 (W)" active={s.transformMode === 'translate'} onClick={() => s.setTransformMode('translate')}>
          <Move size={14} />
        </IconButton>
        <IconButton label="회전 (E)" active={s.transformMode === 'rotate'} onClick={() => s.setTransformMode('rotate')}>
          <Rotate3d size={14} />
        </IconButton>
        <IconButton label="크기 조절 (R)" active={s.transformMode === 'scale'} onClick={() => s.setTransformMode('scale')}>
          <Maximize2 size={14} />
        </IconButton>
        <div className="mx-0.5 w-px bg-line" />
        <IconButton
          label={s.transformSpace === 'world' ? '좌표계: 월드 (클릭 시 로컬)' : '좌표계: 로컬 (클릭 시 월드)'}
          active={s.transformSpace === 'local'}
          onClick={s.toggleTransformSpace}
        >
          <Globe size={14} />
        </IconButton>
        <div className="mx-0.5 w-px bg-line" />
        <IconButton
          label={`스냅 ${s.snap.enabled ? '켜짐' : '꺼짐'} (Ctrl을 누른 채 드래그하면 일시 전환)`}
          active={snapOn}
          onClick={() => s.setSnap({ enabled: !s.snap.enabled })}
        >
          <Magnet size={14} />
        </IconButton>
        <Dropdown label="스냅 설정" testId="snap-settings" button={<span className="text-[10px]">{s.snap.translate}</span>}>
          {() => (
            <div className="w-48 py-1">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">스냅 단위</div>
              <SnapField label="이동 (m)" step={0.1} value={s.snap.translate} onChange={(v) => s.setSnap({ translate: v })} />
              <SnapField label="회전 (°)" step={5} value={s.snap.rotateDeg} onChange={(v) => s.setSnap({ rotateDeg: v })} />
              <SnapField label="크기" step={0.05} value={s.snap.scale} onChange={(v) => s.setSnap({ scale: v })} />
              <p className="px-3 pt-1 text-[10px] leading-snug text-muted">
                자석 버튼으로 켜고 끕니다. 드래그 중 Ctrl을 누르면 반대로 동작합니다.
              </p>
            </div>
          )}
        </Dropdown>
      </div>

      <div className="pointer-events-auto flex gap-0.5 rounded-md border border-line bg-panel/90 p-0.5 backdrop-blur">
        <IconButton
          label="선택 모드: 오브젝트 (모델 전체 선택)"
          active={s.selectionMode === 'object'}
          onClick={() => s.setSelectionMode('object')}
        >
          <Shapes size={14} />
        </IconButton>
        <IconButton
          label="선택 모드: 메시 (개별 메시 선택)"
          active={s.selectionMode === 'mesh'}
          onClick={() => s.setSelectionMode('mesh')}
        >
          <Box size={14} />
        </IconButton>
      </div>

      <div className="pointer-events-auto flex gap-0.5 rounded-md border border-line bg-panel/90 p-0.5 backdrop-blur">
        <IconButton label="선택 대상에 맞추기 (F)" onClick={s.requestFrame}>
          <Focus size={14} />
        </IconButton>
        <Dropdown label="카메라 시점" testId="view-menu" button={<Camera size={14} />}>
          {(close) =>
            VIEW_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-accent/20"
                onClick={() => {
                  s.requestView(p);
                  close();
                }}
              >
                {VIEW_LABELS[p]}
                <span className="font-mono text-[10px] text-muted">{VIEW_KEY[p]}</span>
              </button>
            ))
          }
        </Dropdown>
        <IconButton label="그리드 표시" active={s.showGrid} onClick={s.toggleGrid}>
          <Grid3x3 size={14} />
        </IconButton>
      </div>
    </div>
  );
}
