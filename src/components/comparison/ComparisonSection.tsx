// S9 vs Nifty 50 index fund (UI design §4.9): headline pair, ColumnPair, gap, value difference, assumptions,
// partial and stale notes, unavailable states, By fund table and the shadow cash-flow drawer.
import { useState, type RefObject } from 'react';
import type { IndexComparisonResult, ShadowLeg } from '../../engine';
import { addDays } from '../../engine';
import type { Analysis } from '../../hooks/usePortfolio';
import { DASH, formatDate, formatGap, formatRupees, formatXirr, plural } from '../../lib/format';
import { LINKS, ROUTES } from '../../lib/links';
import { Badge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { DataTable } from '../ui/DataTable';
import { Drawer } from '../ui/Dialog';
import { Disclosure } from '../ui/Disclosure';
import { EmptyPanel } from '../ui/EmptyPanel';
import { Link, LinkButton } from '../ui/Link';
import { Money } from '../ui/Money';
import { PercentGap, PercentXirr, xirrReason } from '../ui/Percent';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { schemeNameOf } from '../dashboard/fundHelpers';
import { ColumnPair } from './ColumnPair';

interface Props {
  analysis: Analysis;
  infoRef: RefObject<HTMLButtonElement>;
  infoOpen: boolean;
  onInfo: () => void;
}

type Available = Extract<IndexComparisonResult, { status: 'ok' | 'partial' }>;

function partialSentence(r: Available): string | null {
  if (r.excludedCount === 0) return null;
  const after = r.legs.some((l) => l.excluded === 'after-carry-window');
  const before = r.legs.some((l) => l.excluded === 'before-series');
  const amount = formatRupees(r.excludedAmount);
  const n = plural(r.excludedCount, 'transaction');
  if (before && !after) return `Partial comparison: ${amount} across ${n} before ${formatDate(firstBundledDate(r))} is left out because the benchmark data starts there.`;
  if (after && !before) return `Partial comparison: ${amount} across ${n} after ${formatDate(addDays(r.benchmark.lastBundledDate, 45))} is left out because the benchmark data ends there.`;
  return `Partial comparison: ${amount} across ${n} outside the benchmark data (${formatDate(firstBundledDate(r))} to ${formatDate(r.benchmark.lastBundledDate)}) is left out.`;
}

/** The bundled series' first date is not on the result; the earliest non-excluded leg's NAV date is the honest proxy. */
function firstBundledDate(r: Available): string {
  const dates = r.legs.filter((l) => !l.excluded).map((l) => l.benchmarkNavDate);
  return dates.length > 0 ? (dates.sort()[0] as string) : r.benchmark.lastBundledDate;
}

function valueDifferenceText(diff: number): { text: string; word: 'ahead' | 'behind' | 'level' } {
  if (Math.abs(diff) < 0.5) return { text: 'The same cash flows in the index fund would have been worth the same', word: 'level' };
  return diff > 0
    ? { text: `The same cash flows in the index fund would have been worth ${formatRupees(diff)} more`, word: 'behind' }
    : { text: `The same cash flows in the index fund would have been worth ${formatRupees(-diff)} less`, word: 'ahead' };
}

export function ComparisonSection({ analysis, infoRef, infoOpen, onInfo }: Props) {
  const [legsOpen, setLegsOpen] = useState(false);
  const asOfText = formatDate(analysis.asOf);
  const info = { label: 'the index comparison', expanded: infoOpen, onClick: onInfo };
  const c = analysis.comparison;

  if (c === 'loading') {
    return (
      <Section ref={infoRef} id="comparison" title="vs Nifty 50 index fund" asOf={asOfText} info={info}>
        <Skeleton className="h-[140px] w-full" label="Loading benchmark" />
      </Section>
    );
  }
  if (!c.ok) {
    return (
      <Section ref={infoRef} id="comparison" title="vs Nifty 50 index fund" asOf={asOfText} info={info}>
        <EmptyPanel title="This section couldn't be computed" actions={<Link variant="standalone" href={ROUTES.report}>Report a parsing issue</Link>} />
      </Section>
    );
  }
  const r = c.value.portfolio;
  if (r.status === 'unavailable') {
    const last = formatDate(r.benchmark.lastBundledDate);
    return (
      <Section ref={infoRef} id="comparison" title="vs Nifty 50 index fund" asOf={asOfText} info={info}>
        <EmptyPanel title="Comparison not available">
          {r.reason === 'series-too-old' && <>Benchmark data ends {last} and is too old for this statement; a refresh is pending on <Link variant="external" href={LINKS.benchmarkRefresh}>GitHub</Link></>}
          {r.reason === 'no-cashflows-in-range' && <>None of your cash flows fall inside the benchmark data (up to {last}), so there is nothing to compare.</>}
          {r.reason === 'no-benchmark-data' && <>Benchmark data didn't load. Reload the page to try again.</>}
        </EmptyPanel>
      </Section>
    );
  }

  const partialNote = partialSentence(r);
  const gap = r.gapPoints !== undefined ? formatGap(r.gapPoints) : null;
  const diff = r.valueDifference !== undefined && r.gapPoints !== undefined ? valueDifferenceText(r.valueDifference) : null;
  const yoursOk = r.yourXirr.status === 'ok';
  const benchOk = r.benchmarkXirr.status === 'ok';
  const gapPointsAbs = r.gapPoints !== undefined ? (Math.abs(r.gapPoints) * 100).toFixed(1) : null;
  const ariaLabel = [
    `XIRR comparison as of ${asOfText}: your portfolio ${yoursOk ? formatXirr((r.yourXirr as { rate: number }).rate) : 'not available'}, ${r.benchmark.fundName} ${benchOk ? formatXirr((r.benchmarkXirr as { rate: number }).rate) : 'not available'}`,
    gap && gapPointsAbs ? `; ${gapPointsAbs} percentage points ${gap.word}` : '',
    diff ? `; ${diff.text.charAt(0).toLowerCase()}${diff.text.slice(1)}.` : '.',
    partialNote ? ` Partial comparison: ${formatRupees(r.excludedAmount)} excluded.` : '',
  ].join('');
  const byFund = c.value.byFund;

  return (
    <Section ref={infoRef} id="comparison" title="vs Nifty 50 index fund" asOf={asOfText} info={info}
      badges={r.status === 'partial' && r.excludedCount > 0 ? <Badge variant="caution">partial</Badge> : undefined}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-small text-ink-2">Your portfolio</div>
          <PercentXirr value={r.yourXirr} style="num-lg" />
          <div className="text-caption text-ink-3">XIRR</div>
        </div>
        <div>
          <div className="text-small text-ink-2">Index fund</div>
          {benchOk ? <span className="num text-num-lg text-ink-1">{formatXirr((r.benchmarkXirr as { rate: number }).rate)}</span> : <span className="flex flex-col"><span className="num text-num-lg text-ink-3">{DASH}</span><span className="text-caption text-ink-3">{xirrReason(r.benchmarkXirr)}</span></span>}
          <div className="text-caption text-ink-3">XIRR</div>
        </div>
      </div>
      {yoursOk && benchOk && (
        <div className="mt-2">
          <ColumnPair yours={(r.yourXirr as { rate: number }).rate} index={(r.benchmarkXirr as { rate: number }).rate} ariaLabel={ariaLabel} />
        </div>
      )}
      {gap && <div className="mt-3"><PercentGap gapPoints={r.gapPoints as number} /></div>}
      {diff && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1 text-body text-ink-1">
          {diff.text}
          {diff.word !== 'level' && <span className={`text-caption ${diff.word === 'ahead' ? 'text-gain' : 'text-loss'}`}>({diff.word})</span>}
        </p>
      )}
      <p className="mt-3 text-caption text-ink-3">Benchmark: {r.benchmark.fundName} · {r.benchmark.source} · data to {formatDate(r.benchmark.lastBundledDate)} · Index fund NAV already includes its expense ratio.</p>
      {partialNote && <p className="mt-2 text-small text-caution">{partialNote}</p>}
      {r.carriedForwardDays > 0 && (
        <Banner variant="caution" className="mt-3" dismissible={false}>Benchmark NAV carried forward {r.carriedForwardDays} days (data ends {formatDate(r.benchmark.lastBundledDate)}).</Banner>
      )}
      <div className="sr-only">
      <table>
        <caption>XIRR comparison as of {asOfText}</caption>
        <tbody>
          <tr><th scope="row">Your portfolio</th><td>{yoursOk ? formatXirr((r.yourXirr as { rate: number }).rate) : DASH}</td></tr>
          <tr><th scope="row">Index fund</th><td>{benchOk ? formatXirr((r.benchmarkXirr as { rate: number }).rate) : DASH}</td></tr>
          {gap && <tr><th scope="row">Gap</th><td>{gap.text} {gap.word}</td></tr>}
          {diff && <tr><th scope="row">Value difference</th><td>{diff.text}</td></tr>}
        </tbody>
      </table>
      </div>
      {byFund.length > 0 && (
        <Disclosure label={`By fund (${byFund.length})`} className="mt-3">
          <DataTable
            caption="Comparison by fund"
            captionHidden
            rows={byFund}
            rowKey={(x) => x.fundId}
            stickyFirst
            columns={[
              { key: 'fund', header: 'Fund', cell: (x) => <span className="inline-flex flex-wrap items-center gap-1 text-ink-1">{schemeNameOf(analysis.fundById, x.fundId)}{x.result.status === 'partial' && x.result.excludedCount > 0 && <Badge variant="caution">partial</Badge>}</span> },
              { key: 'yours', header: 'Your XIRR', numeric: true, cell: (x) => (x.result.status === 'unavailable' ? DASH : <PercentXirr value={x.result.yourXirr} style="num-md" className="items-end" />) },
              { key: 'index', header: 'Index fund XIRR', numeric: true, cell: (x) => (x.result.status !== 'unavailable' && x.result.benchmarkXirr.status === 'ok' ? formatXirr(x.result.benchmarkXirr.rate) : DASH) },
              { key: 'gap', header: 'Gap', numeric: true, cell: (x) => (x.result.status !== 'unavailable' && x.result.gapPoints !== undefined ? <PercentGap gapPoints={x.result.gapPoints} style="num-md" className="items-end" /> : DASH) },
              { key: 'diff', header: 'Would have been worth', numeric: true, cell: (x) => (x.result.status !== 'unavailable' && x.result.valueDifference !== undefined ? <Money value={x.result.valueDifference} variant="signed" /> : DASH) },
            ]}
          />
          <div className="mt-2"><LinkButton sm onClick={() => setLegsOpen(true)}>See the shadow cash flows</LinkButton></div>
        </Disclosure>
      )}
      <LegsDrawer open={legsOpen} onClose={() => setLegsOpen(false)} legs={r.legs} />
    </Section>
  );
}

function LegsDrawer({ open, onClose, legs }: { open: boolean; onClose: () => void; legs: ShadowLeg[] }) {
  return (
    <Drawer open={open} onClose={onClose} title="Shadow cash flows">
      <DataTable
        caption="Shadow cash flows"
        captionHidden
        rows={legs}
        rowKey={(l, i) => `${l.date}:${i}`}
        stickyFirst
        variant="striped"
        focusableRegion
        columns={[
          { key: 'date', header: 'Date', cell: (l) => <span className="whitespace-nowrap">{formatDate(l.date)}</span> },
          { key: 'actual', header: 'Your flow', numeric: true, cell: (l) => formatRupees(l.actual, { decimals: 2, signed: true }) },
          { key: 'shadow', header: 'Index fund flow', numeric: true, cell: (l) => (l.excluded ? DASH : formatRupees(l.shadow, { decimals: 2, signed: true })) },
          { key: 'nav', header: 'NAV used (date)', numeric: true, cell: (l) => (l.excluded ? DASH : `${l.benchmarkNav.toFixed(4)} (${formatDate(l.benchmarkNavDate)})`) },
          { key: 'excluded', header: 'Excluded reason', cell: (l) => (l.excluded ? <Badge variant="caution">{l.excluded === 'before-series' ? 'before benchmark data' : 'after benchmark data'}</Badge> : '') },
        ]}
      />
    </Drawer>
  );
}
