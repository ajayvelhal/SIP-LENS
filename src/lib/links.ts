// src/lib/links.ts
// The only external URLs in the product: literal GitHub links, no query strings (design component 3, §8.1).

const REPO = 'https://github.com/ajvelhal/sip-lens';

export const LINKS = {
  repo: REPO,
  newIssue: `${REPO}/issues/new/choose`,
  sourceClient: `${REPO}/blob/main/src/workers/client.ts`,
  sourceWorker: `${REPO}/blob/main/src/parser/pdfWorker.ts`,
  sourceTheme: `${REPO}/blob/main/src/hooks/useTheme.ts`,
  sourcePrivacyTests: `${REPO}/tree/main/tests/privacy`,
  sourceIndexHtml: `${REPO}/blob/main/index.html`,
  benchmarkRefresh: `${REPO}/actions`,
} as const;

/** In-app pages are hash routes so the dashboard state survives navigation (UI design §3: "page over any state"). */
export const ROUTES = {
  privacy: '#/privacy',
  howToGetCas: '#/how-to-get-your-cas',
  report: '#/report',
} as const;
