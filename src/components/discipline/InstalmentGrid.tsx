// InstalmentGrid (UI design component 24): one chip per expected instalment with glyph and word; list semantics.
import type { DetectedSip } from '../../engine';
import { formatMonthShort, formatMonthYear } from '../../lib/format';

const LOOK = {
  made: 'bg-sunken text-ink-2',
  missed: 'bg-caution-bg text-caution',
  stopped: 'border border-dotted border-border text-ink-3',
} as const;

const GLYPH = { made: '✓', missed: '×', stopped: '⋯' } as const;

export function InstalmentGrid({ expected }: { expected: DetectedSip['expected'] }) {
  return (
    <div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1" aria-label="Expected instalments">
        {expected.map((e) => (
          <li key={e.date} className="flex min-h-tap items-center justify-center">
            <span className={`flex min-h-[36px] w-full flex-col items-center justify-center rounded-sm px-1 text-caption ${LOOK[e.status]}`} aria-label={`${formatMonthYear(e.date)}, ${e.status}`}>
              <span aria-hidden="true">{GLYPH[e.status]} {formatMonthShort(e.date)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-caption text-ink-3" aria-hidden="true">✓ made · × missed · ⋯ stopped</p>
    </div>
  );
}
