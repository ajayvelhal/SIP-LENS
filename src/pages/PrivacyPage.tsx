// S12 How we keep your data on your device (UI design §4.12).
import { useEffect, useRef } from 'react';
import { LINKS } from '../lib/links';
import { AppBar } from '../components/ui/AppBar';
import { Link, LinkButton } from '../components/ui/Link';

export function PrivacyPage({ onBack }: { onBack: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <>
      <AppBar variant="page"><LinkButton onClick={onBack}>Back</LinkButton></AppBar>
      <main className="mx-auto w-full max-w-[640px] px-4 py-8 md:px-6">
        <article className="max-w-prose space-y-6 text-body text-ink-2">
          <h1 ref={headingRef} tabIndex={-1} className="text-h1-sm text-ink-1 outline-none lg:text-h1">How we keep your data on your device</h1>
          <section className="space-y-2">
            <h3 className="text-h3 text-ink-1">What happens when you drop a PDF</h3>
            <p>The file is read in this tab and handed to a web worker that runs on your device. It is never posted anywhere. The only network traffic is the app's own files, which you can confirm in the browser's network panel: after the page has loaded, dropping a statement adds no request.</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-h3 text-ink-1">Your password</h3>
            <p>If the PDF is protected, the password goes to the PDF reader inside the worker, the field is cleared on submit, and it is never stored or logged. JavaScript cannot wipe memory on demand, so "cleared" means unreferenced and destroyed with the worker when you analyse another statement.</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-h3 text-ink-1">What is stored</h3>
            <p>Only your theme choice, under the key <code className="font-mono text-mono">sip-lens.theme</code>. No cookies, no local storage of statement data, no IndexedDB.</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-h3 text-ink-1">What leaves the tab</h3>
            <p>Nothing. The report you can copy from "Report a parsing issue" contains counts and digit-masked text only: no amounts, names, PAN, folio numbers or dates.</p>
          </section>
          <section className="space-y-2">
            <h3 className="text-h3 text-ink-1">Check it yourself</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li><Link variant="external" href={LINKS.sourceClient}>src/workers/client.ts</Link>, the main-thread side of the worker protocol</li>
              <li><Link variant="external" href={LINKS.sourceWorker}>src/parser/pdfWorker.ts</Link>, the worker that reads the PDF</li>
              <li><Link variant="external" href={LINKS.sourceTheme}>src/hooks/useTheme.ts</Link>, the only code that writes to storage</li>
              <li><Link variant="external" href={LINKS.sourcePrivacyTests}>tests/privacy/</Link>, the tests that fail the build on any network or storage call</li>
              <li><Link variant="external" href={LINKS.sourceIndexHtml}>index.html</Link>, the deployed Content Security Policy (connect-src 'self')</li>
            </ul>
          </section>
          <section id="supported-browsers" className="space-y-2">
            <h3 className="text-h3 text-ink-1">Supported browsers</h3>
            <p>SIP Lens needs Chrome or Edge 100, Firefox 100, or Safari 15.4 and newer, because it reads the PDF inside a web worker on your device. Nothing is sent to a server in any browser.</p>
          </section>
          <LinkButton onClick={onBack}>Back</LinkButton>
        </article>
      </main>
    </>
  );
}
