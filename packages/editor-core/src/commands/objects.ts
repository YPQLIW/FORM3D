import type { Object3D } from 'three';
import type { EditorCommand } from '../history';
import type { EditorEngine } from '../engine';

function insertChildAt(parent: Object3D, child: Object3D, index: number): void {
  parent.add(child);
  const arr = parent.children;
  const cur = arr.indexOf(child);
  const target = Math.max(0, Math.min(index, arr.length - 1));
  if (cur !== target) {
    arr.splice(cur, 1);
    arr.splice(target, 0, child);
  }
}

export class AddObjectCommand implements EditorCommand {
  readonly name = 'AddObject' as const;
  readonly label: string;
  private parent: Object3D | null;

  constructor(
    private readonly object: Object3D,
    parent?: Object3D,
    label?: string,
  ) {
    this.parent = parent ?? null;
    this.label = label ?? `추가: ${object.name}`;
  }

  execute(engine: EditorEngine): void {
    const parent = this.parent ?? engine.root;
    this.parent = parent;
    parent.add(this.object);
    engine.select(this.object.uuid);
  }

  undo(engine: EditorEngine): void {
    this.object.removeFromParent();
    engine.validateSelection();
  }
}

export class RemoveObjectCommand implements EditorCommand {
  readonly name = 'RemoveObject' as const;
  readonly label: string;
  private parent: Object3D | null = null;
  private index = 0;

  constructor(private readonly object: Object3D) {
    this.label = `삭제: ${object.name}`;
  }

  execute(engine: EditorEngine): void {
    this.parent = this.object.parent;
    if (!this.parent) throw new Error('이미 씬에서 제거된 오브젝트입니다.');
    this.index = this.parent.children.indexOf(this.object);
    this.object.removeFromParent();
    engine.validateSelection();
  }

  undo(engine: EditorEngine): void {
    if (!this.parent) return;
    insertChildAt(this.parent, this.object, this.index);
    engine.select(this.object.uuid);
  }
}

export class RenameObjectCommand implements EditorCommand {
  readonly name = 'RenameObject' as const;
  readonly label: string;
  private readonly before: string;

  constructor(
    private readonly object: Object3D,
    private readonly after: string,
  ) {
    this.before = object.name;
    this.label = `이름 변경: ${this.before} → ${after}`;
  }

  execute(): void {
    this.object.name = this.after;
  }

  undo(): void {
    this.object.name = this.before;
  }
}

export class SetVisibilityCommand implements EditorCommand {
  readonly name = 'SetVisibility' as const;
  readonly label: string;

  constructor(
    private readonly object: Object3D,
    private readonly visible: boolean,
  ) {
    this.label = `${visible ? '표시' : '숨김'}: ${object.name}`;
  }

  execute(): void {
    this.object.visible = this.visible;
  }

  undo(): void {
    this.object.visible = !this.visible;
  }
}
