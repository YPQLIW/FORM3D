import { describe, expect, it } from 'vitest';
import { AnimationClip, Bone, Group, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { evaluateExpression } from '@form3d/shared';
import {
  AddObjectCommand,
  CompositeCommand,
  DuplicateObjectsCommand,
  EditorEngine,
  GroupObjectsCommand,
  RemoveObjectCommand,
  ReparentObjectCommand,
  SetTransformCommand,
  UngroupObjectCommand,
  alignLabel,
  changesToCommand,
  computeAlign,
  computeDistribute,
  computeDropToFloor,
  computeSnapToGrid,
  createPrimitive,
  findMtlLibs,
  parseObj,
  pickMainModelFile,
  readTransform,
  structureLockReason,
  ungroupBlocker,
  validateObjContent,
} from './index';

const wp = (o: Object3D) => o.getWorldPosition(new Vector3()).toArray().map((v) => +v.toFixed(6));
const names = (o: Object3D) => o.children.map((c) => c.name);

function setup(n = 3) {
  const e = new EditorEngine();
  const objs = Array.from({ length: n }, (_, i) => {
    const m = createPrimitive('box', String.fromCharCode(65 + i));
    m.position.set(i * 2, 0.5, 0);
    e.execute(new AddObjectCommand(m));
    return m;
  });
  e.history.clear();
  return { e, objs };
}

describe('다중 선택', () => {
  it('select / toggle / setSelection / selectAll, 활성 오브젝트는 마지막 항목', () => {
    const { e, objs } = setup();
    const [a, b, c] = objs;
    e.select(a.uuid);
    e.toggleSelection(b.uuid);
    expect(e.getSelectedIds()).toEqual([a.uuid, b.uuid]);
    expect(e.getSelected()).toBe(b);
    e.toggleSelection(a.uuid);
    expect(e.getSelectedIds()).toEqual([b.uuid]);
    e.selectAll();
    expect(e.getSelectedObjects()).toEqual([a, b, c]);
    e.setSelection([c.uuid, c.uuid, 'nope']);
    expect(e.getSelectedIds()).toEqual([c.uuid]);
    e.select(null);
    expect(e.getSelected()).toBeNull();
  });

  it('부모와 자식을 함께 선택하면 최상위만 반환', () => {
    const { e, objs } = setup();
    const [a, b] = objs;
    a.add(b);
    e.setSelection([b.uuid, a.uuid]);
    expect(e.getTopLevelSelection()).toEqual([a]);
  });

  it('삭제 묶음 Undo 시 선택도 복원', () => {
    const { e, objs } = setup();
    e.setSelection([objs[0].uuid, objs[2].uuid]);
    e.execute(new CompositeCommand('Batch', '삭제', e.getTopLevelSelection().map((o) => new RemoveObjectCommand(o))));
    expect(names(e.root)).toEqual(['B']);
    expect(e.getSelectedIds()).toEqual([]);
    e.undo();
    expect(names(e.root)).toEqual(['A', 'B', 'C']);
    expect(e.getSelectedIds()).toEqual([objs[0].uuid, objs[2].uuid]);
  });

  it('CompositeCommand는 중간 실패 시 이미 실행한 것을 되돌림', () => {
    const { e, objs } = setup();
    const bad = { name: 'Batch', label: 'bad', execute: () => { throw new Error('x'); }, undo: () => {} } as const;
    const move = new SetTransformCommand(objs[0], readTransform(objs[0]), { ...readTransform(objs[0]), position: [9, 9, 9] });
    expect(() => e.execute(new CompositeCommand('Batch', 't', [move, bad]))).toThrow('x');
    expect(objs[0].position.x).toBe(0);
  });
});

describe('복제', () => {
  it('원본 뒤에 고유 이름으로 복제, 재질은 독립, Undo/Redo', () => {
    const { e, objs } = setup();
    const [a] = objs;
    const cmd = new DuplicateObjectsCommand([a], { worldOffset: [1, 0, 0] });
    e.execute(cmd);
    expect(names(e.root)).toEqual(['A', 'A.001', 'B', 'C']);
    const copy = cmd.copies[0] as Mesh;
    expect(e.getSelectedIds()).toEqual([copy.uuid]);
    expect(wp(copy)).toEqual([1, 0.5, 0]);
    (copy.material as MeshStandardMaterial).color.set('#ff0000');
    expect((a.material as MeshStandardMaterial).color.getHexString()).toBe('9aa4b5');
    expect(copy.geometry).toBe(a.geometry);
    e.undo();
    expect(names(e.root)).toEqual(['A', 'B', 'C']);
    e.redo();
    expect(e.root.children[1]).toBe(copy);
    // 복제본을 다시 복제하면 A.002
    e.execute(new DuplicateObjectsCommand([copy]));
    expect(e.root.children[2].name).toBe('A.002');
  });

  it('하위 계층까지 깊게 복제', () => {
    const { e, objs } = setup(2);
    objs[0].add(objs[1]);
    const cmd = new DuplicateObjectsCommand([objs[0]]);
    e.execute(cmd);
    expect(cmd.copies[0].children.length).toBe(1);
    expect(cmd.copies[0].children[0]).not.toBe(objs[1]);
  });
});

describe('그룹화 / 그룹 해제', () => {
  it('월드 위치를 유지하며 그룹화하고, 그룹 원점은 선택 중심', () => {
    const { e, objs } = setup();
    const [a, , c] = objs;
    const before = objs.map(wp);
    const cmd = new GroupObjectsCommand([a, c], 'Group');
    e.execute(cmd);
    expect(names(e.root)).toEqual(['Group', 'B']);
    expect(names(cmd.group)).toEqual(['A', 'C']);
    expect(wp(cmd.group)).toEqual([2, 0.5, 0]);
    expect(objs.map(wp)).toEqual(before);
    expect(e.getSelectedIds()).toEqual([cmd.group.uuid]);
    e.undo();
    expect(names(e.root)).toEqual(['A', 'B', 'C']);
    expect(objs.map(wp)).toEqual(before);
    expect(a.position.toArray()).toEqual([0, 0.5, 0]);
    e.redo();
    expect(e.root.children[0]).toBe(cmd.group);
  });

  it('그룹을 회전한 뒤 해제해도 월드 Transform 유지', () => {
    const { e, objs } = setup();
    const g = new GroupObjectsCommand([objs[0], objs[1]]);
    e.execute(g);
    g.group.rotation.y = Math.PI / 2;
    g.group.updateMatrixWorld(true);
    const worldBefore = [objs[0], objs[1]].map(wp);
    e.execute(new UngroupObjectCommand(g.group));
    expect(names(e.root)).toEqual(['A', 'B', 'C']);
    expect([objs[0], objs[1]].map(wp)).toEqual(worldBefore);
    expect(objs[0].rotation.y).toBeCloseTo(Math.PI / 2);
    e.undo();
    expect(names(e.root)).toEqual(['Group', 'C']);
    expect(objs[0].rotation.y).toBeCloseTo(0);
  });

  it('메시나 애니메이션 모델은 그룹 해제 거부', () => {
    const m = createPrimitive('box');
    expect(ungroupBlocker(m)).toMatch(/그룹이 아닙니다/);
    const g = new Group();
    g.add(createPrimitive('box'));
    expect(ungroupBlocker(g)).toBeNull();
    g.animations = [{} as never];
    expect(() => new UngroupObjectCommand(g)).toThrow(/애니메이션/);
  });

  it('부모-자식 관계인 오브젝트를 함께 그룹화하면 거부', () => {
    const { objs } = setup(2);
    objs[0].add(objs[1]);
    expect(() => new GroupObjectsCommand([objs[0], objs[1]])).toThrow();
  });
});

describe('계층 이동 (Reparent)', () => {
  it('다른 부모로 옮기고 순서를 바꾸며 월드 위치 유지, Undo로 원위치', () => {
    const { e, objs } = setup();
    const [a, b, c] = objs;
    a.position.set(5, 0, 0);
    a.updateMatrixWorld();
    const cw = wp(c);
    e.execute(new ReparentObjectCommand(c, a));
    expect(names(a)).toEqual(['C']);
    expect(wp(c)).toEqual(cw);
    e.execute(new ReparentObjectCommand(b, e.root, a)); // B를 A 앞으로
    expect(names(e.root)).toEqual(['B', 'A']);
    e.undo();
    e.undo();
    expect(names(e.root)).toEqual(['A', 'B', 'C']);
    expect(c.position.toArray()).toEqual([4, 0.5, 0]);
  });

  it('자기 하위로 이동은 거부', () => {
    const { objs } = setup(2);
    objs[0].add(objs[1]);
    expect(() => new ReparentObjectCommand(objs[0], objs[1])).toThrow(/하위/);
  });
});

describe('애니메이션/스킨 모델 보호', () => {
  it('애니메이션 모델의 일부·뼈대는 복제/그룹/계층 이동 거부, 모델 전체는 허용', () => {
    const { e, objs } = setup(1);
    const model = new Group();
    model.name = 'Fox';
    model.animations = [new AnimationClip('Run', 1, [])];
    const bone = new Bone();
    bone.name = 'hip';
    const part = createPrimitive('box', 'Body');
    model.add(bone, part);
    e.execute(new AddObjectCommand(model));
    expect(structureLockReason(model)).toBeNull();
    expect(structureLockReason(bone)).toMatch(/뼈대/);
    expect(structureLockReason(part)).toMatch(/애니메이션 모델 "Fox"의 일부/);
    expect(() => new DuplicateObjectsCommand([part])).toThrow(/일부/);
    expect(() => new GroupObjectsCommand([part, objs[0]])).toThrow(/일부/);
    expect(() => new ReparentObjectCommand(part, e.root)).toThrow(/일부/);
    expect(() => new ReparentObjectCommand(objs[0], model)).toThrow(/안으로는/);
    expect(() => new DuplicateObjectsCommand([model])).not.toThrow();
    expect(() => new ReparentObjectCommand(model, objs[0])).not.toThrow();
  });
});

describe('정렬 / 분배 / 스냅', () => {
  it('X 최소 정렬 (선택 영역 기준) + Undo 1회', () => {
    const { e, objs } = setup();
    const cmd = changesToCommand(computeAlign(objs, 0, 'min'), alignLabel(0, 'min', 3))!;
    e.execute(cmd);
    expect(objs.map((o) => +o.position.x.toFixed(6))).toEqual([0, 0, 0]);
    e.undo();
    expect(objs.map((o) => o.position.x)).toEqual([0, 2, 4]);
  });

  it('활성 오브젝트 기준 정렬 시 활성 오브젝트는 그대로', () => {
    const { objs } = setup();
    const ch = computeAlign(objs, 0, 'max', 'active', objs[1]);
    expect(ch.map((c) => c.object)).toEqual([objs[0], objs[2]]);
    expect(ch.map((c) => +c.after.position[0].toFixed(6))).toEqual([2, 2]);
  });

  it('균등 분배', () => {
    const { objs } = setup();
    objs[1].position.x = 0.5;
    const ch = computeDistribute(objs, 0);
    const xs = ch.map((c) => +c.after.position[0].toFixed(6)).sort((a, b) => a - b);
    expect(xs).toEqual([0, 2, 4]);
    expect(computeDistribute(objs.slice(0, 2), 0)).toEqual([]);
  });

  it('바닥에 놓기 / 그리드 스냅 (부모가 있어도 월드 기준)', () => {
    const { e, objs } = setup(2);
    objs[0].position.set(0.3, 3, -0.74);
    const parent = new Group();
    parent.position.set(0, 1, 0);
    parent.scale.set(2, 2, 2);
    e.root.add(parent);
    parent.add(objs[1]);
    objs[1].position.set(0, 0, 0);
    const floor = computeDropToFloor([objs[0], objs[1]]);
    e.execute(changesToCommand(floor, '바닥')!);
    expect(+e.getWorldBounds(objs[0])!.min.y.toFixed(6)).toBe(0);
    expect(+e.getWorldBounds(objs[1])!.min.y.toFixed(6)).toBe(0);
    e.execute(changesToCommand(computeSnapToGrid([objs[0]], 0.5), '스냅')!);
    expect(wp(objs[0])).toEqual([0.5, 0.5, -0.5]);
    expect(() => computeSnapToGrid([objs[0]], 0)).toThrow();
  });

  it('바뀐 것이 없으면 명령을 만들지 않음', () => {
    const { objs } = setup(1);
    expect(changesToCommand(computeAlign(objs, 1, 'center'), 'x')).toBeNull();
  });
});

describe('OBJ 가져오기', () => {
  const OBJ = `# cube
mtllib cube.mtl
o Cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
usemtl Red
f 1 2 3
f 1 3 4
o Tri
v 0 0 1
v 1 0 1
v 0 1 1
f 5 6 7
`;
  const MTL = `newmtl Red
Kd 1 0 0
Ns 250
`;

  it('메시/이름/정점 수, MTL 없으면 기본 재질(PBR)', () => {
    const root = parseObj(OBJ, { name: 'cube' });
    const meshes: Mesh[] = [];
    root.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh));
    expect(root.name).toBe('cube');
    expect(meshes.map((m) => m.name)).toEqual(['Cube', 'Tri']);
    expect(meshes[0].geometry.getAttribute('position').count).toBe(6);
    const mat = meshes[0].material as MeshStandardMaterial;
    expect(mat.isMeshStandardMaterial).toBe(true);
    expect(mat.color.getHexString()).toBe('9aa4b5');
    expect(meshes[0].geometry.getAttribute('normal')).toBeTruthy();
  });

  it('MTL 색상/거칠기를 PBR 재질로 변환', () => {
    const root = parseObj(OBJ, { mtlText: MTL });
    const cube = root.getObjectByName('Cube') as Mesh;
    const mat = cube.material as MeshStandardMaterial;
    expect(mat.isMeshStandardMaterial).toBe(true);
    expect(mat.name).toBe('Red');
    expect(mat.color.getHexString()).toBe('ff0000');
    expect(mat.roughness).toBeCloseTo(1 - Math.sqrt(0.25));
  });

  it('잘못된 OBJ 거부, mtllib 참조 추출, 파일 조합 검증', () => {
    expect(() => validateObjContent('a.obj', '')).toThrow(/빈/);
    expect(() => validateObjContent('a.obj', 'hello\nworld')).toThrow(/정점/);
    expect(() => validateObjContent('a.obj', 'v 1 2 3\u0000')).toThrow(/바이너리/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\n')).not.toThrow(); // 점 구름(Points)은 허용
    expect(findMtlLibs(OBJ)).toEqual(['cube.mtl']);
    const f = (n: string) => new File(['v 0 0 0'], n);
    expect(pickMainModelFile([f('a.obj'), f('a.mtl'), f('t.png')]).name).toBe('a.obj');
    expect(() => pickMainModelFile([f('a.obj'), f('a.bin')])).toThrow(/함께 선택할 수 없는/);
    expect(() => pickMainModelFile([f('a.glb'), f('a.mtl')])).toThrow(/함께 선택할 수 없는/);
    expect(() => pickMainModelFile([f('a.fbx')])).toThrow(/OBJ/);
  });
});

describe('수식 입력', () => {
  it('사칙연산/괄호/부호, 잘못된 입력은 null', () => {
    expect(evaluateExpression('1+2*3')).toBe(7);
    expect(evaluateExpression('(1+2)*3')).toBe(9);
    expect(evaluateExpression(' -2.5 ')).toBe(-2.5);
    expect(evaluateExpression('10/4')).toBe(2.5);
    expect(evaluateExpression('1,5')).toBe(1.5);
    expect(evaluateExpression('2*-3')).toBe(-6);
    expect(evaluateExpression('1e2')).toBe(100);
    expect(evaluateExpression('1/0')).toBeNull();
    expect(evaluateExpression('alert(1)')).toBeNull();
    expect(evaluateExpression('1+')).toBeNull();
    expect(evaluateExpression('')).toBeNull();
  });
});
