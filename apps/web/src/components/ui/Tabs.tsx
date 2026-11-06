import type { ReactNode } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  right,
  stretch = false,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (v: T) => void;
  right?: ReactNode;
  /** 탭을 가로 폭에 맞게 균등 배치 */
  stretch?: boolean;
}) {
  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-line bg-panel">
      <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={
              'flex shrink-0 items-center justify-center gap-1 border-b-2 px-2.5 text-[11px] font-medium transition-colors ' +
              (stretch ? 'grow ' : '') +
              (value === t.id
                ? 'border-accent text-white'
                : 'border-transparent text-muted hover:text-text')
            }
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {right && <div className="flex items-center pr-1">{right}</div>}
    </div>
  );
}
