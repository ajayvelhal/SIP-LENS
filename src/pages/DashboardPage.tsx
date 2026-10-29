// S5 Dashboard (UI design §4.5): header, banners, tiles, allocation, funds, discipline, index comparison, tax, footer.
// Owns the explainer and drawer state shared across sections. Loaded lazily so Recharts stays out of the landing chunk.
import { useEffect, useRef, useState } from 'react';
import type { DetectedSip, ParseResult } from '../engine';
import { usePortfolio } from '../hooks/usePortfolio';
import { announce } from '../lib/announce';
import { formatDate } from '../lib/format';
import { AppBar } from '../components/ui/AppBar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Footer } from '../components/ui/Footer';
import { AllocationBar } from '../components/dashboard/AllocationBar';
import { CashflowDrawer, type CashflowScope } from '../components/dashboard/CashflowDrawer';
import { DashboardBanners } from '../components/dashboard/DashboardBanners';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { FundList } from '../components/dashboard/FundList';
import { SummaryTiles } from '../components/dashboard/SummaryTiles';
import { ComparisonExplainer, DisciplineExplainer, XirrExplainer } from '../components/dashboard/XirrExplainer';
import { schemeNameOf } from '../components/dashboard/fundHelpers';
import { DisciplineSection } from '../components/discipline/DisciplineSection';
import { SipDetectionSheet } from '../components/discipline/SipDetectionSheet';
import { ComparisonSection } from '../components/comparison/ComparisonSection';
import { TaxSection } from '../components/tax/TaxSection';

interface Props {
  result: ParseResult;
  source: 'user' | 'sample';
  onReset: () => void;
  onHowTo: () => void;
}

type Explainer = 'xirr' | 'discipline-tile' | 'discipline-section' | 'comparison' | null;

/** Module-level, not storage: the explainer opens automatically once per session (US-16). */
let explainerShownThisSession = false;

export default function DashboardPage({ result, source, onReset, onHowTo }: Props) {
  const analysis = usePortfolio(result);
  const [explainer, setExplainer] = useState<Explainer>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [cashflowScope, setCashflowScope] = useState<CashflowScope | null>(null);
  const [sipDetail, setSipDetail] = useState<DetectedSip | null>(null);
  const xirrInfoRef = useRef<HTMLButtonElement>(null);
  const disciplineTileRef = useRef<HTMLButtonElement>(null);
  const disciplineSectionRef = useRef<HTMLButtonElement>(null);
  const comparisonRef = useRef<HTMLButtonElement>(null);
  const dateInferred = result.warnings.some((w) => w.code === 'MISSING_STATEMENT_DATE');

  useEffect(() => {
    announce('Your dashboard is ready');
    if (!explainerShownThisSession) {
      explainerShownThisSession = true;
      setAutoOpened(true);
      setExplainer('xirr');
      announce('Tip: what XIRR means. Press Escape to close.');
    }
  }, []);

  const closeExplainer = () => { setExplainer(null); setAutoOpened(false); };
  const toggle = (which: Exclude<Explainer, null>) => { setAutoOpened(false); setExplainer((e) => (e === which ? null : which)); };

  return (
    <>
      <a href="#dashboard-main" className="skip-link">Skip to dashboard</a>
      <AppBar variant="dashboard">
        {source === 'sample' && <Badge variant="sample">Sample data</Badge>}
        <Button variant="secondary" sm onClick={onReset} className="md:min-h-tap md:px-5 md:text-body-strong">Analyse another statement</Button>
      </AppBar>
      <main id="dashboard-main" className="mx-auto w-full max-w-content px-4 md:px-6 lg:px-8">
        <DashboardHeader result={result} source={source} dateInferred={dateInferred} />
        <DashboardBanners result={result} source={source} dateInferred={dateInferred} onHowTo={onHowTo} />
        <SummaryTiles
          analysis={analysis}
          xirrInfoRef={xirrInfoRef}
          xirrOpen={explainer === 'xirr'}
          onXirrInfo={() => toggle('xirr')}
          disciplineInfoRef={disciplineTileRef}
          disciplineOpen={explainer === 'discipline-tile'}
          onDisciplineInfo={() => toggle('discipline-tile')}
          onSeeCashflows={() => setCashflowScope({ kind: 'portfolio' })}
        />
        <AllocationBar allocation={analysis.allocation} asOf={analysis.asOf} />
        <FundList analysis={analysis} onCashflows={(fundId) => setCashflowScope({ kind: 'fund', fundId })} onSipDetail={setSipDetail} onHowTo={onHowTo} />
        <div className="grid gap-6 lg:grid-cols-2">
          <DisciplineSection analysis={analysis} infoRef={disciplineSectionRef} infoOpen={explainer === 'discipline-section'} onInfo={() => toggle('discipline-section')} onSipDetail={setSipDetail} />
          <ComparisonSection analysis={analysis} infoRef={comparisonRef} infoOpen={explainer === 'comparison'} onInfo={() => toggle('comparison')} />
        </div>
        <TaxSection analysis={analysis} />
      </main>
      <Footer />

      <XirrExplainer
        open={explainer === 'xirr'}
        onClose={closeExplainer}
        statementDate={formatDate(analysis.asOf)}
        anchorRef={xirrInfoRef}
        moveFocus={!autoOpened}
        onSeeCashflows={() => { closeExplainer(); setCashflowScope({ kind: 'portfolio' }); }}
      />
      <DisciplineExplainer open={explainer === 'discipline-tile'} onClose={closeExplainer} anchorRef={disciplineTileRef} />
      <DisciplineExplainer open={explainer === 'discipline-section'} onClose={closeExplainer} anchorRef={disciplineSectionRef} />
      <ComparisonExplainer open={explainer === 'comparison'} onClose={closeExplainer} anchorRef={comparisonRef} />
      <CashflowDrawer analysis={analysis} scope={cashflowScope} onClose={() => setCashflowScope(null)} />
      <SipDetectionSheet sip={sipDetail} fundName={sipDetail ? schemeNameOf(analysis.fundById, sipDetail.fundId) : ''} onClose={() => setSipDetail(null)} />
    </>
  );
}
