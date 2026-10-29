// Meter (UI design component 23): 8 px HTML bar, accent on accent-track, value text to the right; role="meter".
export function Meter({ percent, label, className = '' }: { percent: number; label: string; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} className="h-2 flex-1 overflow-hidden rounded-full bg-accent-track">
        <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
      </div>
      <span className="num w-12 text-right text-num-sm text-ink-1">{clamped}%</span>
    </div>
  );
}
