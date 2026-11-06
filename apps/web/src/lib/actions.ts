/**
 * UI에서 호출하는 에디터 동작 모음.
 * 모든 동작은 오류를 잡아 작업 로그에 기록하며, 성공한 경우에만 성공으로 표시합니다.
 */
import type { Object3D } from 'three';
import {
  AddObjectCommand,
  CompositeCommand,
  DuplicateObjectsCommand,
  GroupObjectsCommand,
  PRIMITIVES,
  RemoveObjectCommand,
  RenameObjectCommand,
  ReparentObjectCommand,
  SetVisibilityCommand,
  UngroupObjectCommand,
  alignLabel,
  changesToCommand,
  computeAlign,
  computeDistribute,
  computeDropToFloor,
  computeSnapToGrid,
  computeStats,
  createPrimitive,
  exportGlb,
  importModelFiles,
  isGroupLike,
  ungroupBlocker,
  type EditorCommand,
  type TransformChange,
} from '@form3d/editor-core';
import type { AlignMode, AxisIndex, PrimitiveKind } from '@form3d/model-types';
import { formatBytes, formatNumber, sanitizeFileName } from '@form3d/shared';
import { engine } from '../state/engine';
import { useAppStore } from '../state/appStore';

const app = () => useAppStore.getState();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 명령을 실행하고 실패 시 로그에 남김 */
export function run(command: EditorCommand): boolean {
  try {
    engine.execute(command);
    return true;
  } catch (err) {
    app().log('error', `${command.label} 실패: ${errorMessage(err)}`);
    return false;
  }
}

export function addPrimitive(kind: PrimitiveKind): void {
  const mesh = createPrimitive(kind, engine.uniqueName(PRIMITIVES[kind].baseName));
  if (run(new AddObjectCommand(mesh))) app().log('info', `${PRIMITIVES[kind].label} 추가: ${mesh.name}`);
}

/** 선택된 오브젝트 삭제 (여러 개면 Undo 1회로 모두 복원) */
export function deleteSelected(): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length === 0) return;
  if (objs.length === 1) {
    if (run(new RemoveObjectCommand(objs[0]))) app().log('info', `삭제: ${objs[0].name}`);
    return;
  }
  const cmd = new CompositeCommand(
    'Batch',
    `삭제: ${objs.length}개 오브젝트`,
    objs.map((o) => new RemoveObjectCommand(o)),
  );
  if (run(cmd)) app().log('info', `삭제: ${objs.map((o) => o.name).join(', ')}`);
}

/** 선택 복제 (Ctrl+D). 복제본은 선택 영역 폭만큼 +X 방향으로 옆에 놓입니다. */
export function duplicateSelected(): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length === 0) {
    app().log('warn', '복제할 오브젝트를 먼저 선택하세요.');
    return;
  }
  const bounds = engine.getUnionBounds(objs);
  const width = bounds ? bounds.max.x - bounds.min.x : 0;
  const offset = Math.max(width, 0.5) + 0.25;
  try {
    const cmd = new DuplicateObjectsCommand(objs, { worldOffset: [offset, 0, 0] });
    if (run(cmd)) app().log('success', `복제: ${cmd.copies.map((c) => c.name).join(', ')}`);
  } catch (err) {
    app().log('warn', errorMessage(err));
  }
}

/** 선택을 그룹으로 묶기 (Ctrl+G) */
export function groupSelected(): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length === 0) {
    app().log('warn', '그룹으로 묶을 오브젝트를 선택하세요.');
    return;
  }
  try {
    const cmd = new GroupObjectsCommand(objs, engine.uniqueName('Group'));
    if (run(cmd)) app().log('success', `그룹화: ${objs.map((o) => o.name).join(', ')} → ${cmd.group.name}`);
  } catch (err) {
    app().log('warn', errorMessage(err));
  }
}

export function canUngroupSelection(): boolean {
  return engine.getTopLevelSelection().some((o) => isGroupLike(o) && !ungroupBlocker(o));
}

/** 선택한 그룹 해제 (Ctrl+Shift+G). 해제할 수 없는 항목은 이유를 알려줍니다. */
export function ungroupSelected(): void {
  const objs = engine.getTopLevelSelection();
  const ok = objs.filter((o) => !ungroupBlocker(o));
  objs.filter((o) => ungroupBlocker(o)).forEach((o) => app().log('warn', ungroupBlocker(o)!));
  if (ok.length === 0) return;
  const cmds = ok.map((o) => new UngroupObjectCommand(o));
  // 해제 후에는 그룹이 비므로 자식 목록을 실행 전에 확보
  const childIds = ok.flatMap((g) => g.children.map((c) => c.uuid));
  const cmd =
    cmds.length === 1
      ? cmds[0]
      : new CompositeCommand('UngroupObject', `그룹 해제: ${cmds.length}개`, cmds, () => childIds);
  if (run(cmd)) {
    app().log('success', `그룹 해제: ${ok.map((o) => o.name).join(', ')}`);
  }
}

/**
 * 씬 계층에서 드래그 앤 드롭으로 이동.
 * @param before null이면 newParent의 맨 뒤
 */
export function moveInHierarchy(objects: Object3D[], newParent: Object3D, before: Object3D | null): void {
  const movable = objects.filter((o) => o !== newParent && o !== before);
  if (movable.length === 0) return;
  try {
    const cmds = movable.map((o) => new ReparentObjectCommand(o, newParent, before));
    const cmd =
      cmds.length === 1
        ? cmds[0]
        : new CompositeCommand('ReparentObject', `계층 이동: ${cmds.length}개 → ${newParent.name || 'Scene'}`, cmds);
    run(cmd);
  } catch (err) {
    app().log('warn', errorMessage(err));
  }
}

function runChanges(changes: TransformChange[], label: string): void {
  try {
    const cmd = changesToCommand(changes, label);
    if (!cmd) {
      app().log('info', `${label}: 이미 맞춰져 있어 바뀐 것이 없습니다.`);
      return;
    }
    if (run(cmd)) app().log('success', `${label} 완료 (${cmd.size}개 이동)`);
  } catch (err) {
    app().log('error', `${label} 실패: ${errorMessage(err)}`);
  }
}

export function alignSelected(axis: AxisIndex, mode: AlignMode): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length < 2) {
    app().log('warn', '정렬하려면 오브젝트를 2개 이상 선택하세요.');
    return;
  }
  const ref = app().alignReference;
  runChanges(computeAlign(objs, axis, mode, ref, engine.getSelected()), alignLabel(axis, mode, objs.length));
}

export function distributeSelected(axis: AxisIndex): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length < 3) {
    app().log('warn', '균등 분배하려면 오브젝트를 3개 이상 선택하세요.');
    return;
  }
  runChanges(computeDistribute(objs, axis), `균등 분배 ${'XYZ'[axis]} (${objs.length}개)`);
}

export function dropSelectedToFloor(): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length) runChanges(computeDropToFloor(objs), '바닥에 놓기');
}

export function snapSelectedToGrid(): void {
  const objs = engine.getTopLevelSelection();
  if (objs.length) runChanges(computeSnapToGrid(objs, app().snap.translate), `그리드 스냅 (${app().snap.translate}m)`);
}

export function renameObject(obj: Object3D, name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed === obj.name) return;
  if (trimmed.length > 120) {
    app().log('warn', '이름은 120자 이하로 입력해 주세요.');
    return;
  }
  run(new RenameObjectCommand(obj, trimmed));
}

export function toggleVisibility(obj: Object3D): void {
  run(new SetVisibilityCommand(obj, !obj.visible));
}

export function undo(): void {
  const c = engine.undo();
  if (c) app().log('info', `실행 취소: ${c.label}`);
}

export function redo(): void {
  const c = engine.redo();
  if (c) app().log('info', `다시 실행: ${c.label}`);
}

export async function importFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const { setBusy, log, addImportedFile, requestFrame } = app();
  const label = files.map((f) => f.name).join(', ');
  setBusy(`불러오는 중: ${label}`);
  log('info', `파일 불러오기 시작: ${label}`);
  try {
    const result = await importModelFiles(files);
    result.root.name = engine.uniqueName(result.root.name || 'Model');
    if (!run(new AddObjectCommand(result.root, undefined, `불러오기: ${result.fileName}`))) return;
    addImportedFile({ fileName: result.fileName, size: result.fileSize, objectId: result.root.uuid });
    const s = computeStats(result.root);
    log(
      'success',
      `불러오기 완료: ${result.fileName} (${formatBytes(result.fileSize)}, 메시 ${s.meshes}개, ` +
        `삼각형 ${formatNumber(s.triangles)}개, 재질 ${s.materials}개, 텍스처 ${s.textures}개` +
        `${result.animations.length ? `, 애니메이션 ${result.animations.length}개` : ''})`,
    );
    result.warnings?.forEach((w) => log('warn', w));
    requestFrame();
  } catch (err) {
    log('error', errorMessage(err));
  } finally {
    setBusy(null);
  }
}

export async function exportScene(): Promise<void> {
  const { setBusy, log, projectName } = app();
  const objects = engine.root.children;
  if (objects.length === 0) {
    log('warn', '내보낼 오브젝트가 없습니다. 도형을 추가하거나 모델을 불러와 주세요.');
    return;
  }
  setBusy('GLB 내보내는 중…');
  try {
    const buffer = await exportGlb([...objects]);
    const fileName = `${sanitizeFileName(projectName)}.glb`;
    downloadBuffer(buffer, fileName, 'model/gltf-binary');
    const hidden = countHidden(objects);
    log(
      'success',
      `GLB 내보내기 완료: ${fileName} (${formatBytes(buffer.byteLength)})` +
        (hidden ? ` · 숨김 오브젝트 ${hidden}개도 포함되었습니다.` : ''),
    );
  } catch (err) {
    log('error', errorMessage(err));
  } finally {
    setBusy(null);
  }
}

function countHidden(objects: Object3D[]): number {
  let n = 0;
  objects.forEach((o) => o.traverse((c) => !c.visible && n++));
  return n;
}

export function downloadBuffer(buffer: ArrayBuffer, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 뷰포트 클릭 시 선택 모드에 따라 선택 대상을 결정 */
export function resolvePickTarget(hit: Object3D): Object3D {
  if (app().selectionMode === 'mesh') return hit;
  let o = hit;
  while (o.parent && o.parent !== engine.root) o = o.parent;
  return o;
}
