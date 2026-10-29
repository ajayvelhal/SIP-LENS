// S1 Landing (UI design §4.1): title, lead, DropZone, PrivacyLine, help link, three explainers, footer.
import { useId } from 'react';
import { DropZone } from '../components/landing/DropZone';
import { PrivacyLine } from '../components/landing/PrivacyLine';
import { AppBar } from '../components/ui/AppBar';
import { Footer } from '../components/ui/Footer';
import { LinkButton } from '../components/ui/Link';

interface Props {
  loading: boolean;
  onFiles: (files: ArrayLike<File>) => void;
  onSample: () => void;
  onHowTo: () => void;
}

const EXPLAINERS = [
  { title: 'What you get', body: 'Portfolio and per-fund XIRR with every cash flow behind it, how consistently you kept your SIPs, what the same cash flows in a Nifty 50 index fund would have been worth, and an unrealised-gains tax preview.' },
  { title: 'How it works', body: "Your PDF is read by a web worker inside this tab. The only network traffic is the app's own files. Close the tab and nothing remains." },
  { title: 'Why trust it', body: 'Open source under MIT. Every XIRR is tested against a spreadsheet. You can see the cash flows we used for every number.' },
];

export function LandingPage({ loading, onFiles, onSample, onHowTo }: Props) {
  const privacyId = useId();
  return (
    <>
      <AppBar variant="landing" />
      <main className="mx-auto w-full max-w-content px-4 md:px-6 lg:px-8">
        <div className="mx-auto max-w-[720px] pt-8 lg:text-center">
          <h1 className="text-h1-sm text-ink-1 lg:text-h1">See your real SIP returns</h1>
          <p className="mt-2 max-w-[48ch] text-body text-ink-2 lg:mx-auto">Drop your CAMS or KFintech detailed CAS. Your XIRR, the index comparison and a tax preview, computed in this tab.</p>
        </div>
        <div className="mx-auto mt-6 max-w-[840px]">
          <DropZone onFiles={onFiles} onSample={onSample} loading={loading} describedBy={privacyId} />
          <PrivacyLine id={privacyId} className="mt-4" />
          <div className="mt-2">
            <LinkButton onClick={onHowTo} sm>How to get your CAS</LinkButton>
          </div>
        </div>
        <div className="mx-auto mt-10 grid max-w-[840px] gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3 lg:gap-6">
          {EXPLAINERS.map((e) => (
            <div key={e.title}>
              <h3 className="text-h3 text-ink-1">{e.title}</h3>
              <p className="mt-1 text-small text-ink-2">{e.body}</p>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
