import type { Object3D } from 'three';
import type { NodeSource, PrimitiveKind } from '@form3d/model-types';

/** FORM3D가 Object3D.userData에 저장하는 메타데이터 키 */
export const META_KEY = 'form3d';

export interface Form3DMeta {
  source: NodeSource;
  primitive?: PrimitiveKind;
  fileName?: string;
  fileSize?: number;
}

export function getMeta(obj: Object3D): Form3DMeta | undefined {
  const m = obj.userData?.[META_KEY];
  return m && typeof m === 'object' ? (m as Form3DMeta) : undefined;
}

export function setMeta(obj: Object3D, meta: Form3DMeta): void {
  obj.userData[META_KEY] = { ...meta };
}

export function getSource(obj: Object3D): NodeSource {
  return getMeta(obj)?.source ?? 'unknown';
}
