// Discipline totals and screen-reader text shared by the tile and the section (UI design §4.8, §8.4).
import type { DisciplineResult } from '../../engine';

export interface DisciplineTotals { made: number; expected: number; missed: number; stopped: number }

/** `expected` counts made + missed (stopped periods are not expected), matching the score's denominator. */
export function disciplineTotals(d: DisciplineResult): DisciplineTotals {
  let made = 0, missed = 0, stopped = 0;
  for (const s of d.sips) {
    made += s.counts.made;
    missed += s.counts.missed;
    if (s.stoppedSince) stopped++;
  }
  return { made, missed, stopped, expected: made + missed };
}

export function totalsSentence(t: DisciplineTotals): string {
  const parts = [`${t.made} of ${t.expected} instalments made`];
  if (t.missed > 0) parts.push(`${t.missed} missed`);
  if (t.stopped > 0) parts.push(`${t.stopped} ${t.stopped === 1 ? 'SIP' : 'SIPs'} stopped`);
  return parts.join(' · ');
}

export function disciplineAriaLabel(d: DisciplineResult, asOfText: string): string {
  if (d.score === null) return 'SIP discipline score not available: no regular SIP found in this statement.';
  const t = disciplineTotals(d);
  return `SIP discipline score ${d.score} out of 100 as of ${asOfText}: ${t.made} of ${t.expected} instalments made, ${t.missed} missed, ${t.stopped} SIPs stopped.`;
}
