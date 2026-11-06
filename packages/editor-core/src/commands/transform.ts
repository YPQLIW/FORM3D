import type { Object3D } from 'three';
import type { TransformData } from '@form3d/model-types';
import type { EditorCommand } from '../history';

export function readTransform(obj: Object3D): TransformData {
  return {
    position: obj.position.toArray() as TransformData['position'],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: obj.scale.toArray() as TransformData['scale'],
  };
}

export function applyTransform(obj: Object3D, t: TransformData): void {
  obj.position.fromArray(t.position);
  obj.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  obj.scale.fromArray(t.scale);
  obj.updateMatrixWorld(true);
}

export function transformsEqual(a: TransformData, b: TransformData, eps = 1e-9): boolean {
  const keys = ['position', 'rotation', 'scale'] as const;
  return keys.every((k) => a[k].every((v, i) => Math.abs(v - b[k][i]) <= eps));
}

export function isValidTransform(t: TransformData): boolean {
  return [...t.position, ...t.rotation, ...t.scale].every((v) => Number.isFinite(v));
}

export class SetTransformCommand implements EditorCommand {
  readonly name = 'SetTransform' as const;
  readonly label: string;

  constructor(
    private readonly object: Object3D,
    private readonly before: TransformData,
    private readonly after: TransformData,
    label?: string,
  ) {
    if (!isValidTransform(after)) throw new Error('유효하지 않은 Transform 값입니다.');
    this.label = label ?? `Transform: ${object.name}`;
  }

  execute(): void {
    applyTransform(this.object, this.after);
  }

  undo(): void {
    applyTransform(this.object, this.before);
  }
}
