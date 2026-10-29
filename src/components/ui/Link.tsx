// Link (UI design component 3): accent, always underlined; `external` adds hidden "(opens GitHub)" and rel noopener.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Glyph } from './Glyph';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: 'inline' | 'standalone' | 'external';
  children: ReactNode;
}

export function Link({ variant = 'inline', className = '', children, ...rest }: LinkProps) {
  const standalone = variant !== 'inline' ? 'inline-flex min-h-tap items-center gap-1 py-2' : '';
  if (variant === 'external') {
    return (
      <a className={`text-accent underline underline-offset-2 ${standalone} ${className}`} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
        <Glyph name="external" size={14} />
        <span className="sr-only"> (opens GitHub)</span>
      </a>
    );
  }
  return (
    <a className={`text-accent underline underline-offset-2 ${standalone} ${className}`} {...rest}>
      {children}
    </a>
  );
}

/** A button that reads as a link: for in-page actions (open a drawer) that the design names as Links. */
export function LinkButton({ className = '', children, sm = false, ...rest }: { className?: string; children: ReactNode; sm?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`inline-flex min-h-tap items-center gap-1 rounded-sm text-left text-accent underline underline-offset-2 ${sm ? 'text-small' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}
