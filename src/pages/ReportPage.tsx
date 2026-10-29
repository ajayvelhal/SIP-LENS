// S11 Report a parsing issue (UI design §4.11): the redacted payload in a read-only box, copy to clipboard, GitHub link.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ParseError, ParseResult } from '../engine';
import { announce } from '../lib/announce';
import { LINKS } from '../lib/links';
import { buildReport } from '../lib/report';
import { AppBar } from '../components/ui/AppBar';
import { Button } from '../components/ui/Button';
import { Link, LinkButton } from '../components/ui/Link';
import { StepsList } from '../components/ui/StepsList';

interface Props {
  result?: ParseResult;
  error?: ParseError;
  backLabel: string;
  onBack: () => void;
}

export function ReportPage({ result, error, backLabel, onBack }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const json = useMemo(() => JSON.stringify(buildReport({ result, error }), null, 2), [result, error]);

  useEffect(() => { headingRef.current?.focus(); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied('ok');
      announce('Copied');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <>
      <AppBar variant="page"><LinkButton onClick={onBack}>Back</LinkButton></AppBar>
      <main className="mx-auto w-full max-w-[640px] px-4 py-8 md:px-6">
        <h1 ref={headingRef} tabIndex={-1} className="text-h1-sm text-ink-1 outline-none lg:text-h1">Report a parsing issue</h1>
        <p className="mt-3 max-w-prose text-body text-ink-2">SIP Lens has no way to see your file, and this report contains none of it: no amounts, names, PAN, folio numbers or dates. It describes the structure that confused the reader so we can fix the pattern.</p>
        <h3 className="mt-6 text-h3 text-ink-1">What to include in the issue</h3>
        <StepsList
          className="mt-3"
          steps={[
            'Which RTA and the statement year (already in the report)',
            'The kind of row that was misread, in your own words (for example "a switch-out row with the amount in brackets")',
            'The transaction description text with digits removed',
            'Do not attach the CAS and do not paste PAN or folio numbers',
          ]}
        />
        <h3 className="mt-6 text-h3 text-ink-1">Report</h3>
        <pre tabIndex={0} aria-label="Redacted report" className="mt-3 h-[240px] overflow-auto rounded-md bg-sunken p-4 font-mono text-mono text-ink-1">{json}</pre>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button onClick={() => void copy()}>Copy to clipboard</Button>
          {copied === 'ok' && <span role="status" className="text-small text-ink-2">Copied</span>}
          {copied === 'failed' && <span role="status" className="text-small text-ink-2">Couldn't copy; select the report and copy instead</span>}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Link variant="external" href={LINKS.newIssue}>Open a GitHub issue</Link>
          <LinkButton onClick={onBack}>{backLabel}</LinkButton>
        </div>
      </main>
    </>
  );
}
