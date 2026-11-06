import { Color, type Material, type Mesh, type Object3D } from 'three';
import type { MaterialData } from '@form3d/model-types';
import { clamp } from '@form3d/shared';
import type { EditorCommand } from '../history';

/** color / metalness / roughness 를 가질 수 있는 재질 (Standard, Physical 등) */
type EditableMaterial = Material & {
  color?: Color;
  metalness?: number;
  roughness?: number;
};

export function isMesh(obj: Object3D | null | undefined): obj is Mesh {
  return !!obj && (obj as Mesh).isMesh === true;
}

export function getMaterials(mesh: Mesh): EditableMaterial[] {
  const m = mesh.material;
  return (Array.isArray(m) ? m : [m]).filter(Boolean) as EditableMaterial[];
}

export interface MaterialCapabilities {
  color: boolean;
  metalness: boolean;
  roughness: boolean;
}

export function getMaterialCapabilities(mesh: Mesh): MaterialCapabilities {
  const mats = getMaterials(mesh);
  return {
    color: mats.some((m) => m.color instanceof Color),
    metalness: mats.some((m) => typeof m.metalness === 'number'),
    roughness: mats.some((m) => typeof m.roughness === 'number'),
  };
}

/** 첫 번째 재질 기준 대표값 (UI 표시용) */
export function readMaterial(mesh: Mesh): MaterialData {
  const mats = getMaterials(mesh);
  const withColor = mats.find((m) => m.color instanceof Color);
  const withMetal = mats.find((m) => typeof m.metalness === 'number');
  const withRough = mats.find((m) => typeof m.roughness === 'number');
  return {
    color: withColor?.color ? `#${withColor.color.getHexString()}` : '#ffffff',
    metalness: withMetal?.metalness ?? 0,
    roughness: withRough?.roughness ?? 1,
  };
}

interface MaterialSnapshot {
  color?: number;
  metalness?: number;
  roughness?: number;
}

export function snapshotMaterials(mesh: Mesh): MaterialSnapshot[] {
  return getMaterials(mesh).map((m) => ({
    color: m.color instanceof Color ? m.color.getHex() : undefined,
    metalness: typeof m.metalness === 'number' ? m.metalness : undefined,
    roughness: typeof m.roughness === 'number' ? m.roughness : undefined,
  }));
}

function restoreSnapshot(mesh: Mesh, snaps: MaterialSnapshot[]): void {
  getMaterials(mesh).forEach((m, i) => {
    const s = snaps[i];
    if (!s) return;
    if (s.color !== undefined && m.color) m.color.setHex(s.color);
    if (s.metalness !== undefined) m.metalness = s.metalness;
    if (s.roughness !== undefined) m.roughness = s.roughness;
    m.needsUpdate = true;
  });
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validateMaterialPatch(patch: Partial<MaterialData>): Partial<MaterialData> {
  const out: Partial<MaterialData> = {};
  if (patch.color !== undefined) {
    if (!HEX_RE.test(patch.color)) throw new Error(`잘못된 색상 값: ${patch.color}`);
    out.color = patch.color.toLowerCase();
  }
  if (patch.metalness !== undefined) {
    if (!Number.isFinite(patch.metalness)) throw new Error('Metallic 값이 숫자가 아닙니다.');
    out.metalness = clamp(patch.metalness, 0, 1);
  }
  if (patch.roughness !== undefined) {
    if (!Number.isFinite(patch.roughness)) throw new Error('Roughness 값이 숫자가 아닙니다.');
    out.roughness = clamp(patch.roughness, 0, 1);
  }
  return out;
}

/** 메시의 모든 편집 가능한 재질에 값을 적용 (원본 텍스처/기타 속성은 유지) */
export function applyMaterialPatch(mesh: Mesh, patch: Partial<MaterialData>): void {
  const p = validateMaterialPatch(patch);
  for (const m of getMaterials(mesh)) {
    if (p.color !== undefined && m.color instanceof Color) m.color.set(p.color);
    if (p.metalness !== undefined && typeof m.metalness === 'number') m.metalness = p.metalness;
    if (p.roughness !== undefined && typeof m.roughness === 'number') m.roughness = p.roughness;
    m.needsUpdate = true;
  }
}

export class ChangeMaterialCommand implements EditorCommand {
  readonly name = 'ChangeMaterial' as const;
  readonly label: string;
  private readonly patch: Partial<MaterialData>;

  /**
   * @param before 변경 전 스냅샷. 슬라이더처럼 이미 실시간 적용된 경우 시작 시점 값을 전달합니다.
   */
  constructor(
    private readonly mesh: Mesh,
    patch: Partial<MaterialData>,
    private readonly before: MaterialSnapshot[] = snapshotMaterials(mesh),
  ) {
    this.patch = validateMaterialPatch(patch);
    const keys = Object.keys(this.patch).join(', ');
    this.label = `재질 변경 (${keys}): ${mesh.name}`;
  }

  execute(): void {
    applyMaterialPatch(this.mesh, this.patch);
  }

  undo(): void {
    restoreSnapshot(this.mesh, this.before);
  }
}

export type { MaterialSnapshot };
