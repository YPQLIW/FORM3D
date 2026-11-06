import { useEffect, useRef } from 'react';
import type { Mesh } from 'three';
import {
  ChangeMaterialCommand,
  applyMaterialPatch,
  getMaterialCapabilities,
  getMaterials,
  readMaterial,
  snapshotMaterials,
  type MaterialSnapshot,
} from '@form3d/editor-core';
import type { MaterialData } from '@form3d/model-types';
import { engine } from '../../state/engine';
import { useAppStore } from '../../state/appStore';
import { Row, Section } from '../ui/Section';

const COMMIT_DELAY = 350;

/**
 * 재질 편집: 슬라이더/색상 변경은 즉시 화면에 반영하고,
 * 입력이 멈추면 하나의 ChangeMaterial 명령으로 기록합니다 (Undo 1회로 되돌림).
 */
function useLiveMaterialEdit(mesh: Mesh) {
  const pending = useRef<{ before: MaterialSnapshot[]; patch: Partial<MaterialData> } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (!p || Object.keys(p.patch).length === 0) return;
    try {
      engine.record(new ChangeMaterialCommand(mesh, p.patch, p.before));
    } catch (err) {
      useAppStore.getState().log('error', `재질 변경 실패: ${(err as Error).message}`);
    }
  };

  // 다른 오브젝트를 선택하거나 패널이 닫히면 즉시 기록
  useEffect(() => flush, [mesh]); // eslint-disable-line react-hooks/exhaustive-deps

  return (patch: Partial<MaterialData>) => {
    try {
      if (!pending.current) pending.current = { before: snapshotMaterials(mesh), patch: {} };
      applyMaterialPatch(mesh, patch);
      Object.assign(pending.current.patch, patch);
      engine.notify();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, COMMIT_DELAY);
    } catch (err) {
      useAppStore.getState().log('error', `재질 변경 실패: ${(err as Error).message}`);
    }
  };
}

function Slider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-9 text-right font-mono text-[11px] text-muted">{value.toFixed(2)}</span>
    </>
  );
}

export function MaterialPanel({ mesh }: { mesh: Mesh }) {
  const edit = useLiveMaterialEdit(mesh);
  const caps = getMaterialCapabilities(mesh);
  const m = readMaterial(mesh);
  const mats = getMaterials(mesh);

  return (
    <Section title="Material">
      <div className="space-y-1">
        <Row label="재질">
          <span className="truncate text-[11px]" title={mats.map((x) => x.type).join(', ')}>
            {mats[0]?.name || '(이름 없음)'}{' '}
            <span className="text-muted">
              {mats[0]?.type}
              {mats.length > 1 ? ` 외 ${mats.length - 1}개` : ''}
            </span>
          </span>
        </Row>
        <Row label="색상">
          <input
            type="color"
            aria-label="색상"
            disabled={!caps.color}
            value={m.color}
            onChange={(e) => edit({ color: e.target.value })}
            className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent p-0 disabled:opacity-40"
          />
          <span className="font-mono text-[11px] text-muted">{m.color}</span>
        </Row>
        <Row label="Metallic">
          {caps.metalness ? (
            <Slider label="Metallic" value={m.metalness} onChange={(v) => edit({ metalness: v })} />
          ) : (
            <span className="text-[11px] text-muted">이 재질 유형은 지원하지 않음</span>
          )}
        </Row>
        <Row label="Roughness">
          {caps.roughness ? (
            <Slider label="Roughness" value={m.roughness} onChange={(v) => edit({ roughness: v })} />
          ) : (
            <span className="text-[11px] text-muted">이 재질 유형은 지원하지 않음</span>
          )}
        </Row>
      </div>
    </Section>
  );
}
