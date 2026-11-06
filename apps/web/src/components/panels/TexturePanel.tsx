import type { Mesh } from 'three';
import { getTextureInfo } from '@form3d/editor-core';
import { EmptyState, Section } from '../ui/Section';

/** 재질에 연결된 텍스처 정보 (읽기 전용 — 텍스처 교체는 이후 단계) */
export function TexturePanel({ mesh }: { mesh: Mesh }) {
  const list = getTextureInfo(mesh);
  return (
    <Section title="Texture" defaultOpen={list.length > 0}>
      {list.length === 0 ? (
        <EmptyState>연결된 텍스처가 없습니다.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {list.map((t, i) => (
            <li key={`${t.slot}-${i}`} className="flex items-center justify-between rounded bg-bg px-2 py-1">
              <span className="font-mono text-[11px] text-accent">{t.slot}</span>
              <span className="truncate pl-2 text-[11px] text-muted" title={t.name}>
                {t.width && t.height ? `${t.width}×${t.height}` : t.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
