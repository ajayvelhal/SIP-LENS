// Allocation (UI design §4.5.5): one-row horizontal stacked bar (Recharts) with a legend table that is also the
// screen-reader twin. Zero buckets are omitted; the Unclassified note links to GitHub.
import { Bar, BarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import type { AllocationResult } from '../../engine';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { formatDate, formatRupees, formatShare, plural } from '../../lib/format';
import { LINKS } from '../../lib/links';
import { BUCKET_FILL, type Bucket } from '../ui/Badge';
import { DataTable } from '../ui/DataTable';
import { Link } from '../ui/Link';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { EmptyPanel } from '../ui/EmptyPanel';

const FILL_VAR: Record<Bucket, string> = {
  Equity: 'var(--color-chart-equity)',
  Hybrid: 'var(--color-chart-hybrid)',
  Debt: 'var(--color-chart-debt)',
  Other: 'var(--color-chart-other)',
  Unclassified: 'var(--color-chart-unclassified)',
};

interface Props {
  allocation: 'loading' | { ok: true; value: AllocationResult } | { ok: false };
  asOf: string;
}

export function AllocationBar({ allocation, asOf }: Props) {
  const reduced = useReducedMotion();
  const asOfText = formatDate(asOf);

  if (allocation === 'loading') {
    return (
      <Section id="allocation" title="Allocation" asOf={asOfText}>
        <Skeleton className="h-7 w-full" label="Loading allocation" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-1/3" />
        </div>
      </Section>
    );
  }
  if (!allocation.ok) {
    return (
      <Section id="allocation" title="Allocation" asOf={asOfText}>
        <EmptyPanel title="This section couldn't be computed" />
      </Section>
    );
  }
  const { buckets, total, unclassifiedCount } = allocation.value;
  const visible = buckets.filter((b) => b.value > 0);
  const data = [Object.fromEntries([['name', 'Allocation'], ...visible.map((b) => [b.category, b.value])])];
  const ariaLabel = `Allocation by value as of ${asOfText}: ${visible.map((b) => `${b.category} ${formatRupees(b.value)}, ${formatShare(b.percent)}`).join('; ')}${unclassifiedCount > 0 ? ` (${plural(unclassifiedCount, 'fund')} unclassified)` : ''}.`;

  return (
    <Section id="allocation" title="Allocation" asOf={asOfText}>
      {visible.length === 0 ? (
        <p className="text-body text-ink-2">No printed values to allocate.</p>
      ) : (
        <div role="img" aria-label={ariaLabel} className="h-11 w-full">
          <ResponsiveContainer width="100%" height={44}>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 0, bottom: 8, left: 0 }} barCategoryGap={0}>
              <XAxis type="number" hide domain={[0, total]} />
              <YAxis type="category" dataKey="name" hide />
              <ChartTooltip
                cursor={{ fill: 'var(--color-sunken)' }}
                content={({ payload }) => {
                  const p = payload?.[0];
                  if (!p) return null;
                  const bucket = visible.find((b) => b.category === p.dataKey);
                  if (!bucket) return null;
                  return <div className="rounded-md border border-border bg-surface px-3 py-2 text-small text-ink-1 shadow-e-2">{bucket.category} · {formatRupees(bucket.value)} · {formatShare(bucket.percent)}</div>;
                }}
              />
              {visible.map((b, i) => (
                <Bar
                  key={b.category}
                  dataKey={b.category}
                  stackId="a"
                  fill={FILL_VAR[b.category]}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  radius={visible.length === 1 ? [6, 6, 6, 6] : i === 0 ? [6, 0, 0, 6] : i === visible.length - 1 ? [0, 6, 6, 0] : 0}
                  isAnimationActive={!reduced}
                  animationDuration={300}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <DataTable
        className="mt-3 border-0 bg-transparent"
        caption={`Allocation by value as of ${asOfText}`}
        captionHidden
        headless
        rows={visible}
        rowKey={(b) => b.category}
        columns={[
          { key: 'swatch', header: '', className: 'w-6 pr-0', cell: (b) => <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${BUCKET_FILL[b.category]}`} /> },
          { key: 'name', header: 'Category', cell: (b) => <span className="text-small text-ink-1">{b.category}</span> },
          { key: 'value', header: 'Value', numeric: true, cell: (b) => <span className="text-num-sm">{formatRupees(b.value)}</span> },
          { key: 'share', header: 'Share', numeric: true, cell: (b) => <span className="text-num-sm text-ink-2">{formatShare(b.percent)}</span> },
        ]}
      />
      {unclassifiedCount > 0 && (
        <p className="mt-2 text-caption text-ink-3">
          {plural(unclassifiedCount, 'fund')} unclassified; <Link variant="external" href={LINKS.newIssue} className="text-caption">tell us the ISIN on GitHub</Link>
        </p>
      )}
    </Section>
  );
}
