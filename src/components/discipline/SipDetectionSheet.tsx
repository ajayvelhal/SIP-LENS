// SIP detection sheet (UI design §4.8): evidence sentence, InstalmentGrid, legend, step-ups.
import type { DetectedSip } from '../../engine';
import { PERIOD_WORD, formatMonthYear, formatRupees } from '../../lib/format';
import { Tooltip } from '../ui/Dialog';
import { InstalmentGrid } from './InstalmentGrid';

function evidenceText(sip: DetectedSip): string[] {
  const first = sip.amounts[0] as { amount: number };
  const pattern = `${sip.instalmentIds.length} purchases of ${formatRupees(first.amount)} (±1%) about a ${PERIOD_WORD[sip.frequency]} apart`;
  const description = 'rows marked Systematic Investment by the RTA';
  if (sip.evidence === 'description') return [description];
  if (sip.evidence === 'pattern') return [pattern];
  return [description, pattern];
}

export function SipDetectionSheet({ sip, fundName, onClose }: { sip: DetectedSip | null; fundName: string; onClose: () => void }) {
  return (
    <Tooltip open={sip !== null} onClose={onClose} title="How we detected this SIP" height="half">
      {sip && (
        <>
          <p className="text-small text-ink-2">{fundName}</p>
          <p className="mt-1 text-small text-ink-2">Evidence: {evidenceText(sip).join('; ')}</p>
          <div className="mt-3"><InstalmentGrid expected={sip.expected} /></div>
          {sip.amounts.length > 1 && (
            <p className="mt-2 text-caption text-ink-3">Step-ups: {sip.amounts.map((a) => `${formatRupees(a.amount)} from ${formatMonthYear(a.from)}`).join(', ')}</p>
          )}
        </>
      )}
    </Tooltip>
  );
}
