// Money (UI design component 15): plain, signed, gain-loss. Receives raw rupees; formats through lib/format only.
import { formatRupees } from '../../lib/format';

export type NumStyle = 'display' | 'num-xl' | 'num-lg' | 'num-md' | 'num-sm' | 'body-strong';

const SIZE: Record<NumStyle, string> = {
  display: 'text-num-lg md:text-display-sm lg:text-display',
  'num-xl': 'text-num-xl',
  'num-lg': 'text-num-lg',
  'num-md': 'text-num-md',
  'num-sm': 'text-num-sm',
  'body-strong': 'text-body-strong',
};

export function numClass(style: NumStyle): string {
  return `num ${SIZE[style]}`;
}

interface Props {
  value: number;
  variant?: 'plain' | 'signed' | 'gain-loss';
  style?: NumStyle;
  decimals?: 0 | 2;
  /** Word pair for gain-loss: ["gain", "loss"] or ["ahead", "behind"]. */
  words?: [string, string];
  className?: string;
}

export function Money({ value, variant = 'plain', style = 'num-md', decimals = 0, words = ['gain', 'loss'], className = '' }: Props) {
  if (variant === 'gain-loss') {
    const zero = decimals === 2 ? Math.abs(value) < 0.005 : Math.abs(value) < 0.5;
    const color = zero ? 'text-ink-1' : value > 0 ? 'text-gain' : 'text-loss';
    return (
      <span className={`inline-flex flex-wrap items-baseline gap-x-1 ${className}`}>
        <span className={`${numClass(style)} ${color}`}>{formatRupees(value, { decimals, signed: true })}</span>
        {!zero && <span className={`text-caption ${color}`}>{value > 0 ? words[0] : words[1]}</span>}
      </span>
    );
  }
  return <span className={`${numClass(style)} text-ink-1 ${className}`}>{formatRupees(value, { decimals, signed: variant === 'signed' })}</span>;
}
