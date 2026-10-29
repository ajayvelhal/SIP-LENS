// S13 Unsupported browser (UI design §4.4 last row): no file controls are rendered.
import { useEffect, useRef } from 'react';
import { ROUTES } from '../lib/links';
import { AppBar } from '../components/ui/AppBar';
import { Glyph } from '../components/ui/Glyph';
import { Link } from '../components/ui/Link';

export function UnsupportedBrowserPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <>
      <AppBar variant="landing" />
      <main className="mx-auto w-full max-w-[560px] px-4 pt-8 md:px-6">
        <div role="alert" className="rounded-lg border border-border bg-surface p-6">
          <Glyph name="caution" size={32} className="text-ink-3" />
          <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-h1-sm text-ink-1 outline-none lg:text-h1">This browser can't run SIP Lens</h1>
          <p className="mt-3 text-body text-ink-2">SIP Lens needs Chrome or Edge 100, Firefox 100, or Safari 15.4 and newer, because it reads the PDF inside a web worker on your device. Nothing is sent to a server in any browser.</p>
          <Link variant="standalone" href={`${ROUTES.privacy}#supported-browsers`} className="mt-4">Why these versions</Link>
        </div>
      </main>
    </>
  );
}
