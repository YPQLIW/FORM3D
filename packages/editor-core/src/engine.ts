import { Box3, Group, Vector3, type Object3D } from 'three';
import type { HistoryEntryInfo, SceneNodeInfo } from '@form3d/model-types';
import { CommandHistory, type EditorCommand } from './history';
import { getSource } from './metadata';

/** 그룹 해제 가능한 노드: 렌더링 대상이 아닌 Group/Object3D 이면서 자식이 있음 */
export function isGroupLike(o: Object3D): boolean {
  return (o.type === 'Group' || o.type === 'Object3D' || o.type === 'Scene') && o.children.length > 0;
}

type Listener = () => void;

/**
 * FORM3D 에디터 엔진.
 * - Three.js 씬 그래프(root)가 실제 메시/재질 데이터의 원본입니다.
 * - React UI는 subscribe/getRevision으로 변경을 구독합니다.
 */
export class EditorEngine {
  /** 사용자 콘텐츠만 담는 루트. 카메라/헬퍼/조명은 포함하지 않습니다. */
  readonly root: Group;
  readonly history = new CommandHistory();

  private selection: string[] = [];
  private revision = 0;
  private listeners = new Set<Listener>();

  constructor() {
    this.root = new Group();
    this.root.name = 'Scene';
  }

  // ---------- 구독 ----------
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  /** 상태가 변했음을 UI에 알림 (드래그 중 실시간 갱신 등) */
  notify(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  // ---------- 명령 ----------
  execute(command: EditorCommand): void {
    command.execute(this);
    this.history.push(command);
    this.notify();
  }

  /** 이미 적용된 변경(드래그, 슬라이더 등)을 기록만 함 */
  record(command: EditorCommand): void {
    this.history.push(command);
    this.notify();
  }

  undo(): EditorCommand | undefined {
    const r = this.history.popUndo();
    if (!r) return undefined;
    r.command.undo(this);
    this.notify();
    return r.command;
  }

  redo(): EditorCommand | undefined {
    const r = this.history.popRedo();
    if (!r) return undefined;
    r.command.execute(this);
    this.notify();
    return r.command;
  }

  // ---------- 저장 상태 (Phase 3) ----------
  private savedTop: EditorCommand | null = null;

  /** 현재 상태를 "저장됨"으로 표시 */
  markSaved(): void {
    this.savedTop = this.history.undoRecords.at(-1)?.command ?? null;
    this.notify();
  }

  /** 마지막 저장 이후 편집 내용이 바뀌었는지 (Undo로 저장 시점에 돌아가면 다시 false) */
  isDirty(): boolean {
    return (this.history.undoRecords.at(-1)?.command ?? null) !== this.savedTop;
  }

  getHistoryEntries(): { done: HistoryEntryInfo[]; undone: HistoryEntryInfo[] } {
    const map = (list: readonly { command: EditorCommand; timestamp: number }[]) =>
      list.map((r, index) => ({
        index,
        name: r.command.name,
        label: r.command.label,
        timestamp: r.timestamp,
      }));
    return {
      done: map(this.history.undoRecords),
      undone: map(this.history.redoRecords).reverse(),
    };
  }

  // ---------- 선택 ----------
  // Phase 2: 여러 오브젝트 선택. 배열의 마지막 항목이 "활성(active)" 오브젝트입니다.
  // Phase 1 API(getSelectedId/getSelected/select)는 활성 오브젝트 기준으로 그대로 동작합니다.

  /** 활성 오브젝트 id (여러 개 선택 시 마지막으로 선택한 것) */
  getSelectedId(): string | null {
    return this.selection.length ? this.selection[this.selection.length - 1] : null;
  }

  /** 활성 오브젝트 */
  getSelected(): Object3D | null {
    const id = this.getSelectedId();
    return id ? this.getObject(id) : null;
  }

  getSelectedIds(): readonly string[] {
    return this.selection;
  }

  getSelectedObjects(): Object3D[] {
    return this.selection.map((id) => this.getObject(id)).filter((o): o is Object3D => !!o);
  }

  isSelected(id: string): boolean {
    return this.selection.includes(id);
  }

  /**
   * 선택된 오브젝트 중 다른 선택 오브젝트의 하위가 아닌 것만 반환합니다.
   * (부모와 자식을 함께 선택했을 때 이동/복제/삭제가 두 번 적용되지 않도록)
   * 반환 순서는 씬 계층 순서입니다.
   */
  getTopLevelSelection(): Object3D[] {
    const set = new Set(this.getSelectedObjects());
    const out: Object3D[] = [];
    this.root.traverse((o) => {
      if (!set.has(o)) return;
      let p = o.parent;
      while (p && p !== this.root) {
        if (set.has(p)) return;
        p = p.parent;
      }
      out.push(o);
    });
    return out;
  }

  /** 하나만 선택 (null이면 선택 해제) */
  select(id: string | null): void {
    const next = id && this.getObject(id) ? [id] : [];
    if (next.length === this.selection.length && next.every((v, i) => v === this.selection[i])) return;
    this.selection = next;
    this.notify();
  }

  /** 선택 목록을 통째로 설정. 마지막 id가 활성 오브젝트가 됩니다. */
  setSelection(ids: readonly string[]): void {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of ids) {
      if (seen.has(id) || !this.getObject(id)) continue;
      seen.add(id);
      next.push(id);
    }
    if (next.length === this.selection.length && next.every((v, i) => v === this.selection[i])) return;
    this.selection = next;
    this.notify();
  }

  /** Ctrl/Shift 클릭: 선택에 추가하거나, 이미 선택돼 있으면 제외 */
  toggleSelection(id: string): void {
    if (!this.getObject(id)) return;
    if (this.selection.includes(id)) this.setSelection(this.selection.filter((s) => s !== id));
    else this.setSelection([...this.selection, id]);
  }

  /** 최상위 오브젝트 전체 선택 */
  selectAll(): void {
    this.setSelection(this.root.children.map((o) => o.uuid));
  }

  /** 씬에서 빠진 오브젝트를 선택에서 제거 (notify 없음, 명령 내부용) */
  validateSelection(): void {
    this.selection = this.selection.filter((id) => !!this.getObject(id));
  }

  // ---------- 조회 ----------
  getObject(id: string): Object3D | null {
    if (id === this.root.uuid) return null;
    return this.root.getObjectByProperty('uuid', id) ?? null;
  }

  isInScene(obj: Object3D): boolean {
    let p: Object3D | null = obj;
    while (p) {
      if (p === this.root) return true;
      p = p.parent;
    }
    return false;
  }

  getHierarchy(): SceneNodeInfo[] {
    const build = (o: Object3D): SceneNodeInfo => ({
      id: o.uuid,
      name: o.name || `(${o.type})`,
      kind: o.type,
      source: getSource(o),
      visible: o.visible,
      groupLike: isGroupLike(o),
      children: o.children.map(build),
    });
    return this.root.children.map(build);
  }

  /** 씬 전체에서 고유한 이름 생성: Box, Box.001, Box.002 ... */
  uniqueName(base: string): string {
    const names = new Set<string>();
    this.root.traverse((o) => names.add(o.name));
    if (!names.has(base)) return base;
    for (let i = 1; i < 10000; i++) {
      const candidate = `${base}.${String(i).padStart(3, '0')}`;
      if (!names.has(candidate)) return candidate;
    }
    return `${base}.${Date.now()}`;
  }

  getWorldBounds(obj: Object3D = this.root): Box3 | null {
    obj.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(obj, true);
    return box.isEmpty() ? null : box;
  }

  /** 여러 오브젝트의 월드 바운딩 박스 합집합 */
  getUnionBounds(objects: Object3D[]): Box3 | null {
    const box = new Box3();
    for (const o of objects) {
      const b = this.getWorldBounds(o);
      if (b) box.union(b);
      else box.expandByPoint(o.getWorldPosition(new Vector3()));
    }
    return box.isEmpty() ? null : box;
  }

  getWorldCenter(obj: Object3D): Vector3 {
    const box = this.getWorldBounds(obj);
    return box ? box.getCenter(new Vector3()) : obj.getWorldPosition(new Vector3());
  }

  /** 모든 사용자 콘텐츠 제거 (기록 포함) */
  reset(): void {
    for (const c of [...this.root.children]) c.removeFromParent();
    this.history.clear();
    this.savedTop = null;
    this.selection = [];
    this.notify();
  }
}
