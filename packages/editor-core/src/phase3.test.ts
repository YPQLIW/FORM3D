import { beforeAll, describe, expect, it } from 'vitest';
import { AnimationClip, Group, NumberKeyframeTrack, type Mesh, type MeshStandardMaterial } from 'three';
import { COMMAND_MANIFEST, type CommandStep } from '@form3d/model-types';
import {
  AddObjectCommand,
  EditorEngine,
  GroupObjectsCommand,
  SetVisibilityCommand,
  applyLoadedProject,
  buildSceneSummary,
  createPrimitive,
  executeJob,
  loadProject,
  makeJob,
  parseRules,
  readProjectManifest,
  saveProject,
  splitClauses,
  validateJob,
} from './index';

// Node에는 FileReader가 없어 GLTFExporter(binary)용 최소 구현을 제공
beforeAll(() => {
  if (!(globalThis as { FileReader?: unknown }).FileReader) {
    class FR {
      result: ArrayBuffer | string | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(b: Blob) {
        void b.arrayBuffer().then((r) => {
          this.result = r;
          this.onloadend?.();
        });
      }
      readAsDataURL(b: Blob) {
        void b.arrayBuffer().then((r) => {
          this.result = `data:${b.type};base64,${Buffer.from(r).toString('base64')}`;
          this.onloadend?.();
        });
      }
    }
    (globalThis as { FileReader?: unknown }).FileReader = FR;
  }
});

const job = (steps: CommandStep[], request?: string) => makeJob(steps, 'rules', request);
const names = (e: EditorEngine) => e.root.children.map((o) => o.name);
const color = (o: unknown) => ((o as Mesh).material as MeshStandardMaterial).color.getHexString();

describe('명령 표준(commands.json)', () => {
  it('모든 명령에 설명/권한/파라미터 정의가 있음', () => {
    for (const [name, spec] of Object.entries(COMMAND_MANIFEST.commands)) {
      expect(spec.description, name).toBeTruthy();
      expect(['scene:write', 'view']).toContain(spec.scope);
      expect(typeof spec.params).toBe('object');
    }
    expect(COMMAND_MANIFEST.version).toBe('1.0');
  });
});

describe('명령 유효성 검사', () => {
  it('정상 작업 통과, 작업 ID 고유', () => {
    const a = job([{ command: 'create_primitive', params: { shape: 'box' } }]);
    const b = job([{ command: 'create_primitive', params: { shape: 'box' } }]);
    expect(validateJob(a)).toEqual([]);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^job_/);
  });

  it('알 수 없는 명령·파라미터, 타입·범위 오류, 필수 누락을 이유와 함께 거부', () => {
    const errs = validateJob(
      job([
        { command: 'run_code', params: { code: 'alert(1)' } },
        { command: 'create_primitive', params: { shape: 'dragon', count: 99 } },
        { command: 'transform', params: { translate: [1, 2] } },
        { command: 'set_material', params: { color: 'blue', hack: 1 } },
        { command: 'rename', params: {} },
        { command: 'transform', params: {} },
        { command: '__proto__', params: {} },
        { command: 'select', params: { target: { names: [] } } },
      ]),
    );
    expect(errs.join('\n')).toMatch(/지원하지 않는 명령 "run_code"/);
    expect(errs.join('\n')).toMatch(/shape은\(는\) box/);
    expect(errs.join('\n')).toMatch(/count은\(는\) 20 이하/);
    expect(errs.join('\n')).toMatch(/translate은\(는\) \[x, y, z\]/);
    expect(errs.join('\n')).toMatch(/color은\(는\) #rrggbb/);
    expect(errs.join('\n')).toMatch(/알 수 없는 파라미터 "hack"/);
    expect(errs.join('\n')).toMatch(/"name"가 필요/);
    expect(errs.join('\n')).toMatch(/바꿀 값/);
    expect(errs.join('\n')).toMatch(/"__proto__"/);
    expect(errs.join('\n')).toMatch(/names는/);
    expect(validateJob({ id: 'bad', steps: [] })).toEqual(['작업 ID 형식이 올바르지 않습니다 (job_...)']);
    expect(validateJob(job(Array(31).fill({ command: 'clear_selection', params: {} })))[0]).toMatch(/최대 30단계/);
  });
});

describe('명령 실행기', () => {
  it('요청 예시 6가지를 실제 편집 기능으로 실행 + 작업 단위 Undo/Redo', () => {
    const e = new EditorEngine();
    // 1. 큐브 만들기
    let r = executeJob(e, job([{ command: 'create_primitive', params: { shape: 'box' } }]));
    expect(r.status).toBe('success');
    expect(names(e)).toEqual(['Box']);
    expect(r.created.map((c) => c.name)).toEqual(['Box']);
    // 2. 오른쪽으로 3 이동
    r = executeJob(e, job([{ command: 'transform', params: { target: 'selection', translate: [3, 0, 0] } }]));
    expect(e.root.children[0].position.x).toBe(3);
    // 4. 파란색
    r = executeJob(e, job([{ command: 'set_material', params: { color: '#1e88e5' } }]));
    expect(color(e.root.children[0])).toBe('1e88e5');
    // 5. 복제
    r = executeJob(e, job([{ command: 'duplicate', params: {} }]));
    expect(names(e)).toEqual(['Box', 'Box.001']);
    // 3. 전체 선택
    executeJob(e, job([{ command: 'select', params: { target: 'all' } }]));
    expect(e.getSelectedIds().length).toBe(2);
    // 6. 그룹
    r = executeJob(e, job([{ command: 'group', params: {} }]));
    expect(names(e)).toEqual(['Group']);
    expect(e.root.children[0].children.length).toBe(2);
    // 작업 1개 = Undo 1회
    expect(e.history.undoRecords.at(-1)!.command.name).toBe('CommandJob');
    e.undo();
    expect(names(e)).toEqual(['Box', 'Box.001']);
    e.redo();
    expect(names(e)).toEqual(['Group']);
  });

  it('여러 단계 작업: "created" 대상으로 이어서 처리, 전체가 Undo 1회', () => {
    const e = new EditorEngine();
    const before = e.history.undoRecords.length;
    const r = executeJob(
      e,
      job([
        { command: 'create_primitive', params: { shape: 'sphere', count: 3, color: '#ff0000' } },
        { command: 'transform', params: { target: 'created', translate: [0, 2, 0] } },
        { command: 'group', params: { target: 'created', name: 'Balls' } },
      ]),
    );
    expect(r.status).toBe('success');
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(names(e)).toEqual(['Balls']);
    const kids = e.root.children[0].children;
    expect(kids.map((k) => k.getWorldPosition(k.position.clone()).y)).toEqual([2.5, 2.5, 2.5]);
    expect(kids.map(color)).toEqual(['ff0000', 'ff0000', 'ff0000']);
    expect(e.history.undoRecords.length).toBe(before + 1);
    e.undo();
    expect(names(e)).toEqual([]);
  });

  it('중간 단계가 실패하면 앞 단계까지 모두 되돌리고 이유를 알려줌', () => {
    const e = new EditorEngine();
    const box = createPrimitive('box', 'Box');
    e.execute(new AddObjectCommand(box));
    const histBefore = e.history.undoRecords.length;
    const r = executeJob(
      e,
      job([
        { command: 'transform', params: { target: { names: ['Box'] }, translate: [5, 0, 0] } },
        { command: 'create_primitive', params: { shape: 'cone' } },
        { command: 'rename', params: { target: { names: ['Nope'] }, name: 'X' } },
      ]),
    );
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/3단계\(rename\)에서 실패/);
    expect(r.steps[2].message).toMatch(/"Nope" 이름의 오브젝트가 없습니다/);
    expect(box.position.x).toBe(0);
    expect(names(e)).toEqual(['Box']);
    expect(e.history.undoRecords.length).toBe(histBefore);
  });

  it('잘못된 작업은 실행하지 않음 (invalid)', () => {
    const e = new EditorEngine();
    const r = executeJob(e, job([{ command: 'create_primitive', params: { shape: 'box', evil: true } }]));
    expect(r.status).toBe('invalid');
    expect(names(e)).toEqual([]);
  });

  it('선택이 없을 때 selection 대상 명령은 이유와 함께 실패', () => {
    const e = new EditorEngine();
    const r = executeJob(e, job([{ command: 'delete', params: {} }]));
    expect(r.status).toBe('failed');
    expect(r.steps[0].message).toMatch(/선택된 오브젝트가 없습니다/);
  });

  it('시점/맞추기는 성공했을 때만 콜백 실행', () => {
    const e = new EditorEngine();
    const views: string[] = [];
    executeJob(e, job([{ command: 'set_view', params: { preset: 'top' } }]), { setView: (p) => views.push(p) });
    executeJob(e, job([{ command: 'set_view', params: { preset: 'front' } }, { command: 'delete', params: {} }]), {
      setView: (p) => views.push(p),
    });
    expect(views).toEqual(['top']);
  });

  it('씬 요약(프로젝트 정보 조회)', () => {
    const e = new EditorEngine();
    executeJob(e, job([{ command: 'create_primitive', params: { shape: 'box', color: '#00ff00', position: [1, 2, 3] } }]));
    const s = buildSceneSummary(e, 'P');
    expect(s.objectCount).toBe(1);
    expect(s.selection).toEqual(['Box']);
    expect(s.nodes[0]).toMatchObject({ name: 'Box', type: 'Mesh', selected: true, position: [1, 2, 3], color: '#00ff00' });
  });
});

describe('기본 명령 해석기 (규칙 기반)', () => {
  const ctx = { names: ['Box', 'Sphere'] };
  const p = (t: string) => parseRules(t, ctx);
  it('요청 예시 6문장', () => {
    expect(p('큐브 하나 만들어 줘.').steps).toEqual([{ command: 'create_primitive', params: { shape: 'box' } }]);
    expect(p('선택한 오브젝트를 오른쪽으로 3만큼 이동해 줘.').steps).toEqual([
      { command: 'transform', params: { target: 'selection', translate: [3, 0, 0] } },
    ]);
    expect(p('모든 오브젝트를 선택해 줘.').steps).toEqual([{ command: 'select', params: { target: 'all' } }]);
    expect(p('선택한 물체의 색상을 파란색으로 변경해 줘.').steps).toEqual([
      { command: 'set_material', params: { target: 'selection', color: '#1e88e5' } },
    ]);
    expect(p('이 오브젝트를 복제해 줘.').steps).toEqual([{ command: 'duplicate', params: { target: 'selection' } }]);
    expect(p('선택한 물체들을 하나의 그룹으로 묶어 줘.').steps).toEqual([{ command: 'group', params: { target: 'selection' } }]);
    for (const t of ['큐브 하나 만들어 줘.', '모든 오브젝트를 선택해 줘.']) expect(p(t).errors).toEqual([]);
  });

  it('여러 단계 문장과 다양한 표현', () => {
    const r = p('빨간 구 3개 만들고 위로 2만큼 올린 다음 그룹으로 묶어 줘');
    expect(r.errors).toEqual([]);
    expect(r.steps).toEqual([
      { command: 'create_primitive', params: { shape: 'sphere', count: 3, color: '#e53935' } },
      { command: 'transform', params: { target: 'created', translate: [0, 2, 0] } },
      { command: 'group', params: { target: 'created' } },
    ]);
    expect(p('Box를 왼쪽으로 1.5 옮겨줘').steps[0].params).toEqual({ target: { names: ['Box'] }, translate: [-1.5, 0, 0] });
    expect(p('y축으로 45도 회전').steps[0].params).toMatchObject({ rotate_deg: [0, 45, 0] });
    expect(p('2배 크게 해줘').steps[0].params).toMatchObject({ scale_by: 2 });
    expect(p('절반으로 줄여줘').steps[0].params).toMatchObject({ scale_by: 0.5 });
    expect(p('삭제해줘').steps[0].command).toBe('delete');
    expect(p('그룹 해제해줘').steps[0].command).toBe('ungroup');
    expect(p('위에서 보여줘').steps[0]).toEqual({ command: 'set_view', params: { preset: 'top' } });
    expect(p('정면 시점').steps[0]).toEqual({ command: 'set_view', params: { preset: 'front' } });
    expect(p('금속 느낌으로 바꿔줘').steps[0].params).toMatchObject({ metalness: 1 });
    expect(p('이름을 "Rock"으로 바꿔줘').steps[0].params).toMatchObject({ name: 'Rock' });
    expect(p('숨겨줘').steps[0].params).toMatchObject({ visible: false });
    expect(p('바닥에 놓아줘').steps[0].command).toBe('drop_to_floor');
    expect(p('선택 해제해줘').steps[0].command).toBe('clear_selection');
    expect(p('(1, 2.5, -3) 위치로 이동해줘').steps[0].params).toMatchObject({ position: [1, 2.5, -3] });
  });

  it('이해하지 못한 문장은 추측하지 않고 오류로 돌려줌', () => {
    const r = p('오늘 날씨 어때');
    expect(r.steps).toEqual([]);
    expect(r.errors[0]).toMatch(/이해하지 못한 부분/);
    expect(p('큐브 만들고 춤춰').errors.length).toBe(1);
    expect(splitClauses('A 만들고 B, C 그리고 D')).toEqual(['A 만들', 'B', 'C', 'D']);
  });

  it('해석 결과는 모두 유효성 검사를 통과', () => {
    for (const t of ['큐브 2개 만들어', '노란색으로 바꿔', '전부 선택', 'x축 가운데 정렬', '간격을 같게', '등각으로 보여줘']) {
      const r = p(t);
      expect(r.errors, t).toEqual([]);
      expect(validateJob(job(r.steps)), t).toEqual([]);
    }
  });
});

describe('.form3d 프로젝트 저장/불러오기', () => {
  it('오브젝트·그룹 구조, Transform, 재질, 이름(점 포함), 표시 여부, 카메라, 설정 보존', async () => {
    const e = new EditorEngine();
    const a = createPrimitive('box', 'Box.001');
    a.position.set(1, 2, 3);
    a.rotation.set(0.1, 0.2, 0.3);
    a.scale.set(1, 2, 0.5);
    ((a as Mesh).material as MeshStandardMaterial).color.set('#123456');
    ((a as Mesh).material as MeshStandardMaterial).metalness = 0.7;
    const b = createPrimitive('sphere', 'Ball');
    b.position.set(-2, 0.5, 0);
    e.execute(new AddObjectCommand(a));
    e.execute(new AddObjectCommand(b));
    e.execute(new GroupObjectsCommand([a, b], 'My Group'));
    const c = createPrimitive('cone', 'Hidden Cone');
    e.execute(new AddObjectCommand(c));
    e.execute(new SetVisibilityCommand(c, false));
    const worldA = a.getWorldPosition(a.position.clone()).toArray();

    const camera = { position: [4, 5, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 45 };
    const settings = {
      showGrid: false,
      transformMode: 'rotate' as const,
      transformSpace: 'local' as const,
      selectionMode: 'mesh' as const,
      alignReference: 'active' as const,
      snap: { enabled: true, translate: 0.25, rotateDeg: 10, scale: 0.05 },
    };
    const bytes = await saveProject(e, { name: '테스트 프로젝트', projectId: 'p1', camera, settings, thumbnail: new Uint8Array([1, 2, 3]) });
    expect(bytes[0]).toBe(0x50);
    const m = readProjectManifest(bytes);
    expect(m).toMatchObject({ format: 'form3d-project', formatVersion: 1, name: '테스트 프로젝트', projectId: 'p1' });
    expect(m.stats).toEqual({ objects: 2, meshes: 3, triangles: expect.any(Number) });
    // 저장해도 원본 userData에 흔적이 남지 않음
    expect(a.userData.form3dEditor).toBeUndefined();

    const loaded = await loadProject(bytes);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.camera).toEqual(camera);
    expect(loaded.settings).toEqual(settings);
    expect(Array.from(loaded.thumbnail!)).toEqual([1, 2, 3]);
    const e2 = new EditorEngine();
    applyLoadedProject(e2, loaded);
    expect(names(e2)).toEqual(['My Group', 'Hidden Cone']);
    const g = e2.root.children[0];
    expect(g.children.map((x) => x.name)).toEqual(['Box.001', 'Ball']);
    const a2 = g.children[0] as Mesh;
    expect(a2.getWorldPosition(a2.position.clone()).toArray().map((v) => +v.toFixed(5))).toEqual(worldA.map((v) => +v.toFixed(5)));
    expect(a2.rotation.toArray().slice(0, 3).map((v) => +(v as number).toFixed(5))).toEqual([0.1, 0.2, 0.3]);
    expect(a2.scale.toArray().map((v) => +v.toFixed(5))).toEqual([1, 2, 0.5]);
    expect(color(a2)).toBe('123456');
    expect((a2.material as MeshStandardMaterial).metalness).toBeCloseTo(0.7);
    expect(e2.root.children[1].visible).toBe(false);
    expect((a2.userData.form3d as { source: string }).source).toBe('primitive');
    expect(e2.isDirty()).toBe(false);
    expect(e2.history.canUndo).toBe(false);
  });

  it('빈 씬 저장/불러오기, 애니메이션 클립 보존', async () => {
    const e = new EditorEngine();
    const empty = await loadProject(await saveProject(e, { name: 'Empty', camera: null, settings: null }));
    expect(empty.objects).toEqual([]);

    const model = new Group();
    model.name = 'Walker';
    const part = createPrimitive('box', 'Leg');
    model.add(part);
    model.animations = [new AnimationClip('Walk', 1, [new NumberKeyframeTrack('Leg.position[x]', [0, 1], [0, 1])])];
    e.execute(new AddObjectCommand(model));
    e.execute(new AddObjectCommand(createPrimitive('sphere', 'First')));
    const loaded = await loadProject(await saveProject(e, { name: 'Anim', camera: null, settings: null }));
    const w = loaded.objects.find((o) => o.name === 'Walker')!;
    expect(w.animations.map((c) => c.name)).toEqual(['Walk']);
    expect(w.animations[0].tracks.length).toBe(1);
  });

  it('손상/다른 형식/새 버전 파일 거부', async () => {
    await expect(loadProject(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/\.form3d/);
    await expect(loadProject(new Uint8Array([0x50, 0x4b, 0, 0, 9]))).rejects.toThrow(/손상/);
    const { zipSync, strToU8 } = await import('fflate');
    const other = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'x' })) });
    await expect(loadProject(other)).rejects.toThrow(/형식이 아닙니다/);
    const newer = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'form3d-project', formatVersion: 99, files: {} })) });
    await expect(loadProject(newer)).rejects.toThrow(/업데이트/);
  });

  it('저장 상태 추적: 편집하면 dirty, 저장 시점으로 Undo하면 clean', () => {
    const e = new EditorEngine();
    expect(e.isDirty()).toBe(false);
    e.execute(new AddObjectCommand(createPrimitive('box')));
    expect(e.isDirty()).toBe(true);
    e.markSaved();
    expect(e.isDirty()).toBe(false);
    e.execute(new AddObjectCommand(createPrimitive('box')));
    expect(e.isDirty()).toBe(true);
    e.undo();
    expect(e.isDirty()).toBe(false);
    e.undo();
    expect(e.isDirty()).toBe(true);
  });
});
