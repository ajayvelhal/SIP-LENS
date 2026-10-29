// Badge (UI design component 14). `category` carries an 8 px swatch dot in the bucket's chart colour.
import type { ReactNode } from 'react';
import { Glyph } from './Glyph';

export type BadgeVariant = 'category' | 'elss' | 'caution' | 'info' | 'neutral' | 'sample';
export type Bucket = 'Equity' | 'Hybrid' | 'Debt' | 'Other' | 'Unclassified';

export const BUCKET_FILL: Record<Bucket, string> = {
  Equity: 'bg-chart-equity',
  Hybrid: 'bg-chart-hybrid',
  Debt: 'bg-chart-debt',
  Other: 'bg-chart-other',
  Unclassified: 'bg-chart-unclassified',
};

const LOOK: Record<BadgeVariant, string> = {
  category: 'bg-sunken text-ink-2',
  elss: 'bg-sunken text-ink-2',
  caution: 'bg-caution-bg text-caution',
  info: 'bg-info-bg text-accent',
  neutral: 'bg-sunken text-ink-3',
  sample: 'bg-info-bg text-accent',
};

export function Badge({ variant, bucket, children, className = '' }: { variant: BadgeVariant; bucket?: Bucket; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-caption font-semibold ${LOOK[variant]} ${className}`}>
      {variant === 'category' && bucket && <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${BUCKET_FILL[bucket]}`} />}
      {variant === 'caution' && <Glyph name="caution" size={12} />}
      {children}
    </span>
  );
}

export function CategoryBadge({ bucket }: { bucket: Bucket }) {
  return <Badge variant="category" bucket={bucket}>{bucket}</Badge>;
}
