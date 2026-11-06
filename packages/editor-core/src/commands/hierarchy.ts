import { Group, Matrix4, Vector3, type Material, type Mesh, type Object3D } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { TransformData } from '@form3d/model-types';
import type { EditorCommand } from '../history';
import type { EditorEngine } from '../engine';
import { isGroupLike } from '../engine';
import { setMeta } from '../metadata';
import { applyTransform, readTransform } from './transform';

/** 부모의 children 배열에서 원하는 위치로 이동 (부모에 이미 들어 있어야 함) */
function moveToIndex(parent: Object3D, child: Object3D, index: number): void {
  const arr = parent.children;
  const cur = arr.indexOf(child);
  if (cur < 0) return;
  const target = Math.max(0, Math.min(index, arr.length - 1));
  if (cur === target) return;
  arr.splice(cur, 1);
  arr.splice(target, 0, child);
}

/** 원래 부모/순서/로컬 Transform 기록 (Undo에서 정확히 복원하기 위함) */
interface PlacementSnapshot {
  object: Object3D;
  parent: Object3D;
  index: number;
  transform: TransformData;
}

function snapshotPlacement(object: Object3D): PlacementSnapshot {
  const parent = object.parent;
  if (!parent) throw new Error(`씬에 없는 오브젝트입니다: ${object.name}`);
  return { object, parent, index: parent.children.indexOf(object), transform: readTransform(object) };
}

/** 스냅샷 목록을 원래 위치로 되돌림 (원래 순서대로 다시 끼워 넣음) */
function restorePlacements(snaps: PlacementSnapshot[]): void {
  for (const s of snaps) s.object.removeFromParent();
  const sorted = [...snaps].sort((a, b) => a.index - b.index);
  for (const s of sorted) {
    s.parent.add(s.object);
    moveToIndex(s.parent, s.object, s.index);
    applyTransform(s.object, s.transform);
  }
}

/** a가 b의 조상(또는 자기 자신)인지 */
export function isAncestorOf(a: Object3D, b: Object3D): boolean {
  let p: Object3D | null = b;
  while (p) {
    if (p === a) return true;
    p = p.parent;
  }
  return false;
}

/**
 * 애니메이션/스킨 모델의 "일부"는 구조를 바꾸면 뼈대·애니메이션 연결이 끊어집니다.
 * 이런 오브젝트를 복제/그룹/계층 이동하려 할 때 이유를 돌려줍니다 (가능하면 null).
 * 모델 전체(애니메이션을 가진 루트)는 자유롭게 옮기거나 복제할 수 있습니다.
 */
export function structureLockReason(obj: Object3D): string | null {
  if ((obj as { isBone?: boolean }).isBone) {
    return `"${obj.name}"은(는) 뼈대(Bone)라서 따로 옮기거나 복제할 수 없습니다. 모델 전체를 선택해 주세요.`;
  }
  let p = obj.parent;
  while (p) {
    if (p.animations?.length) {
      return `"${obj.name}"은(는) 애니메이션 모델 "${p.name}"의 일부라서 따로 옮기거나 복제할 수 없습니다. 모델 전체를 선택해 주세요.`;
    }
    p = p.parent;
  }
  const skinned = obj as { isSkinnedMesh?: boolean; skeleton?: { bones: Object3D[] } };
  if (skinned.isSkinnedMesh && skinned.skeleton?.bones.some((b) => !isAncestorOf(obj, b))) {
    return `"${obj.name}"은(는) 다른 노드의 뼈대에 연결된 스킨 메시라서 따로 옮기거나 복제할 수 없습니다.`;
  }
  return null;
}

function assertStructureEditable(objects: Object3D[]): void {
  for (const o of objects) {
    const reason = structureLockReason(o);
    if (reason) throw new Error(reason);
  }
}

/** 이름 끝의 ".001" 같은 번호를 제거 */
export function baseNameOf(name: string): string {
  return name.replace(/\.\d{3,}$/, '') || 'Object';
}

/**
 * 오브젝트를 깊은 복제합니다.
 * - 스킨/뼈대가 있는 모델은 SkeletonUtils로 뼈대 연결까지 복제
 * - 재질은 복제하여 원본과 독립적으로 편집 가능 (지오메트리·텍스처는 공유해 메모리 절약)
 */
export function cloneObjectDeep(source: Object3D): Object3D {
  const copy = skeletonClone(source);
  const materialMap = new Map<Material, Material>();
  const cloneMat = (m: Material) => {
    let c = materialMap.get(m);
    if (!c) {
      c = m.clone();
      materialMap.set(m, c);
    }
    return c;
  };
  copy.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.material) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMat) : cloneMat(mesh.material);
    }
  });
  return copy;
}

export interface DuplicateOptions {
  /** 복제본을 원본 기준으로 이동할 월드 좌표 오프셋 */
  worldOffset?: [number, number, number];
}

/** 선택한 오브젝트들을 복제해 원본 바로 뒤에 배치하고, 복제본을 선택합니다. */
export class DuplicateObjectsCommand implements EditorCommand {
  readonly name = 'DuplicateObject' as const;
  readonly label: string;
  private readonly entries: { source: Object3D; copy: Object3D | null; parent: Object3D | null }[];
  private readonly offset: Vector3;
  private selectionBefore: string[] = [];

  constructor(sources: Object3D[], options: DuplicateOptions = {}) {
    if (sources.length === 0) throw new Error('복제할 오브젝트가 없습니다.');
    assertStructureEditable(sources);
    this.entries = sources.map((source) => ({ source, copy: null, parent: null }));
    this.offset = new Vector3().fromArray(options.worldOffset ?? [0, 0, 0]);
    this.label =
      sources.length === 1 ? `복제: ${sources[0].name}` : `복제: ${sources.length}개 오브젝트`;
  }

  /** 복제본 목록 (실행 후) */
  get copies(): Object3D[] {
    return this.entries.map((e) => e.copy).filter((c): c is Object3D => !!c);
  }

  execute(engine: EditorEngine): void {
    this.selectionBefore = [...engine.getSelectedIds()];
    for (const e of this.entries) {
      if (!e.copy) {
        const parent = e.source.parent;
        if (!parent || !engine.isInScene(e.source)) throw new Error(`씬에 없는 오브젝트입니다: ${e.source.name}`);
        const copy = cloneObjectDeep(e.source);
        copy.name = engine.uniqueName(baseNameOf(e.source.name));
        if (this.offset.lengthSq() > 0) {
          parent.updateWorldMatrix(true, false);
          const wp = e.source.getWorldPosition(new Vector3()).add(this.offset);
          copy.position.copy(parent.worldToLocal(wp));
        }
        e.copy = copy;
        e.parent = parent;
      }
      const parent = e.parent!;
      parent.add(e.copy);
      moveToIndex(parent, e.copy, parent.children.indexOf(e.source) + 1);
    }
    engine.setSelection(this.copies.map((c) => c.uuid));
  }

  undo(engine: EditorEngine): void {
    for (const e of this.entries) e.copy?.removeFromParent();
    engine.validateSelection();
    engine.setSelection(this.selectionBefore);
  }
}

/**
 * 여러 오브젝트를 새 그룹으로 묶습니다.
 * - 그룹 원점은 선택 영역의 중심, 각 오브젝트의 월드 위치/회전/크기는 그대로 유지
 * - 모두 같은 부모면 그 부모 안에, 아니면 씬 최상위에 그룹을 만듭니다.
 */
export class GroupObjectsCommand implements EditorCommand {
  readonly name = 'GroupObjects' as const;
  readonly label: string;
  readonly group: Group;
  private snaps: PlacementSnapshot[] = [];
  private selectionBefore: string[] = [];

  constructor(
    private readonly objects: Object3D[],
    groupName = 'Group',
  ) {
    if (objects.length === 0) throw new Error('그룹으로 묶을 오브젝트가 없습니다.');
    assertStructureEditable(objects);
    for (const a of objects) {
      for (const b of objects) {
        if (a !== b && isAncestorOf(a, b)) {
          throw new Error(`"${a.name}" 안에 "${b.name}"이(가) 들어 있어 함께 그룹화할 수 없습니다.`);
        }
      }
    }
    this.group = new Group();
    this.group.name = groupName;
    setMeta(this.group, { source: 'group' });
    this.label = `그룹화: ${objects.length}개 → ${groupName}`;
  }

  execute(engine: EditorEngine): void {
    this.selectionBefore = [...engine.getSelectedIds()];
    this.snaps = this.objects.map(snapshotPlacement);
    const parents = new Set(this.snaps.map((s) => s.parent));
    const parent = parents.size === 1 ? this.snaps[0].parent : engine.root;
    const insertIndex =
      parents.size === 1 ? Math.min(...this.snaps.map((s) => s.index)) : parent.children.length;

    // 그룹 원점 = 선택 영역 중심 (부모 로컬 좌표로 변환)
    const center = engine.getUnionBounds(this.objects)?.getCenter(new Vector3()) ?? new Vector3();
    parent.updateWorldMatrix(true, false);
    this.group.position.copy(parent.worldToLocal(center.clone()));
    this.group.rotation.set(0, 0, 0);
    this.group.scale.set(1, 1, 1);
    parent.add(this.group);
    moveToIndex(parent, this.group, insertIndex);
    this.group.updateMatrixWorld(true);

    // 호출 측이 넘긴 순서(씬 계층 순서)대로 넣어 원래 순서를 유지
    for (const s of this.snaps) this.group.attach(s.object);
    engine.setSelection([this.group.uuid]);
  }

  undo(engine: EditorEngine): void {
    this.group.removeFromParent();
    restorePlacements(this.snaps);
    engine.validateSelection();
    engine.setSelection(this.selectionBefore);
  }
}

/** 그룹을 해제할 수 없는 이유 (가능하면 null) */
export function ungroupBlocker(obj: Object3D): string | null {
  if (!isGroupLike(obj)) return `"${obj.name}"은(는) 자식이 있는 그룹이 아닙니다.`;
  if (obj.animations?.length) {
    return `"${obj.name}"에는 애니메이션이 있어 그룹을 해제하면 애니메이션 연결이 끊어집니다.`;
  }
  let hasBone = false;
  obj.traverse((o) => {
    if ((o as { isBone?: boolean }).isBone || (o as { isSkinnedMesh?: boolean }).isSkinnedMesh) hasBone = true;
  });
  if (hasBone) return `"${obj.name}"에는 뼈대(스킨)가 있어 그룹을 해제할 수 없습니다.`;
  return null;
}

/** 그룹을 해제: 자식들을 그룹의 부모로 옮기고(월드 Transform 유지) 그룹 노드를 제거합니다. */
export class UngroupObjectCommand implements EditorCommand {
  readonly name = 'UngroupObject' as const;
  readonly label: string;
  private parent: Object3D | null = null;
  private index = 0;
  private children: { object: Object3D; transform: TransformData }[] = [];
  private selectionBefore: string[] = [];

  constructor(private readonly group: Object3D) {
    const reason = ungroupBlocker(group);
    if (reason) throw new Error(reason);
    this.label = `그룹 해제: ${group.name}`;
  }

  execute(engine: EditorEngine): void {
    this.selectionBefore = [...engine.getSelectedIds()];
    const parent = this.group.parent;
    if (!parent) throw new Error('이미 씬에서 제거된 그룹입니다.');
    this.parent = parent;
    this.index = parent.children.indexOf(this.group);
    this.children = this.group.children.map((object) => ({ object, transform: readTransform(object) }));
    parent.updateWorldMatrix(true, true);
    this.children.forEach(({ object }, i) => {
      parent.attach(object);
      moveToIndex(parent, object, this.index + 1 + i);
    });
    this.group.removeFromParent();
    engine.setSelection(this.children.map((c) => c.object.uuid));
  }

  undo(engine: EditorEngine): void {
    if (!this.parent) return;
    this.parent.add(this.group);
    moveToIndex(this.parent, this.group, this.index);
    for (const { object, transform } of this.children) {
      this.group.add(object);
      applyTransform(object, transform);
    }
    engine.validateSelection();
    engine.setSelection(this.selectionBefore);
  }
}

/**
 * 오브젝트를 다른 부모 아래로 옮기거나 같은 부모 안에서 순서를 바꿉니다 (월드 Transform 유지).
 * @param before 이 형제 바로 앞에 넣음. null이면 맨 뒤.
 */
export class ReparentObjectCommand implements EditorCommand {
  readonly name = 'ReparentObject' as const;
  readonly label: string;
  private snap: PlacementSnapshot | null = null;

  constructor(
    private readonly object: Object3D,
    private readonly newParent: Object3D,
    private readonly before: Object3D | null = null,
  ) {
    if (isAncestorOf(object, newParent)) {
      throw new Error(`"${object.name}"을(를) 자기 자신의 하위로 옮길 수 없습니다.`);
    }
    if (before && before.parent !== newParent) throw new Error('삽입 기준 오브젝트의 부모가 다릅니다.');
    assertStructureEditable([object]);
    if (newParent !== object.parent) {
      // 애니메이션 모델 내부로 다른 오브젝트를 넣는 것도 막음 (애니메이션 대상 이름 충돌 방지)
      let p: Object3D | null = newParent;
      while (p) {
        if (p.animations?.length) throw new Error(`애니메이션 모델 "${p.name}" 안으로는 옮길 수 없습니다.`);
        p = p.parent;
      }
    }
    this.label = `계층 이동: ${object.name} → ${newParent.name || 'Scene'}`;
  }

  execute(engine: EditorEngine): void {
    if (!engine.isInScene(this.newParent)) throw new Error('대상 부모가 씬에 없습니다.');
    this.snap = snapshotPlacement(this.object);
    this.newParent.updateWorldMatrix(true, false);
    this.object.parent!.updateWorldMatrix(true, false);
    this.newParent.attach(this.object);
    if (this.before && this.before !== this.object) {
      moveToIndex(this.newParent, this.object, this.newParent.children.indexOf(this.before));
    }
  }

  undo(): void {
    if (this.snap) restorePlacements([this.snap]);
  }
}

/** 오브젝트의 부모 기준 로컬 행렬을 월드 행렬로부터 계산 */
export function localFromWorld(object: Object3D, world: Matrix4): Matrix4 {
  const parent = object.parent;
  if (!parent) return world.clone();
  parent.updateWorldMatrix(true, false);
  return new Matrix4().copy(parent.matrixWorld).invert().multiply(world);
}
