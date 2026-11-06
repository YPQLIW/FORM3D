/**
 * 프로젝트 관리: 새 프로젝트 · 저장 · 다른 이름으로 저장 · 열기 · 최근 목록 · 자동 저장 · 복구.
 *
 * - 서버 저장소(로컬 서버 실행 중): 문서\FORM3D 폴더에 저장, 최근 목록·버전 백업 제공
 * - 내 컴퓨터 파일: .form3d 파일 내려받기 / 열기 (서버 없이도 동작)
 * - 복구 스냅샷: 저장하지 않은 변경을 브라우저(IndexedDB)에 주기적으로 기록
 * GLB 내보내기(결과물 공유)와는 별개 기능입니다.
 */
import { applyLoadedProject, loadProject, saveProject, type ProjectSettings } from '@form3d/editor-core';
import { formatBytes, sanitizeFileName } from '@form3d/shared';
import { engine } from '../state/engine';
import { useAppStore } from '../state/appStore';
import { useProjectStore } from '../state/projectStore';
import { dialog } from '../state/dialogStore';
import { ApiError, api } from './api';
import { recoveryDb } from './recoveryDb';
import { applyCameraState, captureThumbnail, getCameraState, viewport } from './viewport';
import { downloadBuffer } from './actions';

const app = () => useAppStore.getState();
const ps = () => useProjectStore.getState();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const DEFAULT_PROJECT_NAME = 'Untitled Project';
const SNAPSHOT_EVERY_MS = 30_000;
const AUTOSAVE_EVERY_MS = 120_000;

/** 저장하지 않은 변경이 있는지 (편집 기록 기준 + 이전 버전/복구본을 연 경우) */
let forceDirty = false;
export function isProjectDirty(): boolean {
  return forceDirty || engine.isDirty();
}
function setClean(): void {
  forceDirty = false;
  engine.markSaved();
  engine.notify();
}
function setForceDirty(): void {
  forceDirty = true;
  engine.notify();
}

function currentSettings(): ProjectSettings {
  const s = app();
  return {
    showGrid: s.showGrid,
    transformMode: s.transformMode,
    transformSpace: s.transformSpace,
    selectionMode: s.selectionMode,
    alignReference: s.alignReference,
    snap: { ...s.snap },
  };
}

function applySettings(s: ProjectSettings | null): void {
  if (!s) return;
  const patch: Partial<ReturnType<typeof app>> = {};
  if (typeof s.showGrid === 'boolean') patch.showGrid = s.showGrid;
  if (['translate', 'rotate', 'scale'].includes(s.transformMode)) patch.transformMode = s.transformMode;
  if (['world', 'local'].includes(s.transformSpace)) patch.transformSpace = s.transformSpace;
  if (['object', 'mesh'].includes(s.selectionMode)) patch.selectionMode = s.selectionMode;
  if (['selection', 'active'].includes(s.alignReference)) patch.alignReference = s.alignReference;
  if (s.snap && typeof s.snap === 'object') patch.snap = { ...app().snap, ...s.snap };
  useAppStore.setState(patch);
}

/** 현재 상태를 .form3d 바이트로 */
export async function buildProjectFile(name = app().projectName, withThumbnail = true): Promise<Uint8Array> {
  return saveProject(engine, {
    name,
    projectId: ps().projectId,
    createdAt: ps().createdAt ?? undefined,
    camera: getCameraState(),
    settings: currentSettings(),
    thumbnail: withThumbnail ? await captureThumbnail() : null,
  });
}

// ------------------------------------------------------------ 서버 상태

export async function refreshServer(): Promise<void> {
  try {
    const health = await api.health();
    ps().set({ server: 'online', health });
    await refreshRecent();
  } catch {
    ps().set({ server: 'offline', health: null });
  }
}

export async function refreshRecent(): Promise<void> {
  if (ps().server !== 'online') return;
  ps().set({ recentLoading: true });
  try {
    ps().set({ recent: await api.listProjects() });
  } catch (e) {
    if (e instanceof ApiError && e.offline) ps().set({ server: 'offline' });
  } finally {
    ps().set({ recentLoading: false });
  }
}

// ------------------------------------------------------------ 저장

/**
 * 저장 (Ctrl+S). 서버 프로젝트면 덮어쓰고(이전 저장본은 버전으로 보관), 처음이면 새로 만듭니다.
 * 서버가 꺼져 있으면 .form3d 파일로 내려받습니다.
 */
export async function saveCurrent(opts: { saveAs?: boolean; auto?: boolean } = {}): Promise<boolean> {
  const store = ps();
  if (store.saving) return false;
  let name = app().projectName.trim() || DEFAULT_PROJECT_NAME;
  if (opts.saveAs) {
    const input = await dialog.prompt('다른 이름으로 저장', '새 프로젝트 이름', `${name} 복사본`, '저장');
    if (!input) return false;
    name = input;
  }
  if (store.server !== 'online') {
    await refreshServer();
    if (ps().server !== 'online') {
      if (opts.auto) return false;
      app().log('warn', '로컬 서버가 꺼져 있어 프로젝트를 .form3d 파일로 내려받습니다. (서버 실행: npm run setup 후 npm run dev)');
      return downloadProjectFile(name, true);
    }
  }
  ps().set({ saving: true });
  if (!opts.auto) app().setBusy('프로젝트 저장 중…');
  try {
    const asNew = opts.saveAs || !ps().projectId;
    if (asNew) ps().set({ projectId: null, createdAt: null });
    const data = await buildProjectFile(name);
    const meta = asNew ? await api.createProject(data, name) : await api.saveProject(ps().projectId!, data, name);
    ps().set({ projectId: meta.id, createdAt: meta.createdAt, lastSavedAt: Date.now() });
    app().setProjectName(meta.name);
    setClean();
    await recoveryDb.clear().catch(() => undefined);
    app().log(
      'success',
      `${opts.auto ? '자동 저장' : asNew ? (opts.saveAs ? '다른 이름으로 저장' : '새 프로젝트 저장') : '저장'} 완료: ${meta.name} (${formatBytes(meta.size)})`,
    );
    void refreshRecent();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.offline) ps().set({ server: 'offline' });
    app().log('error', `${opts.auto ? '자동 저장' : '저장'} 실패: ${errMsg(e)}`);
    return false;
  } finally {
    ps().set({ saving: false });
    if (!opts.auto) app().setBusy(null);
  }
}

/** 내 컴퓨터에 .form3d 파일로 내려받기 */
export async function downloadProjectFile(name = app().projectName, markSaved = false): Promise<boolean> {
  app().setBusy('프로젝트 파일 만드는 중…');
  try {
    const data = await buildProjectFile(name);
    const fileName = `${sanitizeFileName(name, 'form3d-project')}.form3d`;
    downloadBuffer(data.slice().buffer as ArrayBuffer, fileName, 'application/octet-stream');
    if (markSaved) {
      setClean();
      ps().set({ lastSavedAt: Date.now() });
      await recoveryDb.clear().catch(() => undefined);
    }
    app().log('success', `프로젝트 파일 내려받기: ${fileName} (${formatBytes(data.byteLength)})`);
    return true;
  } catch (e) {
    app().log('error', `프로젝트 파일 만들기 실패: ${errMsg(e)}`);
    return false;
  } finally {
    app().setBusy(null);
  }
}

// ------------------------------------------------------------ 열기 · 새로 만들기

/** 저장하지 않은 변경이 있으면 물어봄. 계속해도 되면 true */
export async function confirmDiscard(action: string): Promise<boolean> {
  if (!isProjectDirty()) return true;
  const r = await dialog.unsaved(action);
  if (r === 'cancel') return false;
  if (r === 'save') return saveCurrent();
  return true;
}

async function applyProjectBytes(data: Uint8Array, source: string): Promise<boolean> {
  try {
    const loaded = await loadProject(data);
    applyLoadedProject(engine, loaded);
    applyCameraState(loaded.camera);
    applySettings(loaded.settings);
    app().setProjectName(loaded.manifest.name || DEFAULT_PROJECT_NAME);
    setClean();
    loaded.warnings.forEach((w) => app().log('warn', w));
    app().log('success', `프로젝트 열기: ${loaded.manifest.name} (${source}, 오브젝트 ${loaded.manifest.stats.objects}개)`);
    return true;
  } catch (e) {
    app().log('error', `프로젝트를 열 수 없습니다: ${errMsg(e)}`);
    return false;
  }
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard('새 프로젝트를 만들기'))) return;
  engine.reset();
  ps().set({ projectId: null, createdAt: null, lastSavedAt: null });
  app().setProjectName(DEFAULT_PROJECT_NAME);
  applyCameraState(viewport.initial);
  setClean();
  await recoveryDb.clear().catch(() => undefined);
  app().log('info', '새 프로젝트를 시작했습니다.');
}

export async function openServerProject(id: string): Promise<void> {
  if (id === ps().projectId && !isProjectDirty()) return;
  if (!(await confirmDiscard('다른 프로젝트를 열기'))) return;
  app().setBusy('프로젝트 여는 중…');
  try {
    const data = await api.readProject(id);
    const meta = ps().recent.find((p) => p.id === id) ?? (await api.listProjects()).find((p) => p.id === id);
    if (await applyProjectBytes(data, '프로젝트 저장소')) {
      ps().set({ projectId: id, createdAt: meta?.createdAt ?? null, lastSavedAt: meta ? Date.parse(meta.updatedAt) : null });
      if (meta) app().setProjectName(meta.name);
      await recoveryDb.clear().catch(() => undefined);
      void refreshRecent();
    }
  } catch (e) {
    app().log('error', `프로젝트를 열 수 없습니다: ${errMsg(e)}`);
  } finally {
    app().setBusy(null);
  }
}

/** 이전 버전 열기: 현재 프로젝트에 이어서 저장하면 그 버전으로 되돌아갑니다 */
export async function openVersion(id: string, vid: string, label: string): Promise<void> {
  if (!(await confirmDiscard('이전 버전을 열기'))) return;
  app().setBusy('이전 버전 여는 중…');
  try {
    const data = await api.readVersion(id, vid);
    const name = app().projectName;
    if (await applyProjectBytes(data, `이전 버전 ${label}`)) {
      ps().set({ projectId: id });
      app().setProjectName(name);
      setForceDirty();
      app().log('info', '이전 버전을 열었습니다. 저장하면 이 내용이 현재 프로젝트가 됩니다 (지금 저장본은 버전으로 보관).');
    }
  } catch (e) {
    app().log('error', `버전을 열 수 없습니다: ${errMsg(e)}`);
  } finally {
    app().setBusy(null);
  }
}

/** 내 컴퓨터의 .form3d 파일 열기 (새 프로젝트로 취급 — 저장하면 저장소에 새로 추가) */
export async function openLocalProjectFile(file: File): Promise<void> {
  if (!(await confirmDiscard('파일을 열기'))) return;
  app().setBusy('프로젝트 파일 여는 중…');
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (await applyProjectBytes(data, file.name)) {
      ps().set({ projectId: null, createdAt: null, lastSavedAt: null });
      await recoveryDb.clear().catch(() => undefined);
    }
  } finally {
    app().setBusy(null);
  }
}

/** 이름 바꾸기. 서버에 저장된 프로젝트면 저장소 이름도 바로 바꿉니다. */
export async function renameProject(name: string): Promise<void> {
  const clean = name.trim().slice(0, 120);
  if (!clean) {
    app().log('warn', '프로젝트 이름은 비워 둘 수 없습니다.');
    return;
  }
  app().setProjectName(clean);
  const id = ps().projectId;
  if (!id || ps().server !== 'online') return;
  try {
    const meta = await api.renameProject(id, clean);
    app().log('info', `프로젝트 이름 변경: ${meta.name}`);
    void refreshRecent();
  } catch (e) {
    app().log('error', `이름 변경 실패: ${errMsg(e)}`);
  }
}

export async function renameStoredProject(id: string, current: string): Promise<void> {
  const name = await dialog.prompt('프로젝트 이름 바꾸기', '새 이름', current, '바꾸기');
  if (!name) return;
  try {
    const meta = await api.renameProject(id, name);
    if (id === ps().projectId) app().setProjectName(meta.name);
    app().log('info', `프로젝트 이름 변경: ${current} → ${meta.name}`);
    void refreshRecent();
  } catch (e) {
    app().log('error', `이름 변경 실패: ${errMsg(e)}`);
  }
}

// ------------------------------------------------------------ 자동 저장 · 복구

let lastSnapshotRevision = -1;
let snapshotBusy = false;

/** 저장하지 않은 변경이 있으면 복구 스냅샷 기록 */
export async function writeRecoverySnapshot(force = false): Promise<boolean> {
  if (snapshotBusy || ps().recovery) return false;
  if (!isProjectDirty()) return false;
  const rev = engine.getRevision();
  if (!force && rev === lastSnapshotRevision) return false;
  snapshotBusy = true;
  try {
    const data = await buildProjectFile(app().projectName, false);
    await recoveryDb.put({
      data,
      name: app().projectName,
      projectId: ps().projectId,
      savedAt: Date.now(),
      objects: engine.root.children.length,
    });
    lastSnapshotRevision = rev;
    ps().set({ lastAutoSnapshotAt: Date.now() });
    return true;
  } catch (e) {
    app().log('warn', `복구용 자동 기록 실패: ${errMsg(e)}`);
    return false;
  } finally {
    snapshotBusy = false;
  }
}

/** 자동 저장 1회 판단 (테스트에서도 호출) */
export async function autosaveTick(now = Date.now(), force = false): Promise<void> {
  await writeRecoverySnapshot(force);
  const s = ps();
  if (
    s.autoSave &&
    s.projectId &&
    s.server === 'online' &&
    !s.saving &&
    !s.recovery &&
    isProjectDirty() &&
    (force || now - (s.lastSavedAt ?? 0) >= AUTOSAVE_EVERY_MS)
  ) {
    await saveCurrent({ auto: true });
  }
}

export async function checkRecovery(): Promise<void> {
  try {
    const snap = await recoveryDb.get();
    if (snap && snap.data?.length) ps().set({ recovery: snap });
  } catch {
    /* IndexedDB 사용 불가 → 복구 기능 없이 계속 */
  }
}

export async function restoreRecovery(): Promise<void> {
  const snap = ps().recovery;
  if (!snap) return;
  ps().set({ recovery: null });
  if (await applyProjectBytes(snap.data, '자동 복구')) {
    ps().set({ projectId: snap.projectId, createdAt: null, lastSavedAt: null });
    app().setProjectName(snap.name);
    setForceDirty();
    app().log('success', '저장하지 않았던 작업을 복구했습니다. 저장(Ctrl+S)해야 프로젝트에 반영됩니다.');
  }
}

export async function discardRecovery(): Promise<void> {
  ps().set({ recovery: null });
  await recoveryDb.clear().catch(() => undefined);
  app().log('info', '복구 기록을 버렸습니다.');
}

let started = false;
/** 앱 시작 시 1회: 서버 확인, 복구 확인, 자동 저장 타이머, 닫기 경고 */
export function startProjectServices(): void {
  if (started) return;
  started = true;
  void refreshServer();
  void checkRecovery();
  setInterval(() => void autosaveTick(), SNAPSHOT_EVERY_MS);
  setInterval(() => {
    if (ps().server !== 'online') void refreshServer();
  }, 30_000);
  window.addEventListener('beforeunload', (e) => {
    if (isProjectDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  (window as unknown as { __FORM3D_PROJECT__: unknown }).__FORM3D_PROJECT__ = {
    autosaveTick,
    writeRecoverySnapshot,
    isDirty: isProjectDirty,
    refreshServer,
    buildProjectFile,
  };
}
