import { MathUtils, Vector3, type Mesh, type Object3D } from 'three';
import type {
  AlignMode,
  AxisIndex,
  CommandJob,
  CommandStep,
  CommandTarget,
  JobResult,
  PrimitiveKind,
  SceneSummary,
  SceneSummaryNode,
  StepResult,
  TransformData,
  Vec3,
  ViewPreset,
} from '@form3d/model-types';
import type { EditorEngine } from '../engine';
import type { EditorCommand } from '../history';
import { CompositeCommand } from '../commands/composite';
import { AddObjectCommand, RemoveObjectCommand, RenameObjectCommand, SetVisibilityCommand } from '../commands/objects';
import { SetTransformCommand, readTransform, transformsEqual } from '../commands/transform';
import { ChangeMaterialCommand, getMaterialCapabilities, isMesh, readMaterial } from '../commands/material';
import {
  DuplicateObjectsCommand,
  GroupObjectsCommand,
  UngroupObjectCommand,
  ungroupBlocker,
} from '../commands/hierarchy';
import { changesToCommand, computeAlign, computeDistribute, computeDropToFloor } from '../align';
import { PRIMITIVES, createPrimitive } from '../primitives';
import { validateJob } from './validate';

/** 실행 결과를 UI에 반영하기 위한 콜백 (카메라 등 편집 기록 밖의 동작) */
export interface ExecutorHooks {
  setView?: (preset: ViewPreset) => void;
  frame?: () => void;
}

class StepError extends Error {}

const AXIS: Record<string, AxisIndex> = { x: 0, y: 1, z: 2 };
const deg = MathUtils.degToRad;

interface Ctx {
  engine: EditorEngine;
  created: Object3D[];
  executed: EditorCommand[];
  deferred: (() => void)[];
}

const info = (o: Object3D) => ({ id: o.uuid, name: o.name || o.type });

/** 부모·자식이 함께 있으면 부모만 남김 (씬 계층 순서) */
function topLevel(engine: EditorEngine, list: Object3D[]): Object3D[] {
  const set = new Set(list);
  const out: Object3D[] = [];
  engine.root.traverse((o) => {
    if (!set.has(o)) return;
    let p = o.parent;
    while (p && p !== engine.root) {
      if (set.has(p)) return;
      p = p.parent;
    }
    out.push(o);
  });
  return out;
}

export function resolveTarget(engine: EditorEngine, target: unknown, created: Object3D[] = []): Object3D[] {
  const t = (target ?? 'selection') as CommandTarget;
  let list: Object3D[];
  if (t === 'selection') {
    list = engine.getTopLevelSelection();
    if (!list.length) throw new StepError('선택된 오브젝트가 없습니다. 먼저 선택하거나 대상을 지정하세요.');
    return list;
  }
  if (t === 'all') {
    list = [...engine.root.children];
    if (!list.length) throw new StepError('씬에 오브젝트가 없습니다.');
    return list;
  }
  if (t === 'created') {
    list = created.filter((o) => engine.isInScene(o));
    if (!list.length) throw new StepError('이 작업에서 앞서 만든 오브젝트가 없습니다.');
    return topLevel(engine, list);
  }
  if ('ids' in t) {
    list = t.ids.map((id) => {
      const o = engine.getObject(id);
      if (!o) throw new StepError(`id "${id}"인 오브젝트가 없습니다.`);
      return o;
    });
    return topLevel(engine, list);
  }
  list = [];
  for (const name of t.names) {
    const found: Object3D[] = [];
    engine.root.traverse((o) => o !== engine.root && o.name === name && found.push(o));
    if (!found.length) {
      const lower = name.toLowerCase();
      engine.root.traverse((o) => o !== engine.root && o.name.toLowerCase() === lower && found.push(o));
    }
    if (!found.length) throw new StepError(`"${name}" 이름의 오브젝트가 없습니다.`);
    list.push(...found);
  }
  return topLevel(engine, list);
}

function run(ctx: Ctx, cmd: EditorCommand): void {
  cmd.execute(ctx.engine);
  ctx.executed.push(cmd);
}

function toLocalPosition(o: Object3D, world: Vector3): Vec3 {
  const parent = o.parent;
  if (!parent) return world.toArray() as Vec3;
  parent.updateWorldMatrix(true, false);
  return parent.worldToLocal(world.clone()).toArray() as Vec3;
}

function nameList(objs: Object3D[]): string {
  const names = objs.map((o) => o.name || o.type);
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} 외 ${names.length - 4}개` : names.join(', ');
}

function executeStep(ctx: Ctx, step: CommandStep): { message: string; affected: Object3D[] } {
  const { engine } = ctx;
  const p = step.params ?? {};
  switch (step.command) {
    case 'create_primitive': {
      const kind = p.shape as PrimitiveKind;
      const count = (p.count as number | undefined) ?? 1;
      const made: Object3D[] = [];
      for (let i = 0; i < count; i++) {
        const base = (p.name as string | undefined)?.trim() || PRIMITIVES[kind].baseName;
        const mesh = createPrimitive(kind, engine.uniqueName(base));
        if (p.position) mesh.position.fromArray(p.position as Vec3);
        mesh.position.x += i * 1.5;
        if (p.color) (mesh.material as unknown as { color: { set: (c: string) => void } }).color.set(p.color as string);
        run(ctx, new AddObjectCommand(mesh));
        made.push(mesh);
      }
      ctx.created.push(...made);
      engine.setSelection(made.map((m) => m.uuid));
      return { message: `${PRIMITIVES[kind].label} ${count}개 생성: ${nameList(made)}`, affected: made };
    }
    case 'select': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      engine.setSelection(objs.map((o) => o.uuid));
      return { message: `${objs.length}개 선택: ${nameList(objs)}`, affected: objs };
    }
    case 'clear_selection':
      engine.setSelection([]);
      return { message: '선택 해제', affected: [] };
    case 'transform': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      for (const o of objs) {
        const before = readTransform(o);
        const after: TransformData = {
          position: [...before.position] as Vec3,
          rotation: [...before.rotation] as Vec3,
          scale: [...before.scale] as Vec3,
        };
        if (p.position) after.position = toLocalPosition(o, new Vector3().fromArray(p.position as Vec3));
        if (p.translate) {
          const wp = o.getWorldPosition(new Vector3()).add(new Vector3().fromArray(p.translate as Vec3));
          after.position = toLocalPosition(o, wp);
          if (p.position) throw new StepError('position과 translate는 함께 쓸 수 없습니다.');
        }
        if (p.rotation_deg) after.rotation = (p.rotation_deg as Vec3).map(deg) as Vec3;
        if (p.rotate_deg) after.rotation = after.rotation.map((r, i) => r + deg((p.rotate_deg as Vec3)[i])) as Vec3;
        if (p.scale) after.scale = [...(p.scale as Vec3)] as Vec3;
        if (p.scale_by !== undefined) {
          const f = typeof p.scale_by === 'number' ? [p.scale_by, p.scale_by, p.scale_by] : (p.scale_by as Vec3);
          after.scale = after.scale.map((s, i) => s * f[i]) as Vec3;
        }
        if (after.scale.some((s) => Math.abs(s) < 1e-6)) throw new StepError('크기는 0이 될 수 없습니다.');
        if (!transformsEqual(before, after)) run(ctx, new SetTransformCommand(o, before, after, `Transform: ${o.name}`));
      }
      return { message: `${objs.length}개 Transform 변경: ${nameList(objs)}`, affected: objs };
    }
    case 'set_material': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      const meshes: Mesh[] = [];
      objs.forEach((o) => o.traverse((c) => isMesh(c) && meshes.push(c)));
      const patch: Record<string, unknown> = {};
      for (const k of ['color', 'metalness', 'roughness']) if (p[k] !== undefined) patch[k] = p[k];
      const editable = meshes.filter((m) => {
        const cap = getMaterialCapabilities(m);
        return (patch.color === undefined || cap.color) && (patch.metalness === undefined || cap.metalness) && (patch.roughness === undefined || cap.roughness);
      });
      if (!editable.length) throw new StepError(`재질을 바꿀 수 있는 메시가 없습니다 (${nameList(objs)}).`);
      for (const m of editable) run(ctx, new ChangeMaterialCommand(m, patch));
      return { message: `${editable.length}개 메시 재질 변경 (${Object.keys(patch).join(', ')})`, affected: objs };
    }
    case 'duplicate': {
      let current = resolveTarget(engine, p.target, ctx.created);
      const count = (p.count as number | undefined) ?? 1;
      const all: Object3D[] = [];
      for (let i = 0; i < count; i++) {
        const b = engine.getUnionBounds(current);
        const width = b ? b.max.x - b.min.x : 0;
        let cmd: DuplicateObjectsCommand;
        try {
          cmd = new DuplicateObjectsCommand(current, { worldOffset: [Math.max(width, 0.5) + 0.25, 0, 0] });
        } catch (e) {
          throw new StepError((e as Error).message);
        }
        run(ctx, cmd);
        current = cmd.copies;
        all.push(...cmd.copies);
      }
      ctx.created.push(...all);
      engine.setSelection(all.map((o) => o.uuid));
      return { message: `복제 ${all.length}개: ${nameList(all)}`, affected: all };
    }
    case 'group': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      let cmd: GroupObjectsCommand;
      try {
        cmd = new GroupObjectsCommand(objs, engine.uniqueName((p.name as string | undefined)?.trim() || 'Group'));
      } catch (e) {
        throw new StepError((e as Error).message);
      }
      run(ctx, cmd);
      ctx.created.push(cmd.group);
      return { message: `그룹화: ${nameList(objs)} → ${cmd.group.name}`, affected: [cmd.group] };
    }
    case 'ungroup': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      const children: Object3D[] = [];
      for (const o of objs) {
        const reason = ungroupBlocker(o);
        if (reason) throw new StepError(reason);
        children.push(...o.children);
        run(ctx, new UngroupObjectCommand(o));
      }
      engine.setSelection(children.map((c) => c.uuid));
      return { message: `그룹 해제: ${nameList(objs)}`, affected: children };
    }
    case 'delete': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      for (const o of objs) run(ctx, new RemoveObjectCommand(o));
      return { message: `삭제 ${objs.length}개: ${nameList(objs)}`, affected: objs };
    }
    case 'rename': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      if (objs.length !== 1) throw new StepError(`이름은 오브젝트 1개에만 바꿀 수 있습니다 (현재 ${objs.length}개).`);
      const name = (p.name as string).trim();
      const old = objs[0].name;
      run(ctx, new RenameObjectCommand(objs[0], name));
      return { message: `이름 변경: ${old} → ${name}`, affected: objs };
    }
    case 'set_visibility': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      const visible = p.visible as boolean;
      for (const o of objs) if (o.visible !== visible) run(ctx, new SetVisibilityCommand(o, visible));
      return { message: `${visible ? '표시' : '숨김'}: ${nameList(objs)}`, affected: objs };
    }
    case 'align':
    case 'distribute':
    case 'drop_to_floor': {
      const objs = resolveTarget(engine, p.target, ctx.created);
      let changes;
      if (step.command === 'align') {
        if (objs.length < 2) throw new StepError('정렬은 오브젝트가 2개 이상 필요합니다.');
        changes = computeAlign(objs, AXIS[p.axis as string], p.mode as AlignMode, 'selection');
      } else if (step.command === 'distribute') {
        if (objs.length < 3) throw new StepError('균등 분배는 오브젝트가 3개 이상 필요합니다.');
        changes = computeDistribute(objs, AXIS[p.axis as string]);
      } else changes = computeDropToFloor(objs);
      const cmd = changesToCommand(changes, step.command);
      if (cmd) run(ctx, cmd);
      return { message: cmd ? `${step.command}: ${cmd.size}개 이동` : `${step.command}: 이미 맞춰져 있어 변경 없음`, affected: objs };
    }
    case 'set_view': {
      const preset = p.preset as ViewPreset;
      return { message: `카메라 시점: ${preset}`, affected: [] };
    }
    case 'frame': {
      if (p.target !== undefined) {
        const objs = resolveTarget(engine, p.target, ctx.created);
        engine.setSelection(objs.map((o) => o.uuid));
      }
      return { message: '카메라 맞추기', affected: [] };
    }
    default:
      throw new StepError(`지원하지 않는 명령: ${step.command}`);
  }
}

/**
 * 검증된 작업(JSON 명령 목록)을 실행합니다.
 * - 단계별로 실제 편집 명령(Command)을 실행하고 결과를 기록합니다.
 * - 한 단계라도 실패하면 앞 단계까지 모두 되돌리고 실패 이유를 돌려줍니다 (부분 실행 없음).
 * - 성공하면 작업 전체가 실행 취소 1회 단위로 기록됩니다.
 */
export function executeJob(engine: EditorEngine, job: CommandJob, hooks: ExecutorHooks = {}): JobResult {
  const errors = validateJob(job);
  if (errors.length) {
    return { jobId: String((job as { id?: unknown })?.id ?? '?'), status: 'invalid', message: errors.join('\n'), steps: [], created: [] };
  }
  const selectionBefore = [...engine.getSelectedIds()];
  const ctx: Ctx = { engine, created: [], executed: [], deferred: [] };
  const results: StepResult[] = [];
  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i];
    try {
      const r = executeStep(ctx, step);
      results.push({ index: i, command: step.command, ok: true, message: r.message, affected: r.affected.map(info) });
      if (step.command === 'set_view') ctx.deferred.push(() => hooks.setView?.(step.params.preset as ViewPreset));
      if (step.command === 'frame') ctx.deferred.push(() => hooks.frame?.());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ index: i, command: step.command, ok: false, message: msg, affected: [] });
      for (const c of [...ctx.executed].reverse()) {
        try {
          c.undo(engine);
        } catch {
          /* 되돌리기 중 오류는 무시하고 계속 */
        }
      }
      engine.validateSelection();
      engine.setSelection(selectionBefore);
      engine.notify();
      return {
        jobId: job.id,
        status: 'failed',
        message: `${i + 1}단계(${step.command})에서 실패해 작업 전체를 취소했습니다: ${msg}`,
        steps: results,
        created: [],
      };
    }
  }
  engine.validateSelection();
  if (ctx.executed.length) {
    const label = `작업 ${job.id}${job.summary ? `: ${job.summary}` : job.request ? `: ${job.request}` : ''}`;
    engine.record(
      new CompositeCommand('CommandJob', label.slice(0, 160), ctx.executed).markExecuted(selectionBefore, [...engine.getSelectedIds()]),
    );
  } else engine.notify();
  ctx.deferred.forEach((f) => f());
  const created = ctx.created.filter((o) => engine.isInScene(o)).map(info);
  return { jobId: job.id, status: 'success', message: `${job.steps.length}단계 실행 완료`, steps: results, created };
}

/** 프로젝트 정보 조회: 씬 요약 (AI 프롬프트와 외부 API 공용). 노드 수와 깊이를 제한합니다. */
export function buildSceneSummary(engine: EditorEngine, projectName: string, maxNodes = 300, maxDepth = 4): SceneSummary {
  let count = 0;
  const selected = new Set(engine.getSelectedIds());
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const build = (o: Object3D, depth: number): SceneSummaryNode | null => {
    if (count >= maxNodes) return null;
    count++;
    const t = readTransform(o);
    const node: SceneSummaryNode = {
      id: o.uuid,
      name: o.name || o.type,
      type: o.type,
      visible: o.visible,
      selected: selected.has(o.uuid),
      position: t.position.map(r3) as Vec3,
      rotationDeg: t.rotation.map((v) => r3(MathUtils.radToDeg(v))) as Vec3,
      scale: t.scale.map(r3) as Vec3,
    };
    if (isMesh(o)) node.color = readMaterial(o).color;
    if (o.children.length && depth < maxDepth) {
      node.children = o.children.map((c) => build(c, depth + 1)).filter((c): c is SceneSummaryNode => !!c);
    }
    return node;
  };
  const nodes = engine.root.children.map((c) => build(c, 1)).filter((c): c is SceneSummaryNode => !!c);
  return {
    projectName,
    objectCount: engine.root.children.length,
    selection: engine.getSelectedObjects().map((o) => o.name || o.type),
    nodes,
  };
}

