// Skeleton (UI design component 31): sunken blocks with a shimmer (none under reduced motion).
export function Skeleton({ className = '', label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={`shimmer rounded-md bg-sunken ${className}`}>
      <span className="sr-only">{label}</span>
    </div>
  );
}
