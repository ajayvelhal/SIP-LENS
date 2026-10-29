// Fund list (UI design §4.5.6): heading with count, SortControl below 1024 px, Cards below 1024 px and the
// FundTable from 1024 px (CSS switch), fully redeemed funds in a collapsed Disclosure.
import { useMemo, useState } from 'react';
import type { DetectedSip } from '../../engine';
import type { Analysis } from '../../hooks/usePortfolio';
import { announce } from '../../lib/announce';
import { Disclosure } from '../ui/Disclosure';
import { EmptyPanel } from '../ui/EmptyPanel';
import { Link } from '../ui/Link';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ROUTES } from '../../lib/links';
import { FundCard } from './FundCard';
import { FundTable } from './FundTable';
import { SORT_OPTIONS, sortAnnouncement, sortFunds, type SortKey } from './sort';

interface Props {
  analysis: Analysis;
  onCashflows: (fundId: string) => void;
  onSipDetail: (sip: DetectedSip) => void;
  onHowTo: () => void;
}

export function FundList({ analysis, onCashflows, onSipDetail, onHowTo }: Props) {
  const [sort, setSort] = useState<SortKey>('value');
  const active = useMemo(() => sortFunds(analysis.funds.filter((v) => v.fund.closingUnits > 0), sort), [analysis.funds, sort]);
  const redeemed = useMemo(() => sortFunds(analysis.funds.filter((v) => v.fund.closingUnits <= 0), sort), [analysis.funds, sort]);
  const unitDecimals = analysis.result.portfolio.unitDecimals;
  const rowProps = { asOf: analysis.asOf, unitDecimals, onCashflows, onSipDetail, onHowTo };

  const changeSort = (k: SortKey) => { setSort(k); announce(sortAnnouncement(k)); };

  return (
    <section aria-labelledby="funds-heading" className="mt-8">
      {analysis.isEmpty && (
        <EmptyPanel
          className="mb-4"
          glyph="document-search"
          title={`We found ${analysis.funds.length} ${analysis.funds.length === 1 ? 'fund' : 'funds'} but no transactions we can compute returns from`}
          actions={<Link variant="standalone" href={ROUTES.report}>Report a parsing issue</Link>}
        >
          Every row in this statement was a reversal, a unit adjustment or a row we couldn't classify. The funds are listed below so you can check the file was read.
        </EmptyPanel>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="funds-heading" className="text-h2 text-ink-1">Your funds ({active.length})</h2>
        <div className="flex items-center gap-2 lg:hidden">
          <span className="text-small text-ink-2">Sort</span>
          <SegmentedControl label="Sort funds" options={SORT_OPTIONS} value={sort} onChange={changeSort} sm />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:hidden">
        {active.map((v) => <FundCard key={v.fund.id} view={v} {...rowProps} />)}
      </div>
      <div className="hidden lg:block">
        <FundTable rows={active} sort={sort} onSort={changeSort} caption={`Your funds (${active.length})`} {...rowProps} />
      </div>
      {redeemed.length > 0 && (
        <Disclosure label={`Fully redeemed (${redeemed.length})`} className="mt-3">
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:hidden">
            {redeemed.map((v) => <FundCard key={v.fund.id} view={v} redeemed {...rowProps} />)}
          </div>
          <div className="hidden lg:block">
            <FundTable rows={redeemed} sort={sort} onSort={changeSort} caption={`Fully redeemed (${redeemed.length})`} {...rowProps} />
          </div>
        </Disclosure>
      )}
    </section>
  );
}
