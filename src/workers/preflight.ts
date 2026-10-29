// src/workers/preflight.ts
// Main-thread checks that run before any worker exists (design §2.1 steps 1-2, E1-E3). Pure.

import type { ParseError } from '../parser/types';
import { LIMITS, uiErrorKey } from '../parser/types';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** True when "%PDF-" occurs within the first 1,024 bytes (the PDF spec allows junk before the header). */
export function looksLikePdf(head: Uint8Array): boolean {
  const limit = Math.min(head.length, 1024) - PDF_MAGIC.length;
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < PDF_MAGIC.length; j++) if (head[i + j] !== PDF_MAGIC[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * @param fileCount number of files dropped or picked
 * @param sizeBytes size of the single file (ignored when fileCount !== 1)
 * @param head the first bytes of the file (at least 1 KB when available)
 */
export function preflight(fileCount: number, sizeBytes: number, head: Uint8Array): ParseError | null {
  if (fileCount !== 1) return { code: 'MULTIPLE_FILES', message: uiErrorKey('MULTIPLE_FILES') };
  if (sizeBytes > LIMITS.maxFileBytes) return { code: 'FILE_TOO_LARGE', message: uiErrorKey('FILE_TOO_LARGE'), sizeBytes, limitBytes: LIMITS.maxFileBytes };
  if (!looksLikePdf(head)) return { code: 'NOT_PDF', message: uiErrorKey('NOT_PDF') };
  return null;
}
