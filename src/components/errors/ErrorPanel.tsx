// S4 Error panels (UI design §4.4, component 29): one panel per code with the designed copy. The glyph is never red:
// an error here is a wrong file, not a failure of the user. Focus moves to the heading; the assertive region reads it.
import { useEffect, useRef, type ReactNode } from 'react';
import type { UiError } from '../../app/state';
import { announce } from '../../lib/announce';
import { formatDate, formatMB } from '../../lib/format';
import { ROUTES } from '../../lib/links';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Glyph, type GlyphName } from '../ui/Glyph';
import { Link, LinkButton } from '../ui/Link';
import { CAMS_STEPS, KFINTECH_STEPS, StepsList } from '../ui/StepsList';

interface Props {
  error: UiError;
  onTryAnother: () => void;
  onRetry: () => void;
  onHowTo: () => void;
}

interface Copy {
  glyph: GlyphName;
  heading: ReactNode;
  headingText: string;
  detail?: ReactNode;
  extra?: ReactNode;
  howTo: boolean;
  report: boolean;
  retry?: boolean;
}

function BothSteps() {
  return (
    <div className="mt-4 space-y-3">
      <h2 className="text-h3 text-ink-1">How to get your CAS</h2>
      <h3 className="text-small font-semibold text-ink-2">From CAMS</h3>
      <StepsList steps={CAMS_STEPS} />
      <h3 className="text-small font-semibold text-ink-2">From KFintech</h3>
      <StepsList steps={KFINTECH_STEPS} />
    </div>
  );
}

const NOT_CAS_HEADING = "This doesn't look like a CAMS or KFintech CAS";

function copyFor(error: UiError): Copy {
  switch (error.code) {
    case 'NOT_PDF':
      return { glyph: 'document', heading: "That's not a PDF. SIP Lens reads the CAS PDF from CAMS or KFintech.", headingText: "That's not a PDF", detail: "The file you dropped doesn't have PDF contents, whatever its name ends in.", howTo: true, report: false };
    case 'MULTIPLE_FILES':
      return { glyph: 'document', heading: 'One statement at a time, please', headingText: 'One statement at a time, please', detail: 'Drop one CAS PDF. To look at a second statement afterwards, use Analyse another statement.', howTo: false, report: false };
    case 'FILE_TOO_LARGE':
      return { glyph: 'document', heading: 'This file is too large to read here', headingText: 'This file is too large to read here', detail: `It is ${formatMB(error.sizeBytes)} MB; SIP Lens reads files up to ${Math.round(error.limitBytes / (1024 * 1024))} MB. A detailed CAS is normally well under 5 MB.`, howTo: true, report: false };
    case 'PDF_CORRUPT':
      return { glyph: 'document', heading: 'This PDF seems damaged or incomplete. Re-download it from the CAMS/KFintech email and try again.', headingText: 'This PDF seems damaged or incomplete', howTo: false, report: false };
    case 'TOO_MANY_PAGES':
      return { glyph: 'document', heading: 'This statement is longer than SIP Lens can read', headingText: 'This statement is longer than SIP Lens can read', detail: 'It has more than 400 pages. Request a CAS for a shorter period, or one per PAN.', howTo: true, report: false };
    case 'NO_TEXT':
      return { glyph: 'document-search', heading: NOT_CAS_HEADING, headingText: NOT_CAS_HEADING, detail: 'This PDF has no selectable text, so it is probably a scan or a photo. SIP Lens needs the original PDF from CAMS or KFintech.', extra: <BothSteps />, howTo: false, report: false };
    case 'NOT_CAS':
    case 'NO_FOLIOS_PARSED':
      return { glyph: 'document-search', heading: NOT_CAS_HEADING, headingText: NOT_CAS_HEADING, detail: 'It opened, but it has none of the markers of a consolidated account statement. If this is the monthly statement from your email, it is probably the NSDL or CDSL one.', extra: <BothSteps />, howTo: false, report: false };
    case 'SUMMARY_CAS':
      return {
        glyph: 'document-search',
        heading: <>This is a summary CAS. It shows what you hold but not your transactions, so XIRR can't be computed. Request the <strong>detailed</strong> statement instead:</>,
        headingText: 'This is a summary CAS',
        extra: (
          <>
            <StepsList steps={error.issuer === 'KFINTECH' ? KFINTECH_STEPS : CAMS_STEPS} className="mt-4" />
            <div className="mt-4 rounded-md bg-sunken p-4">
              <h2 className="text-small text-ink-2">What we did read</h2>
              <ul className="mt-2 space-y-1">
                {error.schemeNames.map((name) => (
                  <li key={name} className="text-small text-ink-1">{name}</li>
                ))}
              </ul>
              <p className="mt-2 flex items-center gap-2 text-small text-ink-1">
                <Badge variant="neutral">{error.schemeNames.length}</Badge>
                {error.statementDate ? `Statement date: ${formatDate(error.statementDate)}` : 'Statement date: not found'}
              </p>
            </div>
          </>
        ),
        howTo: false,
        report: false,
      };
    case 'DEPOSITORY_CAS':
      return {
        glyph: 'document-search',
        heading: 'This is the NSDL/CDSL depository statement. It lists holdings, not mutual fund transactions. SIP Lens needs the CAMS/KFintech detailed CAS.',
        headingText: 'This is the NSDL/CDSL depository statement',
        detail: <span className="text-caption text-ink-3">Detected: {error.depository} statement</span>,
        extra: <BothSteps />,
        howTo: false,
        report: false,
      };
    case 'WORKER_CRASH':
    case 'INTERNAL':
      return {
        glyph: 'caution',
        heading: 'Something went wrong while reading the file',
        headingText: 'Something went wrong while reading the file',
        detail: (
          <>
            The reader stopped before it finished. Nothing was sent anywhere. If this keeps happening, a statement covering a shorter period is lighter to read, and a redacted report helps us fix it.
            {error.code === 'INTERNAL' && <span className="mt-2 block text-caption text-ink-3">Stage: {error.stage} · {error.errorName}</span>}
          </>
        ),
        howTo: false,
        report: true,
      };
    case 'OFFLINE':
      return { glyph: 'caution', heading: "Couldn't load the reader (are you offline?)", headingText: "Couldn't load the reader", detail: "The part of SIP Lens that reads PDFs hadn't been downloaded yet. Reconnect and try again; after one successful load it stays in your browser cache.", howTo: false, report: false, retry: true };
    default:
      return { glyph: 'caution', heading: 'Something went wrong while reading the file', headingText: 'Something went wrong while reading the file', howTo: false, report: true };
  }
}

export function ErrorPanel({ error, onTryAnother, onRetry, onHowTo }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copy = copyFor(error);

  useEffect(() => {
    headingRef.current?.focus();
    announce(copy.headingText, 'assertive');
  }, [copy.headingText]);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pt-8 md:px-6">
      <div role="alert" className="rounded-lg border border-border bg-surface p-6">
        <Glyph name={copy.glyph} size={32} className="text-ink-3" />
        <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-h1-sm text-ink-1 outline-none lg:text-h1">{copy.heading}</h1>
        {copy.detail && <p className="mt-3 text-body text-ink-2">{copy.detail}</p>}
        {copy.extra}
        <div className="mt-6 flex flex-col gap-3">
          {copy.retry ? (
            <>
              <Button onClick={onRetry} className="w-full md:w-auto">Try again</Button>
              <Button variant="secondary" onClick={onTryAnother} className="w-full md:w-auto">Try another file</Button>
            </>
          ) : (
            <Button onClick={onTryAnother} className="w-full md:w-auto">Try another file</Button>
          )}
          {copy.howTo && <LinkButton onClick={onHowTo}>How to get your CAS</LinkButton>}
          {copy.report && <Link variant="standalone" href={ROUTES.report}>Report a parsing issue</Link>}
        </div>
      </div>
    </main>
  );
}
