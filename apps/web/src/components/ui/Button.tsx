import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'subtle';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  active?: boolean;
  /** 아직 구현되지 않은 기능 표시 (예: "Phase 3") */
  badge?: string;
}

const base =
  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

const variants: Record<Variant, string> = {
  primary:
    'text-white bg-gradient-to-r from-accent to-accent-2 hover:brightness-110 disabled:hover:brightness-100',
  ghost: 'text-text hover:bg-white/5 disabled:hover:bg-transparent',
  subtle: 'text-text bg-panel-2 border border-line hover:border-accent/60 disabled:hover:border-line',
};

export function Button({ variant = 'ghost', icon, active, badge, className = '', children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${active ? 'bg-accent/20 text-white' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
      {badge && (
        <span className="ml-0.5 rounded bg-white/10 px-1 py-px text-[9px] font-semibold text-muted">
          {badge}
        </span>
      )}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label: string;
}

export function IconButton({ active, label, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ' +
        'disabled:opacity-40 disabled:cursor-not-allowed ' +
        (active ? 'bg-accent/25 text-white' : 'text-muted hover:bg-white/5 hover:text-text') +
        ` ${className}`
      }
      {...rest}
    >
      {children}
    </button>
  );
}
