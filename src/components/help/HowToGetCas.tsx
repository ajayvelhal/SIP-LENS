// S4b "How to get your CAS" (UI design §4.4): the same content as a Drawer and as a standalone page.
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Dialog';
import { CAMS_STEPS, KFINTECH_STEPS, StepsList } from '../ui/StepsList';

export function HowToGetCasContent({ withHeading = true, headingRef }: { withHeading?: boolean; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="space-y-4">
      {withHeading && (headingRef
        ? <h1 ref={headingRef} tabIndex={-1} className="text-h1-sm text-ink-1 outline-none lg:text-h1">How to get your CAS</h1>
        : <h2 className="text-h2 text-ink-1">How to get your CAS</h2>)}
      <p className="text-body text-ink-2">
        SIP Lens reads the <strong className="text-body-strong text-ink-1">detailed</strong> consolidated account statement from CAMS or KFintech. It lists every transaction in every folio. The monthly statement most people get by email is the NSDL or CDSL one, which lists holdings and doesn't work here.
      </p>
      <h3 className="text-h3 text-ink-1">From CAMS</h3>
      <StepsList steps={CAMS_STEPS} />
      <h3 className="text-h3 text-ink-1">From KFintech</h3>
      <StepsList steps={KFINTECH_STEPS} />
      <p className="text-small text-ink-3">Since 2023 one request from either RTA can include folios serviced by both, so one file is usually enough. If you have folios the first file misses, request from the other RTA and analyse it as a second statement.</p>
      <p className="text-small text-ink-3">Opening the PDF: the password is usually your PAN in capitals, or the one you chose.</p>
    </div>
  );
}

export function HowToGetCasDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="How to get your CAS" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <HowToGetCasContent withHeading={false} />
    </Drawer>
  );
}
