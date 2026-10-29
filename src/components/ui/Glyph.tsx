// Inline SVG glyph set (UI design §1.5, last paragraph). Each glyph is aria-hidden and always sits next to text.

export type GlyphName =
  | 'document' | 'document-search' | 'lock' | 'info' | 'caution' | 'check' | 'cross' | 'chevron' | 'copy' | 'close' | 'external' | 'question' | 'dash';

const PATHS: Record<GlyphName, JSX.Element> = {
  document: (
    <>
      <path d="M6 2h8l5 5v15H6z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h7M9 17h7" />
    </>
  ),
  'document-search': (
    <>
      <path d="M6 2h8l5 5v6" />
      <path d="M14 2v5h5" />
      <path d="M6 2v20h6" />
      <circle cx="16.5" cy="16.5" r="3.5" />
      <path d="m19 19 3 3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  caution: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v6H4V6h6" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  dash: <path d="M6 12h12" />,
};

export function Glyph({ name, size = 20, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 ${className}`}>
      {PATHS[name]}
    </svg>
  );
}
