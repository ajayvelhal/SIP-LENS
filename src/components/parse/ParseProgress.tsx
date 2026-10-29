// S3 Parse progress (UI design §4.3): determinate bar per page, indeterminate while the portfolio is built,
// live partial-warning count, Cancel. The polite live region hears "Page n of N" at most once per second.
import { useEffect, useRef } from 'react';
import type { DocumentType, ParseWarning } from '../../engine';
import { announce } from '../../lib/announce';
import { plural } from '../../lib/format';
import { Button } from '../ui/Button';
import { Glyph } from '../ui/Glyph';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  page: number;
  pageCount: number;
  stage: 'extract' | 'parse';
  documentType?: DocumentType;
  liveWarnings: ParseWarning[];
  onCancel: () => void;
}

/** The detected event carries the document type only; the RTA is known at result time, so the sub-line stays generic. */
function subLine(stage: 'extract' | 'parse', documentType?: DocumentType): string {
  if (stage === 'parse') return 'Building your portfolio…';
  if (!documentType) return 'Opening the PDF…';
  return 'Reading your statement…';
}

export function ParseProgress({ page, pageCount, stage, documentType, liveWarnings, onCancel }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastAnnounce = useRef(0);
  const pageLabel = stage === 'parse' ? 'Building your portfolio…' : `Page ${page} of ${pageCount}`;

  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    const now = performance.now();
    if (stage === 'parse') { announce('Building your portfolio'); return; }
    if (now - lastAnnounce.current >= 1000 || page === pageCount) {
      lastAnnounce.current = now;
      announce(`Page ${page} of ${pageCount}`);
    }
  }, [page, pageCount, stage]);

  const unreadable = liveWarnings.filter((w) => w.rowIndex !== undefined).length;

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pt-8 md:px-6">
      <h1 ref={headingRef} tabIndex={-1} className="text-h2 text-ink-1 outline-none">Reading your statement</h1>
      <p className="mt-1 text-body text-ink-2">{subLine(stage, documentType)}</p>
      <ProgressBar
        className="mt-4"
        label="Reading your statement"
        value={stage === 'extract' ? page : undefined}
        max={stage === 'extract' ? pageCount : undefined}
        valueText={pageLabel}
      />
      <p className="mt-2 text-small text-ink-2">{pageLabel}</p>
      {unreadable > 0 && (
        <p className="mt-2 flex items-center gap-1 text-caption text-caution">
          <Glyph name="caution" size={14} />
          {plural(unreadable, 'line')} couldn't be read so far
        </p>
      )}
      <Button variant="secondary" onClick={onCancel} className="mt-6">Cancel</Button>
      <p className="mt-4 flex items-center gap-1 text-caption text-ink-3">
        <Glyph name="lock" size={14} />
        Nothing leaves this tab.
      </p>
    </main>
  );
}
