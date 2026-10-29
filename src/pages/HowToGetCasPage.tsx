// S4b as a standalone page (UI design §4.4), reachable from the footer and the hash route.
import { useEffect, useRef } from 'react';
import { HowToGetCasContent } from '../components/help/HowToGetCas';
import { AppBar } from '../components/ui/AppBar';
import { LinkButton } from '../components/ui/Link';

export function HowToGetCasPage({ onBack }: { onBack: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <>
      <AppBar variant="page"><LinkButton onClick={onBack}>Back</LinkButton></AppBar>
      <main className="mx-auto w-full max-w-[640px] px-4 py-8 md:px-6">
        <div className="max-w-prose">
          <HowToGetCasContent headingRef={ref} />
          <div className="mt-6"><LinkButton onClick={onBack}>Back</LinkButton></div>
        </div>
      </main>
    </>
  );
}
