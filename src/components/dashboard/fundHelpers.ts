// Small presentational helpers shared by the fund card, the fund table and the Should sections.
import type { CategoryInfo, DetectedSip, Fund } from '../../engine';
import { FREQUENCY_WORD, formatMonthYear, formatRupees } from '../../lib/format';
import type { Bucket } from '../ui/Badge';

export function bucketOf(category: CategoryInfo | undefined): Bucket {
  return category?.category ?? 'Unclassified';
}

export function folioLabel(fund: Fund): string {
  const numbers = fund.folios.map((f) => f.folioNumber);
  return numbers.length === 1 ? `Folio ${numbers[0]}` : `Folios ${numbers.join(', ')}`;
}

/** "SIP ₹5,000 monthly since Mar 2021", with step-ups and the stopped form (UI design §4.5.6). */
export function sipLineText(sip: DetectedSip): string {
  const freq = FREQUENCY_WORD[sip.frequency];
  const last = sip.amounts[sip.amounts.length - 1] as { amount: number; from: string };
  const amount = formatRupees(last.amount);
  if (sip.stoppedSince) {
    return `SIP ${amount} ${freq}, ${formatMonthYear(sip.firstDate)} – ${formatMonthYear(sip.lastObserved)} (stopped)`;
  }
  let text = `SIP ${amount} ${freq} since ${formatMonthYear(sip.firstDate)}`;
  if (sip.amounts.length > 1) {
    const previous = sip.amounts[sip.amounts.length - 2] as { amount: number; from: string };
    const until = previousMonth(last.from);
    text += ` (${formatRupees(previous.amount)} until ${formatMonthYear(until)})`;
  }
  return text;
}

function previousMonth(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

export function schemeNameOf(fundById: Map<string, Fund>, fundId: string): string {
  return fundById.get(fundId)?.schemeName ?? fundId;
}
