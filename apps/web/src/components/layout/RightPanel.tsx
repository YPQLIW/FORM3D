import { isMesh } from '@form3d/editor-core';
import { Copy, Group, Ungroup } from 'lucide-react';
import { engine, useEngineRevision } from '../../state/engine';
import { canUngroupSelection, duplicateSelected, groupSelected, ungroupSelected } from '../../lib/actions';
import { EmptyState, Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { ObjectProperties } from '../panels/ObjectProperties';
import { TransformPanel } from '../panels/TransformPanel';
import { MaterialPanel } from '../panels/MaterialPanel';
import { TexturePanel } from '../panels/TexturePanel';
import { GeometryPanel } from '../panels/GeometryPanel';
import { AlignPanel } from '../panels/AlignPanel';

function MultiSelectionSummary({ count, names }: { count: number; names: string[] }) {
  return (
    <Section title="Object Properties">
      <div className="space-y-2">
        <p className="text-[12px] text-text" data-testid="multi-count">
          {count}개 오브젝트 선택됨
        </p>
        <ul className="max-h-24 space-y-0.5 overflow-auto text-[11px] text-muted">
          {names.map((n, i) => (
            <li key={i} className={`truncate ${i === names.length - 1 ? 'text-accent-2' : ''}`}>
              {n}
              {i === names.length - 1 ? ' (활성)' : ''}
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <Button variant="subtle" icon={<Copy size={12} />} onClick={duplicateSelected} title="복제 (Ctrl+D)">
            복제
          </Button>
          <Button variant="subtle" icon={<Group size={12} />} onClick={groupSelected} title="그룹으로 묶기 (Ctrl+G)">
            그룹
          </Button>
          <Button
            variant="subtle"
            icon={<Ungroup size={12} />}
            onClick={ungroupSelected}
            disabled={!canUngroupSelection()}
            title="그룹 해제 (Ctrl+Shift+G)"
          >
            해제
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function RightPanel() {
  useEngineRevision();
  const obj = engine.getSelected();
  const selected = engine.getSelectedObjects();
  const top = engine.getTopLevelSelection();

  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center border-b border-line px-3 text-[11px] font-medium text-muted">
        Properties
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!obj ? (
          <>
            <Section title="Object Properties">
              <EmptyState>뷰포트나 Scene Hierarchy에서 오브젝트를 선택하세요. (Ctrl/Shift+클릭으로 여러 개 선택)</EmptyState>
            </Section>
            <GeometryPanel object={engine.root} title="Scene Information" />
          </>
        ) : selected.length > 1 ? (
          <>
            <MultiSelectionSummary count={selected.length} names={selected.map((o) => o.name || o.type)} />
            <TransformPanel objects={top} />
            <AlignPanel count={top.length} />
            <Section title="Material">
              <EmptyState>재질은 오브젝트를 하나만 선택했을 때 편집할 수 있습니다.</EmptyState>
            </Section>
          </>
        ) : (
          <>
            <ObjectProperties key={`p-${obj.uuid}`} object={obj} />
            <TransformPanel objects={[obj]} />
            {isMesh(obj) ? (
              <>
                <MaterialPanel key={`m-${obj.uuid}`} mesh={obj} />
                <TexturePanel mesh={obj} />
              </>
            ) : (
              <Section title="Material">
                <EmptyState>
                  그룹/노드가 선택되었습니다. 재질을 편집하려면 하위 메시를 선택하세요. (뷰포트 상단의 선택 모드를
                  “메시”로 바꾸면 클릭으로 메시를 바로 선택할 수 있습니다.)
                </EmptyState>
              </Section>
            )}
            <AlignPanel count={1} />
            <GeometryPanel object={obj} />
          </>
        )}
      </div>
    </aside>
  );
}
