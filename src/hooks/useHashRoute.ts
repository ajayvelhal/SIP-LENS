// src/hooks/useHashRoute.ts
// In-app pages (privacy, how to get your CAS, report) are hash routes rendered over the app state, so the dashboard
// survives a visit and "Back" needs no reload. No router dependency; no query strings.

import { useCallback, useSyncExternalStore } from 'react';
import { ROUTES } from '../lib/links';

export type Page = 'privacy' | 'how-to-get-your-cas' | 'report' | null;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function read(): Page {
  const h = window.location.hash;
  if (h === ROUTES.privacy || h.startsWith(`${ROUTES.privacy}#`)) return 'privacy';
  if (h === ROUTES.howToGetCas) return 'how-to-get-your-cas';
  if (h === ROUTES.report) return 'report';
  return null;
}

export function useHashRoute(): { page: Page; back: () => void } {
  const page = useSyncExternalStore(subscribe, read, () => null);
  const back = useCallback(() => {
    if (window.location.hash) window.history.pushState(null, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);
  return { page, back };
}
