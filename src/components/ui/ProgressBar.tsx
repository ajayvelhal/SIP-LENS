// ProgressBar (UI design component 7): 8 px track, determinate width = page / pageCount, indeterminate loop.
export function ProgressBar({ value, max, valueText, label, className = '' }: { value?: number; max?: number; valueText: string; label: string; className?: string }) {
  const determinate = value !== undefined && max !== undefined && max > 0;
  const pct = determinate ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={determinate ? max : undefined}
      aria-valuenow={determinate ? value : undefined}
      aria-valuetext={valueText}
      className={`h-2 w-full overflow-hidden rounded-full bg-accent-track ${className}`}
    >
      {determinate ? (
        <div className="h-full rounded-full bg-accent transition-[width] duration-fast ease-out" style={{ width: `${pct}%` }} />
      ) : (
        <div className="progress-indeterminate h-full rounded-full bg-accent" />
      )}
    </div>
  );
}
