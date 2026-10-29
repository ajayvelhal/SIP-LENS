// Dashboard section heading row: h2, optional InfoButton, badges and the as-of caption on the right.
import { forwardRef, type ReactNode } from 'react';
import { InfoButton } from './InfoButton';

interface Props {
  id: string;
  title: string;
  asOf?: string;
  info?: { label: string; expanded: boolean; onClick: () => void };
  badges?: ReactNode;
  children: ReactNode;
  className?: string;
}

export const Section = forwardRef<HTMLButtonElement, Props>(function Section({ id, title, asOf, info, badges, children, className = '' }, infoRef) {
  return (
    <section aria-labelledby={`${id}-heading`} className={`mt-8 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id={`${id}-heading`} className="text-h2 text-ink-1">{title}</h2>
        {info && <InfoButton ref={infoRef} label={info.label} expanded={info.expanded} onClick={info.onClick} />}
        {badges}
        {asOf && <span className="ml-auto text-caption text-ink-3">as of {asOf}</span>}
      </div>
      {children}
    </section>
  );
});
