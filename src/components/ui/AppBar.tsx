// AppBar (UI design component 1): 56 px, page background, hairline bottom; sticky only on the dashboard.
import type { ReactNode } from 'react';

export function AppBar({ variant, children }: { variant: 'landing' | 'dashboard' | 'page'; children?: ReactNode }) {
  return (
    <header className={`border-b border-border bg-page ${variant === 'dashboard' ? 'sticky top-0 z-sticky' : ''}`}>
      <div className="mx-auto flex min-h-[56px] max-w-content items-center justify-between gap-3 px-4 md:px-6 lg:px-8">
        <span className="text-h3 text-ink-1">SIP Lens</span>
        {children && <div className="flex min-w-0 items-center gap-3">{children}</div>}
      </div>
    </header>
  );
}
