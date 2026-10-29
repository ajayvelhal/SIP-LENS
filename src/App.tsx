// App shell: routes the AppState (design §3.5) to the screens of UI design §3 and overlays the hash-routed pages.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ErrorPanel } from './components/errors/ErrorPanel';
import { HowToGetCasDrawer } from './components/help/HowToGetCas';
import { ParseProgress } from './components/parse/ParseProgress';
import { PasswordPrompt } from './components/parse/PasswordPrompt';
import { AppBar } from './components/ui/AppBar';
import { LiveRegion } from './components/ui/LiveRegion';
import { Skeleton } from './components/ui/Skeleton';
import { useCasParser } from './hooks/useCasParser';
import { useHashRoute } from './hooks/useHashRoute';
import { HowToGetCasPage } from './pages/HowToGetCasPage';
import { LandingPage } from './pages/LandingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ReportPage } from './pages/ReportPage';
import { UnsupportedBrowserPage } from './pages/UnsupportedBrowserPage';

const loadDashboard = () => import('./pages/DashboardPage');
const DashboardPage = lazy(loadDashboard);

export default function App() {
  // The dashboard chunk is warmed once the PDF has opened (design §3.3 step 6), never before the landing paint.
  const warmDashboard = useCallback(() => { void loadDashboard(); }, []);
  const parser = useCasParser(warmDashboard);
  const { page, back } = useHashRoute();
  const [howToOpen, setHowToOpen] = useState(false);
  const { state } = parser;

  useEffect(() => {
    document.title = state.phase === 'dashboard' ? 'SIP Lens · Dashboard' : 'SIP Lens';
  }, [state.phase]);

  const openHowTo = useCallback(() => setHowToOpen(true), []);

  let screen: JSX.Element;
  if (page === 'privacy') {
    screen = <PrivacyPage onBack={back} />;
  } else if (page === 'how-to-get-your-cas') {
    screen = <HowToGetCasPage onBack={back} />;
  } else if (page === 'report') {
    screen = (
      <ReportPage
        result={state.phase === 'dashboard' ? state.result : undefined}
        error={state.phase === 'rejected' && state.error.code !== 'OFFLINE' ? state.error : undefined}
        backLabel={state.phase === 'dashboard' ? 'Back to dashboard' : 'Back'}
        onBack={back}
      />
    );
  } else {
    switch (state.phase) {
      case 'unsupported-browser':
        screen = <UnsupportedBrowserPage />;
        break;
      case 'landing':
      case 'loading-engine':
        screen = <LandingPage loading={state.phase === 'loading-engine'} onFiles={parser.openFiles} onSample={parser.openSample} onHowTo={openHowTo} />;
        break;
      case 'needs-password':
        screen = (
          <>
            <AppBar variant="landing" />
            <PasswordPrompt reason={state.reason} attempt={state.attempt} submitting={state.submitting} onSubmit={parser.submitPassword} onCancel={parser.cancel} />
          </>
        );
        break;
      case 'parsing':
        screen = (
          <>
            <AppBar variant="landing" />
            <ParseProgress page={state.page} pageCount={state.pageCount} stage={state.stage} documentType={state.documentType} liveWarnings={state.liveWarnings} onCancel={parser.cancel} />
          </>
        );
        break;
      case 'rejected':
        screen = (
          <>
            <AppBar variant="landing" />
            <ErrorPanel error={state.error} onTryAnother={parser.reset} onRetry={parser.retry} onHowTo={openHowTo} />
          </>
        );
        break;
      case 'dashboard':
        screen = (
          <Suspense fallback={<><AppBar variant="dashboard" /><main className="mx-auto max-w-content px-4 pt-6 md:px-6 lg:px-8"><Skeleton className="h-40 w-full" label="Loading dashboard" /></main></>}>
            <DashboardPage key={state.result.portfolio.parsedAt} result={state.result} source={state.source} onReset={parser.reset} onHowTo={openHowTo} />
          </Suspense>
        );
        break;
    }
  }

  return (
    <>
      <LiveRegion />
      <div className="flex min-h-screen flex-col">{screen}</div>
      <HowToGetCasDrawer open={howToOpen} onClose={() => setHowToOpen(false)} />
    </>
  );
}
