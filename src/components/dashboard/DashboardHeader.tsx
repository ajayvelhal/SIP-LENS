// Dashboard header (UI design §4.5.2): optional greeting, statement line, fund count line.
import type { ParseResult } from '../../engine';
import { formatDate, plural } from '../../lib/format';
import { Badge } from '../ui/Badge';

export function DashboardHeader({ result, source, dateInferred }: { result: ParseResult; source: 'user' | 'sample'; dateInferred: boolean }) {
  const p = result.portfolio;
  return (
    <div className="mt-4">
      {source === 'user' && p.investorName && <p className="text-body text-ink-2">Hello, {p.investorName}</p>}
      {dateInferred ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-ink-2">
          <span>As of <span className="text-ink-1">{formatDate(p.statementDate)}</span> (latest transaction; statement date not found)</span>
          <Badge variant="caution">date inferred</Badge>
        </p>
      ) : (
        <p className="text-small text-ink-2">
          Statement date: <span className="text-ink-1">{formatDate(p.statementDate)}</span> · Period: <span className="text-ink-1">{formatDate(p.statementPeriod.from)} – {formatDate(p.statementPeriod.to)}</span>
        </p>
      )}
      <p className="text-caption text-ink-3">{plural(result.stats.funds, 'fund')} · {plural(result.stats.folios, 'folio')} · {plural(result.stats.pages, 'page')} read</p>
    </div>
  );
}
