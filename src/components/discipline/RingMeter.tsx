// RingMeter (UI design component 21, §4.8 spec): RadialBarChart, accent fill on accent-track, never gain/loss.
// The centre number is HTML over the SVG so it wears the num-xl token; the wrapper carries the screen-reader text.
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { DASH } from '../../lib/format';

interface Props {
  score: number | null;
  variant: 'tile' | 'section';
  ariaLabel: string;
}

export function RingMeter({ score, variant, ariaLabel }: Props) {
  const reduced = useReducedMotion();
  const box = variant === 'tile' ? 96 : 160;
  const ring = variant === 'tile' ? 10 : 16;
  if (score === null) {
    return <span className="num text-num-xl text-ink-3">{DASH}</span>;
  }
  return (
    <div role="img" aria-label={ariaLabel} className="relative shrink-0" style={{ width: box, height: box }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} data={[{ value: score }]} barSize={ring}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={ring / 2} background={{ fill: 'var(--color-accent-track)' }} fill="var(--color-accent)" isAnimationActive={!reduced} animationDuration={600} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-num-xl text-ink-1">{score}</span>
        <span className={`text-ink-2 ${variant === 'tile' ? 'text-caption' : 'text-h3'}`}>/100</span>
      </div>
    </div>
  );
}
