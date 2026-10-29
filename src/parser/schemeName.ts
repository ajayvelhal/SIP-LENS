// src/parser/schemeName.ts
// Scheme-header parsing: name cleaning (RTA code prefix, advisor, registrar), ISIN / AMFI code extraction,
// plan and option retention (US-13), and the normalised name used for fund identity without ISIN (P1).

export interface SchemeHeaderParts {
  /** Printed name with boilerplate removed; plan and option kept. Empty when the row carries no name. */
  name: string;
  isin?: string;
  amfiCode?: string;
  advisor?: string;
  registrar?: string;
}

const ISIN_RE = /\bISIN\s*[:\-]?\s*([A-Z]{2}[A-Z0-9]{9}\d)\b/i;
const ADVISOR_RE = /\(\s*Advisor\s*[:\-]?\s*([^)]*)\)/i;
const REGISTRAR_RE = /Registrar\s*[:\-]?\s*([A-Za-z]+)/i;
const AMFI_RE = /\bAMFI\s*(?:Code)?\s*[:\-]?\s*(\d{5,6})\b/i;
/** "128TSDGG-Axis ..." or "LCG-Lens ...": an RTA scheme code glued to the name with a hyphen. */
const CODE_PREFIX_RE = /^[A-Z0-9]{2,12}-(?=[A-Za-z(])/;

export function normaliseSchemeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isSchemeHeaderRow(text: string): boolean {
  return ADVISOR_RE.test(text) || REGISTRAR_RE.test(text) || ISIN_RE.test(text);
}

export function parseSchemeHeader(text: string): SchemeHeaderParts {
  const parts: SchemeHeaderParts = { name: '' };
  let rest = text.replace(/\s+/g, ' ').trim();
  const isin = ISIN_RE.exec(rest);
  if (isin) { parts.isin = (isin[1] ?? '').toUpperCase(); rest = rest.replace(isin[0], ' '); }
  const amfi = AMFI_RE.exec(rest);
  if (amfi) { parts.amfiCode = amfi[1]; rest = rest.replace(amfi[0], ' '); }
  const adv = ADVISOR_RE.exec(rest);
  if (adv) { parts.advisor = (adv[1] ?? '').trim() || undefined; rest = rest.replace(adv[0], ' '); }
  const reg = REGISTRAR_RE.exec(rest);
  if (reg) { parts.registrar = (reg[1] ?? '').toUpperCase(); rest = rest.replace(reg[0], ' '); }
  rest = rest.replace(/\s+/g, ' ').replace(/^[\s:\-]+|[\s:\-]+$/g, '').trim();
  parts.name = cleanSchemeName(rest);
  return parts;
}

/** Strips the RTA code prefix and trailing separators; keeps "- Direct Plan - Growth". */
export function cleanSchemeName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(CODE_PREFIX_RE, '');
  s = s.replace(/\s*[-:]+\s*$/, '').trim();
  return s;
}
