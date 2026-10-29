// Tile (UI design component 8): label with optional InfoButton, value, as-of caption, optional caution footnote.
import { forwardRef, type ReactNode } from 'react';
import { Glyph } from './Glyph';
import { InfoButton } from './InfoButton';

interface Props {
  label: string;
  children: ReactNode;
  asOf: string;
  info?: { expanded: boolean; onClick: () => void };
  footnotes?: string[];
  badges?: ReactNode;
  className?: string;
}

export const Tile = forwardRef<HTMLButtonElement, Props>(function Tile({ label, children, asOf, info, footnotes = [], badges, className = '' }, infoRef) {
  return (
    <div className={`flex min-h-[160px] flex-col rounded-md border border-border bg-surface p-4 lg:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-small text-ink-2">{label}</span>
        {info && <InfoButton ref={infoRef} label={label} expanded={info.expanded} onClick={info.onClick} className="-mr-3 -mt-3" />}
      </div>
      <div className="mt-2 flex-1">{children}</div>
      {badges && <div className="mt-1 flex flex-wrap gap-1">{badges}</div>}
      <div className="mt-2 text-caption text-ink-3">as of {asOf}</div>
      {footnotes.map((f) => (
        <div key={f} className="mt-1 flex items-start gap-1 text-caption text-caution">
          <Glyph name="caution" size={14} className="mt-px shrink-0" />
          <span>{f}</span>
        </div>
      ))}
    </div>
  );
});
