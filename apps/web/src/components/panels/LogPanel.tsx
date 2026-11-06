import { useEffect, useRef } from 'react';
import { useAppStore, type LogLevel } from '../../state/appStore';

const COLOR: Record<LogLevel, string> = {
  info: 'text-muted',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const TAG: Record<LogLevel, string> = { info: 'INFO', success: ' OK ', warn: 'WARN', error: 'ERR ' };

export function LogPanel() {
  const logs = useAppStore((s) => s.logs);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);
  return (
    <div className="p-2 font-mono text-[11px]" data-testid="log-panel">
      {logs.map((l) => (
        <div key={l.id} className="flex gap-3 px-2 py-0.5" data-level={l.level}>
          <span className="w-16 shrink-0 text-muted">{new Date(l.time).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span className={`shrink-0 whitespace-pre ${COLOR[l.level]}`}>{TAG[l.level]}</span>
          <span className={l.level === 'info' ? 'text-text' : COLOR[l.level]}>{l.message}</span>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
