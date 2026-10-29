// Summary tiles (UI design §4.5.4, US-12): Portfolio XIRR, Total invested, Value as of statement date, SIP discipline.
import type { RefObject } from 'react';
import type { Analysis } from '../../hooks/usePortfolio';
import { DASH, formatDate, plural } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { LinkButton } from '../ui/Link';
import { Money } from '../ui/Money';
import { PercentXirr } from '../ui/Percent';
import { Tile } from '../ui/Tile';
import { RingMeter } from '../discipline/RingMeter';
import { disciplineAriaLabel } from '../discipline/disciplineText';

interface Props {
  analysis: Analysis;
  xirrInfoRef: RefObject<HTMLButtonElement>;
  xirrOpen: boolean;
  onXirrInfo: () => void;
  disciplineInfoRef: RefObject<HTMLButtonElement>;
  disciplineOpen: boolean;
  onDisciplineInfo: () => void;
  onSeeCashflows: () => void;
}

export function SummaryTiles({ analysis, xirrInfoRef, xirrOpen, onXirrInfo, disciplineInfoRef, disciplineOpen, onDisciplineInfo, onSeeCashflows }: Props) {
  const asOf = formatDate(analysis.asOf);
  const { summary } = analysis;
  const incomplete = summary.skippedFunds.filter((s) => s.reason === 'may-be-incomplete').length;
  const noHistory = summary.skippedFunds.length - incomplete;
  const seriesFootnotes = [
    ...(incomplete > 0 ? [`excludes ${plural(incomplete, 'fund')} with read errors`] : []),
    ...(noHistory > 0 ? [`excludes ${plural(noHistory, 'fund')} held before the statement period`] : []),
  ];
  const xirr = summary.xirr;
  const xirrReason = analysis.isEmpty
    ? 'No transactions to compute from'
    : xirr.status === 'no-convergence'
      ? <>Couldn't compute; <LinkButton sm className="min-h-0 py-0 text-caption" onClick={onSeeCashflows}>see cash flows</LinkButton></>
      : undefined;
  const discipline = analysis.discipline;
  const score = discipline.ok ? discipline.value.score : null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4 lg:gap-6">
      <Tile ref={xirrInfoRef} label="Portfolio XIRR" asOf={asOf} info={{ expanded: xirrOpen, onClick: onXirrInfo }} footnotes={seriesFootnotes}
        badges={xirr.status === 'ok' && xirr.warning === 'multiple-roots' ? <Badge variant="caution">check cash flows</Badge> : undefined}>
        <PercentXirr value={analysis.isEmpty ? { status: 'insufficient', reason: 'fewer-than-two' } : xirr} style="display" stacked reason={xirrReason} />
      </Tile>
      <Tile label="Total invested" asOf={asOf} footnotes={seriesFootnotes}>
        {analysis.isEmpty ? <DashValue reason="No transactions to compute from" /> : <Money value={summary.totalInvested} style="display" />}
      </Tile>
      <Tile label="Value as of statement date" asOf={asOf} footnotes={summary.fundsWithoutPrintedValue > 0 ? [`${plural(summary.fundsWithoutPrintedValue, 'fund')} without a printed value excluded`] : []}>
        <Money value={summary.valueAsOfStatementDate} style="display" />
      </Tile>
      <Tile ref={disciplineInfoRef} label="SIP discipline score" asOf={asOf} info={{ expanded: disciplineOpen, onClick: onDisciplineInfo }}>
        {discipline.ok && score !== null ? (
          <RingMeter score={score} variant="tile" ariaLabel={disciplineAriaLabel(discipline.value, asOf)} />
        ) : (
          <DashValue reason={discipline.ok ? 'No regular SIP found in this statement' : "This section couldn't be computed"} />
        )}
      </Tile>
    </div>
  );
}

function DashValue({ reason }: { reason: string }) {
  return (
    <span className="flex flex-col">
      <span className="num text-num-lg text-ink-3 md:text-display-sm lg:text-display" aria-label="not available">{DASH}</span>
      <span className="text-caption text-ink-3">{reason}</span>
    </span>
  );
}
