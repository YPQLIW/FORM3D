import { engine, useEngineRevision } from '../../state/engine';
import { EmptyState } from '../ui/Section';

/** 명령 실행 내역 (Undo 스택 / Redo 스택) */
export function HistoryPanel() {
  useEngineRevision();
  const { done, undone } = engine.getHistoryEntries();
  if (done.length === 0 && undone.length === 0) {
    return (
      <div className="px-3">
        <EmptyState>아직 실행된 편집 명령이 없습니다.</EmptyState>
      </div>
    );
  }
  return (
    <ol className="p-2 font-mono text-[11px]">
      {done.map((h, i) => (
        <li key={`d${i}`} className="flex gap-3 rounded px-2 py-0.5 hover:bg-white/5">
          <span className="w-16 shrink-0 text-muted">{new Date(h.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span className="w-28 shrink-0 text-accent">{h.name}</span>
          <span className="truncate">{h.label}</span>
        </li>
      ))}
      {undone.map((h, i) => (
        <li key={`u${i}`} className="flex gap-3 rounded px-2 py-0.5 text-muted line-through opacity-60">
          <span className="w-16 shrink-0">{new Date(h.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span className="w-28 shrink-0">{h.name}</span>
          <span className="truncate">{h.label} (취소됨)</span>
        </li>
      ))}
    </ol>
  );
}
