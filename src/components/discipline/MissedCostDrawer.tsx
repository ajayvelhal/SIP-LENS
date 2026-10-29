// Missed-cost drawer (UI design §4.8): per missed instalment, the NAV estimate and what it would be worth.
import type { MissedCostResult } from '../../engine';
import type { Analysis } from '../../hooks/usePortfolio';
import { formatDate, formatNumber, formatRupees } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { DataTable } from '../ui/DataTable';
import { Drawer } from '../ui/Dialog';
import { Glyph } from '../ui/Glyph';
import { schemeNameOf } from '../dashboard/fundHelpers';

interface Row { id: string; fund: string; date: string; amount: number; nav: number; source: 'interpolated' | 'nearest' | 'closing'; worth: number }

export function MissedCostDrawer({ open, onClose, analysis, costs }: { open: boolean; onClose: () => void; analysis: Analysis; costs: MissedCostResult[] }) {
  const rows: Row[] = costs.flatMap((c) => {
    const fund = analysis.fundById.get(c.fundId);
    const closingNav = fund?.closingNav ?? 0;
    return c.perInstalment.map((p, i) => ({ id: `${c.fundId}:${p.date}:${i}`, fund: schemeNameOf(analysis.fundById, c.fundId), date: p.date, amount: p.amount, nav: p.navEstimate, source: p.navSource, worth: (p.amount / p.navEstimate) * closingNav }));
  });
  const wouldBeWorth = costs.reduce((a, c) => a + c.wouldBeWorth, 0);
  const notInvested = costs.reduce((a, c) => a + c.notInvested, 0);
  const growthForgone = costs.reduce((a, c) => a + c.growthForgone, 0);
  const asOfText = formatDate(analysis.asOf);
  return (
    <Drawer open={open} onClose={onClose} title="How we computed the missed-SIP cost">
      <p className="text-body text-ink-2">For each missed instalment we took the amount you would have invested, bought units at an estimate of the fund's NAV on that date, and valued them at the closing NAV on the statement date. The NAV is interpolated between the nearest transactions in your CAS, so this is an estimate, not a record.</p>
      <DataTable
        className="mt-3"
        caption="Missed instalments"
        captionHidden
        rows={rows}
        rowKey={(r) => r.id}
        stickyFirst
        columns={[
          { key: 'date', header: 'Expected date', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.date)}</span> },
          { key: 'fund', header: 'Fund', cell: (r) => <span className="text-ink-2">{r.fund}</span> },
          { key: 'amount', header: 'Amount', numeric: true, cell: (r) => formatRupees(r.amount) },
          { key: 'nav', header: 'NAV estimate', numeric: true, cell: (r) => <span className="inline-flex flex-col items-end gap-1">{formatNumber(r.nav, 4)}<Badge variant="neutral">{r.source}</Badge></span> },
          { key: 'worth', header: `Worth on ${asOfText}`, numeric: true, cell: (r) => formatRupees(r.worth) },
        ]}
        footer={
          <tr>
            <td colSpan={5} className="num px-3 py-2 text-small text-ink-1">
              Would be worth {formatRupees(wouldBeWorth)} · Not invested {formatRupees(notInvested)} · Growth forgone {formatRupees(growthForgone)}
            </td>
          </tr>
        }
      />
      <p className="mt-3 flex items-start gap-1 text-caption text-caution">
        <Glyph name="caution" size={14} className="mt-px" />
        Estimate from NAVs printed in your statement. It describes the past; it is not a projection.
      </p>
    </Drawer>
  );
}
