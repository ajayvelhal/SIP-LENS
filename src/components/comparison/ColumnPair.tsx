// ColumnPair (UI design component 22, §4.9 spec): two columns on one axis, value on cap, zero baseline, legend.
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { formatXirr } from '../../lib/format';

interface Props {
  yours: number;
  index: number;
  ariaLabel: string;
}

export function ColumnPair({ yours, index, ariaLabel }: Props) {
  const reduced = useReducedMotion();
  const data = [
    { name: 'Your portfolio', rate: yours },
    { name: 'Index fund', rate: index },
  ];
  const lo = Math.min(0, yours, index);
  const hi = Math.max(0, yours, index);
  const pad = (hi - lo || 0.1) * 0.1;
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 8 }} barCategoryGap="30%" maxBarSize={24}>
            <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--color-chart-grid)' }} tick={{ fill: 'var(--color-ink-3)', fontSize: 14 }} />
            <YAxis hide domain={[lo - pad, hi + pad]} />
            <ReferenceLine y={0} stroke="var(--color-chart-grid)" />
            <ChartTooltip
              cursor={{ fill: 'var(--color-sunken)' }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as { name: string; rate: number } | undefined;
                if (!p) return null;
                return <div className="rounded-md border border-border bg-surface px-3 py-2 text-small text-ink-1 shadow-e-2">{p.name} · XIRR {formatXirr(p.rate)}</div>;
              }}
            />
            <Bar dataKey="rate" isAnimationActive={!reduced} animationDuration={300}>
              <Cell fill="var(--color-accent)" radius={(yours < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0]) as unknown as number} />
              <Cell fill="var(--color-chart-benchmark)" radius={(index < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0]) as unknown as number} />
              <LabelList dataKey="rate" position="top" formatter={(v: number) => formatXirr(v)} fill="var(--color-ink-1)" fontSize={14} fontWeight={500} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-small text-ink-2">
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />Your portfolio</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-benchmark" />Index fund</span>
      </div>
    </div>
  );
}
