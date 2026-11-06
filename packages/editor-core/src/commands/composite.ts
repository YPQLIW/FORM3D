import type { HistoryCommandName } from '@form3d/model-types';
import type { EditorCommand } from '../history';
import type { EditorEngine } from '../engine';

/**
 * 여러 명령을 하나의 실행 취소 단위로 묶습니다.
 * - 실행 전/후의 선택 상태를 기억해 Undo/Redo 시 선택도 함께 복원합니다.
 * - 실행 도중 하나라도 실패하면 이미 실행된 명령을 되돌리고 오류를 다시 던집니다.
 */
export class CompositeCommand implements EditorCommand {
  private selectionBefore: string[] | null = null;
  private selectionAfter: string[] | null = null;

  constructor(
    readonly name: HistoryCommandName,
    readonly label: string,
    private readonly commands: EditorCommand[],
    /** 실행 후 선택할 오브젝트 id 목록 (없으면 하위 명령이 정한 선택 유지) */
    private readonly selectAfter?: () => string[],
  ) {
    if (commands.length === 0) throw new Error('실행할 명령이 없습니다.');
  }

  /**
   * 이미 하위 명령들이 실행된 상태로 기록할 때 사용 (AI 작업처럼 단계별로 실행하며 결과를 확인한 경우).
   * 이후 Undo/Redo 시 지정한 선택 상태로 복원합니다.
   */
  markExecuted(selectionBefore: string[], selectionAfter: string[]): this {
    this.selectionBefore = [...selectionBefore];
    this.selectionAfter = [...selectionAfter];
    return this;
  }

  get size(): number {
    return this.commands.length;
  }

  execute(engine: EditorEngine): void {
    if (this.selectionBefore === null) this.selectionBefore = [...engine.getSelectedIds()];
    const done: EditorCommand[] = [];
    try {
      for (const c of this.commands) {
        c.execute(engine);
        done.push(c);
      }
    } catch (err) {
      for (const c of done.reverse()) c.undo(engine);
      engine.validateSelection();
      throw err;
    }
    engine.validateSelection();
    if (this.selectionAfter === null) {
      this.selectionAfter = this.selectAfter ? this.selectAfter() : [...engine.getSelectedIds()];
    }
    engine.setSelection(this.selectionAfter);
  }

  undo(engine: EditorEngine): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo(engine);
    engine.validateSelection();
    // record()로 기록만 된 경우(드래그 등)는 선택 스냅샷이 없으므로 현재 선택 유지
    if (this.selectionBefore) engine.setSelection(this.selectionBefore);
  }
}
