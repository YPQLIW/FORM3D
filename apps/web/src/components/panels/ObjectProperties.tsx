import { useEffect, useState } from 'react';
import type { Object3D } from 'three';
import { getMeta, getSource, PRIMITIVES } from '@form3d/editor-core';
import { formatBytes } from '@form3d/shared';
import { renameObject, toggleVisibility } from '../../lib/actions';
import { Row, Section } from '../ui/Section';

const SOURCE_LABEL = { primitive: '기본 도형', imported: '불러온 모델', group: '그룹', unknown: '기타' } as const;

export function ObjectProperties({ object }: { object: Object3D }) {
  const [name, setName] = useState(object.name);
  useEffect(() => {
    setName(object.name);
  }, [object, object.name]);
  const meta = getMeta(object);

  return (
    <Section title="Object Properties">
      <div className="space-y-1">
        <Row label="이름">
          <input
            aria-label="오브젝트 이름"
            className="h-6 w-full rounded border border-line bg-bg px-1.5 text-[12px] focus:border-accent focus:outline-none"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim()) setName(object.name);
              else renameObject(object, name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setName(object.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </Row>
        <Row label="유형">
          <span className="text-[11px]">
            {object.type}
            <span className="text-muted">
              {' · '}
              {SOURCE_LABEL[getSource(object)]}
              {meta?.primitive ? ` (${PRIMITIVES[meta.primitive]?.label ?? meta.primitive})` : ''}
            </span>
          </span>
        </Row>
        {meta?.fileName && (
          <Row label="원본 파일">
            <span className="truncate text-[11px]" title={meta.fileName}>
              {meta.fileName} <span className="text-muted">({formatBytes(meta.fileSize ?? 0)})</span>
            </span>
          </Row>
        )}
        <Row label="표시">
          <input
            type="checkbox"
            aria-label="표시"
            checked={object.visible}
            onChange={() => toggleVisibility(object)}
            className="accent-[var(--color-accent)]"
          />
        </Row>
      </div>
    </Section>
  );
}
