// InfoButton (UI design component 9): 44 px hit area around a 20 px circled "?"; opens a Tooltip or BottomSheet.
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Glyph } from './Glyph';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  expanded: boolean;
}

export const InfoButton = forwardRef<HTMLButtonElement, Props>(function InfoButton({ label, expanded, className = '', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`About ${label}`}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      className={`inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-accent focus-visible:text-accent ${className}`}
      {...rest}
    >
      <Glyph name="question" size={20} />
    </button>
  );
});
