// scripts/lib/cas-pdf.mjs
// Draws the pages decided by cas-layout.mjs with pdfkit, and produces the non-text fixtures.
//
// pdfkit is the only npm dependency of the fixture generator (devDependency, never shipped):
//   - built-in Helvetica (no font files), absolute text positioning, deflate-compressed streams;
//   - standard-security encryption (RC4-128 / AES-128 / AES-256) for the password-protected and
//     owner-locked variants, which pdf-lib cannot write.
// It is imported lazily so the dry-run path (expand, layout, goldens) needs no install at all.

import { PAGE, FONT } from './cas-layout.mjs';
import { makePng } from './synthetic.mjs';

let PDFDocument = null;
async function loadPdfkit() {
  if (PDFDocument) return PDFDocument;
  try {
    ({ default: PDFDocument } = await import('pdfkit'));
  } catch (e) {
    throw new Error('pdfkit is not installed. Run `npm install --save-dev pdfkit` (devDependency; it is never bundled). Original error: ' + e.message);
  }
  return PDFDocument;
}

function docOptions(fx, extra = {}) {
  const info = { Title: 'Consolidated Account Statement', Author: 'SIP Lens synthetic fixture', Creator: 'sip-lens scripts/gen-fixtures.mjs', Producer: 'sip-lens synthetic fixture generator', Subject: 'SYNTHETIC - all data fictitious' };
  const opts = { size: 'A4', margin: 0, autoFirstPage: false, compress: true, info, ...extra };
  if (fx?.password) { opts.pdfVersion = fx.encryption === 'AES-256' ? '1.7ext3' : fx.encryption === 'RC4-128' ? '1.4' : '1.7'; opts.userPassword = fx.password; opts.ownerPassword = fx.password + '-owner'; }
  else if (fx?.ownerPassword) { opts.pdfVersion = '1.7'; opts.ownerPassword = fx.ownerPassword; opts.permissions = { printing: 'highResolution', copying: true, modifying: false }; }
  return opts;
}

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Renders a laid-out text document (CAS, depository CAS, bank statement, letter) to a PDF buffer. */
export async function renderLayout(layout, fx) {
  const PDF = await loadPdfkit();
  const doc = new PDF(docOptions(fx));
  for (const pg of layout.pages) {
    doc.addPage({ size: 'A4', margin: 0 });
    for (const line of pg.lines) {
      for (const cell of line.cells) {
        const size = cell.size ?? FONT.size;
        doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
        let x = cell.x;
        if (cell.align === 'right') x = cell.x - doc.widthOfString(cell.text);
        doc.text(cell.text, x, line.y, { lineBreak: false });
      }
    }
  }
  return collect(doc);
}

/** Image-only "scan": grey blocks where text would be, no text objects at all (design A4 / E8). */
export async function renderScanned() {
  const PDF = await loadPdfkit();
  const doc = new PDF(docOptions(null, { info: { Title: 'Scanned statement', Producer: 'sip-lens synthetic fixture generator', Subject: 'SYNTHETIC' } }));
  for (let p = 0; p < 2; p++) {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.rect(0, 0, PAGE.w, PAGE.h).fill('#f4f1ea');
    doc.rect(40, 40, 220, 14).fill('#6b6b6b');
    doc.rect(40, 62, 120, 8).fill('#9a9a9a');
    for (let i = 0; i < 48; i++) {
      const y = 100 + i * 14;
      doc.rect(40, y, 60, 6).fill('#8a8a8a');
      doc.rect(110, y, 160 + (i * 37) % 90, 6).fill('#8a8a8a');
      doc.rect(360, y, 50, 6).fill('#8a8a8a');
      doc.rect(430, y, 45, 6).fill('#8a8a8a');
      doc.rect(500, y, 55, 6).fill('#8a8a8a');
    }
    // a slightly rotated page edge, as scans have
    doc.save().rotate(0.6, { origin: [297, 420] }).rect(30, 30, 535, 782).lineWidth(0.5).stroke('#bbb').restore();
  }
  return collect(doc);
}

/** Bytes that are not a PDF (a small PNG) saved under a .pdf name (design E1). */
export function notAPdfBytes() {
  return makePng(64, 64, 200);
}
