// S7 Cash-flow drawer "How we computed this" (UI design §4.7): every dated cashflow, the terminal row, ignored rows
// with reasons, the check line and "Copy as CSV" (clipboard only).
import { useEffect, useMemo, useState } from 'react';
import type { CashflowSeries, IgnoredRow } from '../../engine';
import type { Analysis } from '../../hooks/usePortfolio';
import { fundSeries } from '../../engine';
import { announce } from '../../lib/announce';
import { abbreviateScheme, formatDate, formatRupees, formatXirr, plural } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { Drawer } from '../ui/Dialog';
import { Disclosure } from '../ui/Disclosure';
import { PercentXirr, type AnyXirr } from '../ui/Percent';
import { schemeNameOf } from './fundHelpers';

export type CashflowScope = { kind: 'portfolio' } | { kind: 'fund'; fundId: string };

interface Props {
  analysis: Analysis;
  scope: CashflowScope | null;
  onClose: () => void;
}

const REASON_WORD: Record<IgnoredRow['reason'], string> = {
  reversed: 'reversed pair',
  reversal: 'reversed pair',
  dividend_reinvest: 'reinvested, no cash',
  segregated: 'no cash effect',
  unit_adjustment: 'no cash effect',
  unknown: 'not recognised',
  future_dated: 'after statement date',
  no_amount: 'no amount printed',
};

interface Row { date: string; label: string; fundId: string; amount: number; terminal?: boolean; id: string }

function toCsvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CashflowDrawer({ analysis, scope, onClose }: Props) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const open = scope !== null;

  const view = useMemo(() => {
    if (!scope) return null;
    const asOf = analysis.asOf;
    let series: CashflowSeries;
    let xirr: AnyXirr;
    let title: string;
    let skipped: string[] = [];
    if (scope.kind === 'portfolio') {
      series = analysis.summary.series;
      xirr = analysis.summary.xirr;
      title = 'Cash flows we used · Portfolio';
      skipped = analysis.summary.skippedFunds.filter((s) => s.reason === 'may-be-incomplete').map((s) => schemeNameOf(analysis.fundById, s.fundId));
    } else {
      const fund = analysis.fundById.get(scope.fundId);
      const fv = analysis.funds.find((f) => f.fund.id === scope.fundId);
      if (!fund || !fv) return null;
      series = fundSeries(fund, asOf);
      xirr = fv.xirr;
      title = `Cash flows we used · ${fund.schemeName}`;
    }
    const rows: Row[] = series.cashflows.map((c, i) => ({ date: c.date, label: c.label, fundId: c.fundId, amount: c.amount, id: `${i}:${c.transactionIds.join('+')}` }));
    if (series.terminal) rows.push({ date: series.terminal.date, label: series.terminal.label, fundId: series.terminal.fundId, amount: series.terminal.amount, terminal: true, id: 'terminal' });
    const fundCount = new Set(series.cashflows.map((c) => c.fundId)).size;
    const fundOfTx = new Map<string, string>();
    for (const f of analysis.funds) for (const fo of f.fund.folios) for (const t of fo.transactions) fundOfTx.set(t.id, f.fund.id);
    const ignored = series.ignored.map((ig) => {
      const tx = analysis.txById.get(ig.transactionId);
      return { id: ig.transactionId, date: tx?.date ?? '', description: tx?.description ?? '', fundId: fundOfTx.get(ig.transactionId) ?? '', reason: ig.reason };
    });
    return { series, xirr, title, rows, fundCount, ignored, skipped, scopeKind: scope.kind };
  }, [analysis, scope]);

  useEffect(() => { setCopied('idle'); }, [scope]);

  useEffect(() => {
    if (copied === 'idle') return;
    const t = setTimeout(() => setCopied('idle'), 3000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!view) return null;
  const { rows, ignored, xirr } = view;
  const fundName = (id: string) => schemeNameOf(analysis.fundById, id);

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.date)}</span> },
    { key: 'label', header: 'Description', cell: (r) => (r.terminal ? <span className="inline-flex flex-wrap items-center gap-1 text-body-strong">{r.label} <Badge variant="info">value as of statement date</Badge></span> : r.label) },
    ...(view.scopeKind === 'portfolio' ? [{ key: 'fund', header: 'Fund', cell: (r: Row) => <abbr title={fundName(r.fundId)} className="no-underline">{abbreviateScheme(fundName(r.fundId))}</abbr> }] : []),
    { key: 'amount', header: '₹ in/out', numeric: true, cell: (r) => <span className={r.terminal ? 'font-semibold' : ''}>{formatRupees(r.amount, { decimals: 2, signed: true })}</span> },
  ];

  const copyCsv = async () => {
    const header = 'date,description,fund,amount,ignored_reason';
    const lines = rows.map((r) => [r.date, toCsvCell(r.label), toCsvCell(fundName(r.fundId)), r.amount.toFixed(2), ''].join(','));
    const ignoredLines = ignored.map((ig) => [ig.date, toCsvCell(ig.description), toCsvCell(fundName(ig.fundId)), '', REASON_WORD[ig.reason]].join(','));
    const total = rows.length + ignoredLines.length;
    try {
      await navigator.clipboard.writeText([header, ...lines, ...ignoredLines].join('\n'));
      setCopied('ok');
      announce(`Copied, ${total} rows`);
    } catch {
      setCopied('failed');
    }
  };

  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void copyCsv()}>Copy as CSV</Button>
      {copied === 'ok' && <span role="status" className="text-small text-ink-2">Copied · {rows.length + ignored.length} rows</span>}
      {copied === 'failed' && <span role="status" className="text-small text-ink-2">Couldn't copy; select the table and copy instead</span>}
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title={view.title} footer={footer}>
      <div className="flex flex-wrap items-baseline gap-2 text-body">
        {xirr.status === 'ok' ? (
          <>
            <span className="text-ink-2">XIRR</span>
            <PercentXirr value={xirr} style="num-md" />
            <span className="text-ink-2">· as of {formatDate(analysis.asOf)}</span>
          </>
        ) : xirr.status === 'no-convergence' ? (
          <span className="text-ink-2">Couldn't compute an XIRR from these flows</span>
        ) : (
          <PercentXirr value={xirr} style="num-md" />
        )}
        {xirr.status === 'ok' && xirr.warning === 'multiple-roots' && <Badge variant="caution">two rates fit these flows; the one nearest zero is shown</Badge>}
      </div>
      <p className="mt-1 text-caption text-ink-3">
        {plural(view.series.cashflows.length, 'cash flow')} from {plural(view.fundCount, 'fund')} · {plural(ignored.length, 'row')} ignored
      </p>
      <DataTable className="mt-3 select-text" columns={columns} rows={rows} rowKey={(r) => r.id} caption={view.title} captionHidden variant="striped" stickyFirst focusableRegion rowClassName={(r) => (r.terminal ? 'bg-sunken' : '')} />
      {ignored.length > 0 && (
        <Disclosure label={`Ignored rows (${ignored.length})`} className="mt-3">
          <DataTable
            caption="Ignored rows"
            captionHidden
            rows={ignored}
            rowKey={(r) => r.id}
            stickyFirst
            columns={[
              { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{r.date ? formatDate(r.date) : ''}</span> },
              { key: 'desc', header: 'Description as printed', cell: (r) => <span className="text-ink-2">{r.description}</span> },
              { key: 'fund', header: 'Fund', cell: (r) => <abbr title={fundName(r.fundId)} className="no-underline">{abbreviateScheme(fundName(r.fundId))}</abbr> },
              { key: 'reason', header: 'Reason', cell: (r) => <Badge variant={r.reason === 'unknown' ? 'caution' : 'neutral'}>{REASON_WORD[r.reason]}</Badge> },
            ]}
          />
        </Disclosure>
      )}
      {view.skipped.length > 0 && (
        <p className="mt-3 text-caption text-caution">{plural(view.skipped.length, 'fund')} with read errors are not in this series: {view.skipped.join(', ')}</p>
      )}
      {xirr.status === 'ok' && (
        <p className="mt-3 text-small text-ink-3">Check it yourself: a spreadsheet XIRR() on the date and amount columns gives {formatXirr(xirr.rate)}.</p>
      )}
    </Drawer>
  );
}
