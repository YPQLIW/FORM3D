import type { Object3D } from 'three';
import { computeStats } from '@form3d/editor-core';
import { formatNumber } from '@form3d/shared';
import { Row, Section } from '../ui/Section';

export function GeometryPanel({ object, title = 'Geometry Information' }: { object: Object3D; title?: string }) {
  const s = computeStats(object);
  const items: [string, string][] = [
    ['메시', formatNumber(s.meshes)],
    ['정점', formatNumber(s.vertices)],
    ['삼각형', formatNumber(s.triangles)],
    ['재질', formatNumber(s.materials)],
    ['텍스처', formatNumber(s.textures)],
    ['크기 (W×H×D)', s.size ? s.size.map((v) => v.toFixed(2)).join(' × ') : '-'],
  ];
  return (
    <Section title={title}>
      <div className="space-y-0.5">
        {items.map(([k, v]) => (
          <Row key={k} label={k}>
            <span className="font-mono text-[11px]">{v}</span>
          </Row>
        ))}
      </div>
    </Section>
  );
}
