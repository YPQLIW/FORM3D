import { Box3, Vector3, type Object3D } from 'three';
import type { AlignMode, AxisIndex, TransformData } from '@form3d/model-types';
import { CompositeCommand } from './commands/composite';
import { SetTransformCommand, readTransform, transformsEqual } from './commands/transform';

/**
 * 정렬·분배·스냅 계산.
 * 모든 계산은 월드 좌표(바운딩 박스) 기준이며, 결과는 부모 기준 로컬 위치로 변환해
 * SetTransform 명령 묶음(CompositeCommand)으로 반환합니다. → Undo 1회로 전체 복원.
 */

const AXIS_NAME = ['X', 'Y', 'Z'] as const;
const MODE_NAME: Record<AlignMode, string> = { min: '최소', center: '중앙', max: '최대' };

function worldBounds(o: Object3D): Box3 {
  o.updateWorldMatrix(true, true);
  const b = new Box3().setFromObject(o, true);
  if (b.isEmpty()) {
    const p = o.getWorldPosition(new Vector3());
    b.set(p.clone(), p.clone());
  }
  return b;
}

function pick(box: Box3, axis: AxisIndex, mode: AlignMode): number {
  if (mode === 'min') return box.min.getComponent(axis);
  if (mode === 'max') return box.max.getComponent(axis);
  return (box.min.getComponent(axis) + box.max.getComponent(axis)) / 2;
}

/** 오브젝트를 월드 기준으로 delta만큼 옮긴 Transform 계산 */
function translatedWorld(o: Object3D, delta: Vector3): TransformData {
  const before = readTransform(o);
  const wp = o.getWorldPosition(new Vector3()).add(delta);
  const local = o.parent ? (o.parent.updateWorldMatrix(true, false), o.parent.worldToLocal(wp)) : wp;
  return { ...before, position: [local.x, local.y, local.z] };
}

export interface TransformChange {
  object: Object3D;
  before: TransformData;
  after: TransformData;
}

/** 실제로 바뀐 항목만 명령으로 묶음. 바뀐 것이 없으면 null */
export function changesToCommand(
  changes: TransformChange[],
  label: string,
  name: 'AlignObjects' | 'SetTransform' = 'AlignObjects',
): CompositeCommand | null {
  const real = changes.filter((c) => !transformsEqual(c.before, c.after, 1e-9));
  if (real.length === 0) return null;
  return new CompositeCommand(
    name,
    label,
    real.map((c) => new SetTransformCommand(c.object, c.before, c.after, `${label}: ${c.object.name}`)),
  );
}

export type AlignReference = 'selection' | 'active';

/**
 * 정렬: 축(axis)의 최소/중앙/최대 면을 기준에 맞춥니다.
 * - reference 'selection': 선택 전체 영역 기준
 * - reference 'active': 활성 오브젝트 기준 (활성 오브젝트는 움직이지 않음)
 */
export function computeAlign(
  objects: Object3D[],
  axis: AxisIndex,
  mode: AlignMode,
  reference: AlignReference = 'selection',
  active?: Object3D | null,
): TransformChange[] {
  if (objects.length === 0) return [];
  let target: number;
  if (reference === 'active' && active) {
    target = pick(worldBounds(active), axis, mode);
  } else {
    const union = new Box3();
    objects.forEach((o) => union.union(worldBounds(o)));
    target = pick(union, axis, mode);
  }
  return objects
    .filter((o) => !(reference === 'active' && o === active))
    .map((o) => {
      const delta = new Vector3();
      delta.setComponent(axis, target - pick(worldBounds(o), axis, mode));
      return { object: o, before: readTransform(o), after: translatedWorld(o, delta) };
    });
}

export function alignLabel(axis: AxisIndex, mode: AlignMode, count: number): string {
  return `정렬 ${AXIS_NAME[axis]} ${MODE_NAME[mode]} (${count}개)`;
}

/** 균등 분배: 양 끝 오브젝트는 고정하고, 중심 간격이 같도록 배치 (3개 이상) */
export function computeDistribute(objects: Object3D[], axis: AxisIndex): TransformChange[] {
  if (objects.length < 3) return [];
  const items = objects
    .map((o) => ({ o, c: pick(worldBounds(o), axis, 'center') }))
    .sort((a, b) => a.c - b.c);
  const first = items[0].c;
  const step = (items[items.length - 1].c - first) / (items.length - 1);
  return items.map(({ o, c }, i) => {
    const delta = new Vector3();
    delta.setComponent(axis, first + step * i - c);
    return { object: o, before: readTransform(o), after: translatedWorld(o, delta) };
  });
}

/** 바닥에 놓기: 바운딩 박스 바닥(Y 최소)을 floorY에 맞춤 */
export function computeDropToFloor(objects: Object3D[], floorY = 0): TransformChange[] {
  return objects.map((o) => {
    const delta = new Vector3(0, floorY - worldBounds(o).min.y, 0);
    return { object: o, before: readTransform(o), after: translatedWorld(o, delta) };
  });
}

/** 그리드에 스냅: 월드 위치를 step 단위로 반올림 */
export function computeSnapToGrid(objects: Object3D[], step: number): TransformChange[] {
  if (!(step > 0) || !Number.isFinite(step)) throw new Error('스냅 간격은 0보다 커야 합니다.');
  return objects.map((o) => {
    const wp = o.getWorldPosition(new Vector3());
    const snapped = new Vector3(
      Math.round(wp.x / step) * step,
      Math.round(wp.y / step) * step,
      Math.round(wp.z / step) * step,
    );
    return { object: o, before: readTransform(o), after: translatedWorld(o, snapped.sub(wp)) };
  });
}
