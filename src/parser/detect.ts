// src/parser/detect.ts
// Document-type detection from the text of pages 1-3 (design §2.1 steps 4). Pure.

import type { DocumentType, Rta } from './types';
import { LIMITS } from './types';

export interface Detection {
  type: DocumentType;
  issuer?: Rta;
  depository?: 'NSDL' | 'CDSL';
}

const NSDL_MARKERS = ['NSDL', 'NATIONAL SECURITIES DEPOSITORY', 'CAS ID'];
const CDSL_MARKERS = ['CDSL', 'CENTRAL DEPOSITORY SERVICES', 'BO ID', 'MYEASI'];
const CAMS_MARKERS = ['COMPUTER AGE MANAGEMENT SERVICES', 'CAMSONLINE', 'MYCAMS', 'CAMS'];
const KFIN_MARKERS = ['KFIN TECHNOLOGIES', 'KFINTECH', 'KARVY'];
const NEUTRAL_RTA_MARKERS = ['MF CENTRAL', 'MFCENTRAL'];

export function normaliseForDetection(text: string): string {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

function firstIndex(hay: string, needles: readonly string[]): number {
  let best = -1;
  for (const n of needles) {
    const i = hay.indexOf(n);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/**
 * @param pagesText text of pages 1..3 (or fewer), each page's rows joined in reading order.
 */
export function detectDocumentType(pagesText: readonly string[]): Detection {
  const pages = pagesText.map(normaliseForDetection);
  const all = pages.join(' \n ');
  const chars = pages.reduce((a, p) => a + p.replace(/\s/g, '').length, 0);
  if (chars < LIMITS.minTextChars) return { type: 'NO_TEXT' };

  if (firstIndex(all, NSDL_MARKERS) !== -1 || (all.includes('DP ID') && all.includes('CLIENT ID'))) {
    return { type: 'DEPOSITORY_NSDL', depository: 'NSDL' };
  }
  if (firstIndex(all, CDSL_MARKERS) !== -1) return { type: 'DEPOSITORY_CDSL', depository: 'CDSL' };

  const camsAt = firstIndex(all, CAMS_MARKERS);
  const kfinAt = firstIndex(all, KFIN_MARKERS);
  const neutralAt = firstIndex(all, NEUTRAL_RTA_MARKERS);
  const hasRta = camsAt !== -1 || kfinAt !== -1 || neutralAt !== -1;
  const hasCas = all.includes('CONSOLIDATED ACCOUNT STATEMENT') || pages.some((p) => p.includes('FOLIO NO') && p.includes('PAN'));
  if (!hasRta || !hasCas) return { type: 'NOT_CAS' };

  // Issuer: the RTA whose marker appears first in reading order on page 1 (A20); fall back to pages 1-3.
  const issuer = pickIssuer(pages[0] ?? '') ?? pickIssuer(all) ?? 'CAMS';
  return { type: 'RTA_DETAILED', issuer };
}

function pickIssuer(text: string): Rta | undefined {
  const c = firstIndex(text, CAMS_MARKERS);
  const k = firstIndex(text, KFIN_MARKERS);
  if (c === -1 && k === -1) return undefined;
  if (c === -1) return 'KFINTECH';
  if (k === -1) return 'CAMS';
  return c <= k ? 'CAMS' : 'KFINTECH';
}

/** "Registrar : CAMS" / "Registrar : KFINTECH" / "KARVY" -> Rta (A21). */
export function rtaFromRegistrar(text: string | undefined): Rta | undefined {
  if (!text) return undefined;
  const t = text.toUpperCase();
  if (/KFIN|KARVY/.test(t)) return 'KFINTECH';
  if (/CAMS/.test(t)) return 'CAMS';
  return undefined;
}
