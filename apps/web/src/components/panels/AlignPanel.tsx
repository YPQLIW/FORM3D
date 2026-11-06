import type { AlignMode, AxisIndex } from '@form3d/model-types';
import {
  alignSelected,
  distributeSelected,
  dropSelectedToFloor,
  snapSelectedToGrid,
} from '../../lib/actions';
import { useAppStore } from '../../state/appStore';
import { Button } from '../ui/Button';
import { Section } from '../ui/Section';

const AXES: { axis: AxisIndex; name: string; color: string }[] = [
  { axis: 0, name: 'X', color: 'text-red-400' },
  { axis: 1, name: 'Y', color: 'text-green-400' },
  { axis: 2, name: 'Z', color: 'text-blue-400' },
];
const MODES: { mode: AlignMode; label: string }[] = [
  { mode: 'min', label: '최소' },
  { mode: 'center', label: '중앙' },
  { mode: 'max', label: '최대' },
];

const cell =
  'h-6 rounded border border-line bg-panel-2 text-[11px] text-text hover:border-accent/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line';

/** 정렬 · 분배 · 스냅 (모든 동작은 Undo 1회로 되돌릴 수 있음) */
export function AlignPanel({ count }: { count: number }) {
  const ref = useAppStore((s) => s.alignReference);
  const setRef = useAppStore((s) => s.setAlignReference);
  const gridStep = useAppStore((s) => s.snap.translate);
  const canAlign = count >= 2;
  const canDistribute = count >= 3;

  return (
    <Section title="정렬 / 스냅">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-12 shrink-0 text-muted">기준</span>
          <select
            aria-label="정렬 기준"
            value={ref}
            onChange={(e) => setRef(e.target.value as 'selection' | 'active')}
            className="h-6 w-full min-w-0 flex-1 rounded border border-line bg-bg px-1 text-[11px] focus:border-accent focus:outline-none"
          >
            <option value="selection">선택 영역 전체</option>
            <option value="active">활성 오브젝트</option>
          </select>
        </div>
        <div className="grid grid-cols-[20px_1fr_1fr_1fr_1fr] items-center gap-1" role="group" aria-label="정렬">
          <span />
          {MODES.map((m) => (
            <span key={m.mode} className="text-center text-[10px] text-muted">
              {m.label}
            </span>
          ))}
          <span className="text-center text-[10px] text-muted">분배</span>
          {AXES.map((a) => (
            <div key={a.axis} className="contents">
              <span className={`text-center text-[10px] font-bold ${a.color}`}>{a.name}</span>
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  className={cell}
                  disabled={!canAlign}
                  aria-label={`${a.name} ${m.label} 정렬`}
                  title={canAlign ? `${a.name}축 ${m.label} 맞추기` : '2개 이상 선택하면 사용할 수 있습니다'}
                  onClick={() => alignSelected(a.axis, m.mode)}
                >
                  {m.label}
                </button>
              ))}
              <button
                type="button"
                className={cell}
                disabled={!canDistribute}
                aria-label={`${a.name} 균등 분배`}
                title={canDistribute ? `${a.name}축으로 같은 간격 배치` : '3개 이상 선택하면 사용할 수 있습니다'}
                onClick={() => distributeSelected(a.axis)}
              >
                ↔
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          <Button variant="subtle" className="flex-1 justify-center !px-1" onClick={dropSelectedToFloor} title="바운딩 박스 바닥을 Y=0에 맞춥니다">
            <span className="whitespace-nowrap">바닥에 놓기</span>
          </Button>
          <Button
            variant="subtle"
            className="flex-1 justify-center !px-1"
            onClick={snapSelectedToGrid}
            title={`위치를 ${gridStep}m 그리드에 맞춥니다 (단위는 뷰포트의 스냅 설정)`}
          >
            <span className="whitespace-nowrap">
              그리드 스냅 <span className="text-muted">{gridStep}</span>
            </span>
          </Button>
        </div>
        {!canAlign && <p className="text-[10px] text-muted">정렬은 2개 이상, 분배는 3개 이상 선택 시 사용할 수 있습니다.</p>}
      </div>
    </Section>
  );
}
