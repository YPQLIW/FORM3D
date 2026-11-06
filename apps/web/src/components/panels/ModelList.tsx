import { computeStats, getMeta } from '@form3d/editor-core';
import { formatNumber } from '@form3d/shared';
import { engine, useEngineRevision } from '../../state/engine';
import { EmptyState } from '../ui/Section';

const SOURCE_LABEL = { primitive: '기본 도형', imported: '불러온 모델', group: '그룹', unknown: '기타' } as const;

/** 씬 최상위 모델 목록 (실제 씬 데이터 기반) */
export function ModelList() {
  useEngineRevision();
  const models = engine.root.children;
  const selected = engine.getSelectedId();
  if (models.length === 0) {
    return (
      <div className="px-3">
        <EmptyState>현재 씬에 모델이 없습니다.</EmptyState>
      </div>
    );
  }
  return (
    <ul className="space-y-1 p-2">
      {models.map((m) => {
        const meta = getMeta(m);
        const s = computeStats(m);
        return (
          <li key={m.uuid}>
            <button
              type="button"
              onClick={() => engine.select(m.uuid)}
              className={
                'w-full rounded-md border px-2 py-1.5 text-left ' +
                (selected === m.uuid ? 'border-accent bg-accent/15' : 'border-line bg-panel-2 hover:border-accent/50')
              }
            >
              <div className="truncate text-[12px] text-text">{m.name}</div>
              <div className="mt-0.5 text-[10px] text-muted">
                {SOURCE_LABEL[meta?.source ?? 'unknown']} · 메시 {s.meshes} · 삼각형 {formatNumber(s.triangles)}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
