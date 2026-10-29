// Disclosure (UI design component 26): ghost button with chevron and aria-expanded revealing a region.
import { useId, useState, type ReactNode } from 'react';
import { Glyph } from './Glyph';

export function Disclosure({ label, children, defaultOpen = false, className = '' }: { label: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-tap items-center gap-1 rounded-sm py-2 pr-2 text-body-strong text-accent"
      >
        <Glyph name="chevron" size={18} className={`transition-transform duration-fast ${open ? 'rotate-90' : ''}`} />
        {label}
      </button>
      {open && <div id={id} className="mt-2">{children}</div>}
    </div>
  );
}
