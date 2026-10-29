// SortControl and ThemeSwitch (UI design components 19, 33): a radiogroup segmented control with arrow-key movement.
import { useRef, type KeyboardEvent } from 'react';

export interface Segment<T extends string> { value: T; label: string }

export function SegmentedControl<T extends string>({ label, options, value, onChange, sm = false, className = '' }: { label: string; options: Segment<T>[]; value: T; onChange: (v: T) => void; sm?: boolean; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange((options[next] as Segment<T>).value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex overflow-hidden rounded-sm border border-border-strong bg-surface ${className}`}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`${sm ? 'min-h-[36px] px-3 text-small' : 'min-h-tap px-4 text-small'} font-semibold ${selected ? 'bg-accent text-accent-ink' : 'text-ink-1 hover:bg-sunken'} ${i > 0 ? 'border-l border-border-strong' : ''}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
