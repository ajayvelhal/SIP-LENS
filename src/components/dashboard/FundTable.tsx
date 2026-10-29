// FundTable (UI design component 18, >= 1024 px): same data and badges as the Card; header cells sort.
import { formatNumber } from '../../lib/format';
import { Badge, CategoryBadge } from '../ui/Badge';
import { LinkButton } from '../ui/Link';
import { Money } from '../ui/Money';
import { PercentXirr } from '../ui/Percent';
import { XirrReason, type FundRowProps } from './FundCard';
import { bucketOf, folioLabel } from './fundHelpers';
import { SipLine } from './SipLine';
import type { SortKey } from './sort';

interface Props extends Omit<FundRowProps, 'view' | 'redeemed'> {
  rows: FundRowProps['view'][];
  sort: SortKey;
  onSort: (key: SortKey) => void;
  caption: string;
}

function SortHeader({ label, k, sort, onSort, numeric = false }: { label: string; k: SortKey; sort: SortKey; onSort: (k: SortKey) => void; numeric?: boolean }) {
  const active = sort === k;
  return (
    <th scope="col" aria-sort={active ? (k === 'name' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 font-normal ${numeric ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex min-h-[36px] items-center gap-1 rounded-sm px-1 text-small ${active ? 'font-semibold text-ink-1' : 'text-ink-2'}`}>
        {label}
        <span aria-hidden="true" className="text-caption">{active ? (k === 'name' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}

export function FundTable({ rows, sort, onSort, asOf, unitDecimals, onCashflows, onSipDetail, onHowTo, caption }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full border-collapse text-small text-ink-1">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-sunken text-small text-ink-2">
          <tr>
            <SortHeader label="Fund" k="name" sort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-right font-normal">Net invested</th>
            <SortHeader label="Value as of statement date" k="value" sort={sort} onSort={onSort} numeric />
            <th scope="col" className="px-3 py-2 text-right font-normal">Units held</th>
            <SortHeader label="XIRR" k="xirr" sort={sort} onSort={onSort} numeric />
            <th scope="col" className="px-3 py-2 text-left font-normal">SIP</th>
            <th scope="col" className="px-3 py-2 text-left font-normal"><span className="sr-only">How we computed this</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((view) => {
            const { fund } = view;
            return (
              <tr key={fund.id} className="min-h-[56px] border-t border-border align-top">
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <CategoryBadge bucket={bucketOf(view.category)} />
                    {view.category?.isElss && <Badge variant="elss">ELSS</Badge>}
                  </div>
                  <div className="mt-1 text-body-strong text-ink-1" title={fund.schemeName}>{fund.schemeName}</div>
                  {fund.alsoPrintedAs && fund.alsoPrintedAs.length > 0 && <div className="text-caption text-ink-3">also printed as: {fund.alsoPrintedAs.join(', ')}</div>}
                  <div className="num text-caption text-ink-3">{folioLabel(fund)}</div>
                  {fund.mayBeIncomplete && <Badge variant="caution" className="mt-1">may be incomplete</Badge>}
                </td>
                <td className="num px-3 py-3 text-right"><Money value={view.totals.netInvested} /></td>
                <td className="num px-3 py-3 text-right">
                  {fund.closingValue !== undefined ? <Money value={fund.closingValue} /> : <span className="text-ink-3">— <span className="block text-caption">not printed in the CAS</span></span>}
                </td>
                <td className="num px-3 py-3 text-right text-num-md">{formatNumber(fund.closingUnits, unitDecimals)}</td>
                <td className="px-3 py-3 text-right">
                  <PercentXirr value={view.xirr} style="num-md" caution={fund.mayBeIncomplete} reason={<XirrReason view={view} onCashflows={onCashflows} onHowTo={onHowTo} />} className="items-end text-right" />
                </td>
                <td className="px-3 py-3"><SipLine sips={view.sips} onDetail={onSipDetail} /></td>
                <td className="px-3 py-3"><LinkButton sm onClick={() => onCashflows(fund.id)}>How we computed this</LinkButton></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
