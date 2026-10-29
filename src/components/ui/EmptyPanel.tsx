// EmptyPanel (UI design component 30): like ErrorPanel but inside the dashboard, sunken fill, no "Try another file".
import type { ReactNode } from 'react';
import { Glyph, type GlyphName } from './Glyph';

export function EmptyPanel({ title, children, glyph = 'info', actions, className = '' }: { title: string; children?: ReactNode; glyph?: GlyphName; actions?: ReactNode; className?: string }) {
  return (
    <div role="status" className={`rounded-lg border border-border bg-sunken p-6 ${className}`}>
      <Glyph name={glyph} size={32} className="text-ink-3" />
      <h3 className="mt-3 text-h3 text-ink-1">{title}</h3>
      {children && <div className="mt-2 text-body text-ink-2">{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
