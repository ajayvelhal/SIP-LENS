// Banner (UI design component 13): info (dismissible, role=status), caution (dismissible, role=alert),
// partial (not dismissible, role=alert).
import { useState, type ReactNode } from 'react';
import { Glyph } from './Glyph';

export type BannerVariant = 'info' | 'caution' | 'partial';

export function Banner({ variant, children, dismissible = variant !== 'partial', className = '', lead }: { variant: BannerVariant; children: ReactNode; dismissible?: boolean; className?: string; lead?: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const look = variant === 'info' ? 'bg-info-bg' : 'bg-caution-bg';
  const glyphColor = variant === 'info' ? 'text-accent' : 'text-caution';
  return (
    <div role={variant === 'info' ? 'status' : 'alert'} className={`relative z-banner flex w-full items-start gap-3 rounded-md px-4 py-3 text-body text-ink-1 ${look} ${className}`}>
      <Glyph name={variant === 'info' ? 'info' : 'caution'} className={`mt-0.5 ${glyphColor}`} />
      <div className="min-w-0 flex-1">
        {lead && <strong className="text-body-strong text-caution">{lead} </strong>}
        {children}
      </div>
      {dismissible && (
        <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss" className="-m-2 flex h-tap w-tap shrink-0 items-center justify-center rounded-sm text-accent hover:bg-surface/0">
          <Glyph name="close" size={18} />
        </button>
      )}
    </div>
  );
}
