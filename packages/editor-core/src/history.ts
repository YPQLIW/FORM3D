import type { HistoryCommandName } from '@form3d/model-types';
import type { EditorEngine } from './engine';

/**
 * 모든 편집은 Command로 표현됩니다.
 * Undo/Redo, 작업 기록, (Phase 4) AI 명령 실행이 같은 경로를 사용합니다.
 */
export interface EditorCommand {
  readonly name: HistoryCommandName;
  readonly label: string;
  execute(engine: EditorEngine): void;
  undo(engine: EditorEngine): void;
}

export interface HistoryRecord {
  command: EditorCommand;
  timestamp: number;
}

export class CommandHistory {
  private undoStack: HistoryRecord[] = [];
  private redoStack: HistoryRecord[] = [];

  constructor(private readonly limit = 200) {}

  push(command: EditorCommand): void {
    this.undoStack.push({ command, timestamp: Date.now() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  popUndo(): HistoryRecord | undefined {
    const r = this.undoStack.pop();
    if (r) this.redoStack.push(r);
    return r;
  }

  popRedo(): HistoryRecord | undefined {
    const r = this.redoStack.pop();
    if (r) this.undoStack.push(r);
    return r;
  }

  /** 실행 중 실패한 명령을 되돌린 상태로 정리 */
  discardLastUndo(): void {
    this.undoStack.pop();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoRecords(): readonly HistoryRecord[] {
    return this.undoStack;
  }

  get redoRecords(): readonly HistoryRecord[] {
    return this.redoStack;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
