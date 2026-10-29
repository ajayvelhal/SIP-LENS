// Button (UI design component 2): primary, secondary, ghost; `sm` keeps a 44 px hit area through padding.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function buttonClass(variant: ButtonVariant, sm = false, extra = ''): string {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md no-underline transition-colors duration-fast disabled:opacity-60 disabled:cursor-not-allowed';
  const size = sm ? 'min-h-[36px] px-3 py-1 text-small font-semibold before:absolute before:inset-[-4px] relative' : 'min-h-tap px-5 py-2 text-body-strong';
  const look = {
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    secondary: 'bg-surface text-ink-1 border border-border-strong hover:bg-sunken',
    ghost: 'bg-transparent text-accent hover:bg-sunken',
  }[variant];
  return `${base} ${size} ${look} ${extra}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  sm?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', sm = false, className = '', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, sm, className)} {...rest}>
      {children}
    </button>
  );
}
