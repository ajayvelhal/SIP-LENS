// Dashboard banners in the designed order (UI design §4.5.3): sample ribbon, partial parse (not dismissible),
// multi-PAN, stale statement, statement date inferred.
import { useEffect, useMemo } from 'react';
import type { ParseResult, ParseWarning } from '../../engine';
import { daysBetween } from '../../engine';
import { announce } from '../../lib/announce';
import { formatDate, plural, todayIso } from '../../lib/format';
import { ROUTES } from '../../lib/links';
import { Badge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { Link, LinkButton } from '../ui/Link';

const ROW_CODES = new Set<ParseWarning['code']>(['UNCLASSIFIED_ROW', 'UNIT_MISMATCH', 'COLUMN_DRIFT', 'ORPHAN_REVERSAL', 'FUTURE_DATED_ROW']);

export interface PartialSummary {
  lines: number;
  folios: number;
  schemeNames: string[];
  noClosing: number;
  pagesFailed: number;
}

export function summarisePartial(result: ParseResult): PartialSummary | null {
  const flags = result.warnings.filter((w) => w.severity === 'flag');
  if (flags.length === 0) return null;
  const lines = flags.filter((w) => w.rowIndex !== undefined && ROW_CODES.has(w.code)).length;
  const folios = new Set(flags.map((w) => w.folioNumber).filter((f): f is string => !!f)).size;
  const names = new Set<string>();
  for (const w of flags) {
    const name = w.schemeName ?? result.portfolio.funds.find((f) => f.id === w.fundId)?.schemeName;
    if (name) names.add(name);
  }
  return {
    lines,
    folios,
    schemeNames: [...names],
    noClosing: flags.filter((w) => w.code === 'NO_CLOSING_BALANCE').length,
    pagesFailed: flags.filter((w) => w.code === 'PAGE_EXTRACT_FAILED').length,
  };
}

/** UA9 plus one addition: when every flag is a balance mismatch with no row (the sample), the line count is unknown. */
function partialLead(p: PartialSummary): string {
  if (p.lines > 0) return `We couldn't read ${plural(p.lines, 'line')} in ${plural(p.folios, 'folio')}. Numbers for those funds may be incomplete.`;
  return `We couldn't fully read ${plural(Math.max(p.folios, 1), 'folio')}. Numbers for those funds may be incomplete.`;
}

export function DashboardBanners({ result, source, dateInferred, onHowTo }: { result: ParseResult; source: 'user' | 'sample'; dateInferred: boolean; onHowTo: () => void }) {
  const p = result.portfolio;
  const partial = useMemo(() => summarisePartial(result), [result]);
  const ageDays = daysBetween(p.statementDate, todayIso());

  useEffect(() => {
    if (partial) announce(partialLead(partial), 'assertive');
  }, [partial]);

  return (
    <div className="mt-4 space-y-3">
      {source === 'sample' && (
        <Banner variant="info">
          <Badge variant="sample" className="mr-2">Sample data</Badge>
          Sample data. This is a synthetic statement so you can see what SIP Lens shows. Drop your own CAS to see your numbers.
        </Banner>
      )}
      {partial && (
        <Banner variant="partial">
          {partialLead(partial)}
          {partial.noClosing > 0 && ` ${plural(partial.noClosing, 'section')} ended without a closing balance.`}
          {partial.pagesFailed > 0 && ` ${plural(partial.pagesFailed, 'page')} couldn't be read at all.`}
          {partial.schemeNames.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-small text-ink-1">
              {partial.schemeNames.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <div className="mt-1"><Link href={ROUTES.report} className="text-small">Report a parsing issue</Link></div>
        </Banner>
      )}
      {p.investorCount > 1 && (
        <Banner variant="info">This statement covers {p.investorCount} investors; numbers are combined.</Banner>
      )}
      {ageDays > 60 && (
        <Banner variant="info">
          This statement is {ageDays} days old. Request a fresh CAS for today's picture.{' '}
          <LinkButton onClick={onHowTo} className="min-h-0 py-0">How to get your CAS</LinkButton>
        </Banner>
      )}
      {dateInferred && (
        <Banner variant="caution">We couldn't find the statement date, so every number is as of {formatDate(p.statementDate)}, the latest transaction in the file.</Banner>
      )}
    </div>
  );
}
