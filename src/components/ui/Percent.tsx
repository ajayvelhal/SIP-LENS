// Percent (UI design component 16): xirr (with gain/loss word, dash states, multiple-roots badge), gap, share.
import type { ReactNode } from 'react';
import type { FundXirrResult, XirrResult } from '../../engine';
import { DASH, formatGap, formatXirr } from '../../lib/format';
import { Badge } from './Badge';
import { Glyph } from './Glyph';
import { numClass, type NumStyle } from './Money';

export type AnyXirr = XirrResult | FundXirrResult;

export function xirrReason(x: AnyXirr): string {
  if (x.status === 'ok') return '';
  if (x.status === 'insufficient') {
    return x.reason === 'opening-balance-without-history'
      ? "Not enough history: this statement doesn't start at the fund's inception. Request a since-inception CAS."
      : 'Not enough history to compute XIRR';
  }
  return "Couldn't compute; see cash flows";
}

interface XirrProps {
  value: AnyXirr;
  style?: NumStyle;
  /** Rendered in place of the plain reason text (lets a screen turn "see cash flows" into a Link). */
  reason?: ReactNode;
  /** Adds the caution glyph (may be incomplete). */
  caution?: boolean;
  /** Stack the word under the number (tiles) instead of beside it (cards, tables). */
  stacked?: boolean;
  className?: string;
}

export function PercentXirr({ value, style = 'num-lg', reason, caution = false, stacked = false, className = '' }: XirrProps) {
  if (value.status !== 'ok') {
    return (
      <span className={`inline-flex flex-col ${className}`}>
        <span className={`${numClass(style)} text-ink-3`} aria-label="not available">{DASH}</span>
        <span className="text-caption text-ink-3">{reason ?? xirrReason(value)}</span>
      </span>
    );
  }
  const rate = value.rate;
  const zero = Math.round(Math.abs(rate) * 1000) === 0;
  const color = zero ? 'text-ink-1' : rate > 0 ? 'text-gain' : 'text-loss';
  const word = zero ? '' : rate > 0 ? 'gain' : 'loss';
  const multi = value.warning === 'multiple-roots';
  return (
    <span className={`inline-flex ${stacked ? 'flex-col' : 'flex-wrap items-baseline gap-x-1'} ${className}`}>
      <span className={`inline-flex items-center gap-1 ${numClass(style)} ${color}`}>
        {formatXirr(rate)}
        {(caution || multi) && <Glyph name="caution" size={16} className="text-caution" />}
      </span>
      {word && <span className={`text-caption ${color}`}>{word}</span>}
      {multi && <Badge variant="caution" className="mt-1">check cash flows</Badge>}
    </span>
  );
}

export function PercentGap({ gapPoints, style = 'num-lg', className = '' }: { gapPoints: number; style?: NumStyle; className?: string }) {
  const g = formatGap(gapPoints);
  const color = g.sign === 0 ? 'text-ink-1' : g.sign > 0 ? 'text-gain' : 'text-loss';
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1 ${className}`}>
      <span className={`${numClass(style)} ${color}`}>{g.text}</span>
      <span className={`text-caption ${color}`}>{g.word}</span>
    </span>
  );
}
