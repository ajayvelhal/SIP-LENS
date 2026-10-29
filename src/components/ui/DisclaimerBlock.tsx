// DisclaimerBlock (UI design component 27): `long` is rendered above the numbers it governs (US-34).
import { Glyph } from './Glyph';

export function DisclaimerBlock({ variant, text, className = '' }: { variant: 'long' | 'short'; text: string; className?: string }) {
  if (variant === 'short') {
    return (
      <p className={`flex items-start gap-1 text-caption text-caution ${className}`}>
        <Glyph name="caution" size={14} className="mt-px" />
        <span>{text}</span>
      </p>
    );
  }
  return (
    <div className={`rounded-md border-l-[3px] border-caution bg-sunken px-4 py-3 text-body text-ink-1 ${className}`}>{text}</div>
  );
}
