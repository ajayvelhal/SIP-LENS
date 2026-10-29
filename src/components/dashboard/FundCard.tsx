// Card (UI design component 17, §4.5.6): default, incomplete (badge + caution glyph), redeemed (Badge "realised").
import type { DetectedSip } from '../../engine';
import type { FundView } from '../../hooks/usePortfolio';
import { DASH, formatDate, formatNumber } from '../../lib/format';
import { Badge, CategoryBadge } from '../ui/Badge';
import { LinkButton } from '../ui/Link';
import { Money } from '../ui/Money';
import { PercentXirr } from '../ui/Percent';
import { bucketOf, folioLabel } from './fundHelpers';
import { SipLine } from './SipLine';

export interface FundRowProps {
  view: FundView;
  asOf: string;
  unitDecimals: 3 | 4;
  redeemed?: boolean;
  onCashflows: (fundId: string) => void;
  onSipDetail: (sip: DetectedSip) => void;
  onHowTo: () => void;
}

export function XirrReason({ view, onCashflows, onHowTo }: Pick<FundRowProps, 'view' | 'onCashflows' | 'onHowTo'>) {
  const x = view.xirr;
  if (x.status === 'ok') return null;
  if (x.status === 'no-convergence') {
    return <>Couldn't compute; <LinkButton sm className="min-h-0 py-0 text-caption" onClick={() => onCashflows(view.fund.id)}>see cash flows</LinkButton></>;
  }
  if (x.reason === 'opening-balance-without-history') {
    return <>Not enough history: this statement doesn't start at the fund's inception. <LinkButton sm className="min-h-0 py-0 text-caption" onClick={onHowTo}>Request a since-inception CAS</LinkButton>.</>;
  }
  return <>Not enough history to compute XIRR</>;
}

export function FundCard({ view, asOf, unitDecimals, redeemed = false, onCashflows, onSipDetail, onHowTo }: FundRowProps) {
  const { fund } = view;
  return (
    <article aria-label={fund.schemeName} className="flex flex-col rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-1">
        <CategoryBadge bucket={bucketOf(view.category)} />
        {view.category?.isElss && <Badge variant="elss">ELSS</Badge>}
        {fund.mayBeIncomplete && <Badge variant="caution">may be incomplete</Badge>}
        {redeemed && <Badge variant="info">realised</Badge>}
      </div>
      <h3 className="clamp-2 mt-2 text-h3 text-ink-1" title={fund.schemeName}>{fund.schemeName}</h3>
      {fund.alsoPrintedAs && fund.alsoPrintedAs.length > 0 && <p className="text-caption text-ink-3">also printed as: {fund.alsoPrintedAs.join(', ')}</p>}
      <p className="num text-caption text-ink-3">{folioLabel(fund)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
        <div>
          <dt className="text-small text-ink-2">Net invested</dt>
          <dd><Money value={view.totals.netInvested} style="num-lg" /></dd>
        </div>
        <div>
          <dt className="text-small text-ink-2">Value as of statement date</dt>
          <dd>
            {fund.closingValue !== undefined ? <Money value={fund.closingValue} style="num-lg" /> : (
              <span className="flex flex-col"><span className="num text-num-lg text-ink-3">{DASH}</span><span className="text-caption text-ink-3">not printed in the CAS</span></span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-small text-ink-2">XIRR</dt>
          <dd><PercentXirr value={view.xirr} style="num-lg" caution={fund.mayBeIncomplete} reason={<XirrReason view={view} onCashflows={onCashflows} onHowTo={onHowTo} />} /></dd>
        </div>
        <div>
          <dt className="text-small text-ink-2">Units held</dt>
          <dd className="num text-num-md text-ink-1">{formatNumber(fund.closingUnits, unitDecimals)}</dd>
        </div>
      </dl>
      <SipLine sips={view.sips} onDetail={onSipDetail} className="mt-3" />
      <div className="mt-2 flex items-end justify-between gap-2">
        <LinkButton sm onClick={() => onCashflows(fund.id)}>How we computed this</LinkButton>
        <span className="text-caption text-ink-3">as of {formatDate(asOf)}</span>
      </div>
    </article>
  );
}
