import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Section({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center justify-between px-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-text"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title}
        </button>
        {right}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[11px] leading-relaxed text-muted">{children}</p>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}
