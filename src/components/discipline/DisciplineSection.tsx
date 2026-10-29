// S8 SIP discipline section (UI design §4.8): ring, definition, totals, per-fund Meter rows, missed-cost line,
// no-SIP funds note, hidden table twin. Owns the missed-cost drawer.
import { useState, type RefObject } from 'react';
import type { DetectedSip } from '../../engine';
import type { Analysis } from '../../hooks/usePortfolio';
import { sipKey } from '../../hooks/usePortfolio';
import { FREQUENCY_WORD, formatDate, formatMonthYear, formatRupees, plural } from '../../lib/format';
import { ROUTES } from '../../lib/links';
import { Badge } from '../ui/Badge';
import { EmptyPanel } from '../ui/EmptyPanel';
import { InfoButton } from '../ui/InfoButton';
import { Link, LinkButton } from '../ui/Link';
import { Meter } from '../ui/Meter';
import { Section } from '../ui/Section';
import { schemeNameOf } from '../dashboard/fundHelpers';
import { disciplineAriaLabel, disciplineTotals, totalsSentence } from './disciplineText';
import { MissedCostDrawer } from './MissedCostDrawer';
import { RingMeter } from './RingMeter';

interface Props {
  analysis: Analysis;
  infoRef: RefObject<HTMLButtonElement>;
  infoOpen: boolean;
  onInfo: () => void;
  onSipDetail: (sip: DetectedSip) => void;
}

export function DisciplineSection({ analysis, infoRef, infoOpen, onInfo, onSipDetail }: Props) {
  const [missedOpen, setMissedOpen] = useState(false);
  const asOfText = formatDate(analysis.asOf);
  const d = analysis.discipline;
  const info = { label: 'SIP discipline', expanded: infoOpen, onClick: onInfo };

  if (!d.ok) {
    return (
      <Section ref={infoRef} id="discipline" title="SIP discipline" asOf={asOfText} info={info}>
        <EmptyPanel title="This section couldn't be computed" actions={<Link variant="standalone" href={ROUTES.report}>Report a parsing issue</Link>} />
      </Section>
    );
  }
  const result = d.value;
  if (result.score === null) {
    return (
      <Section ref={infoRef} id="discipline" title="SIP discipline" asOf={asOfText} info={info}>
        <p className="text-body text-ink-2">No regular SIP found in this statement. A SIP is three or more equal purchases at a regular interval, or rows the RTA marks as systematic.</p>
      </Section>
    );
  }
  const totals = disciplineTotals(result);
  const costs = [...result.missedCost.values()];
  const growthForgone = costs.reduce((a, c) => a + c.growthForgone, 0);
  const missedCount = totals.missed;

  return (
    <Section ref={infoRef} id="discipline" title="SIP discipline" asOf={asOfText} info={info}>
      <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
        <RingMeter score={result.score} variant="section" ariaLabel={disciplineAriaLabel(result, asOfText)} />
        <div className="text-center lg:text-left">
          <p className="text-body text-ink-2">How consistently you kept your SIPs going.</p>
          <p className="mt-1 text-small text-ink-2">{totalsSentence(totals)}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {result.sips.map((sip) => {
          const name = schemeNameOf(analysis.fundById, sip.fundId);
          const amount = (sip.amounts[sip.amounts.length - 1] as { amount: number }).amount;
          const denominator = sip.counts.made + sip.counts.missed;
          return (
            <li key={sipKey(sip) + sip.firstDate}>
              <div className="text-small text-ink-1">{name}</div>
              <Meter percent={sip.percent} label={`${name}: ${sip.percent} percent of SIP instalments made, ${sip.counts.made} of ${denominator}`} className="mt-1" />
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-caption text-ink-2">
                <span>{formatRupees(amount)} {FREQUENCY_WORD[sip.frequency]} · {sip.counts.made}/{denominator} · {sip.counts.missed} missed</span>
                {sip.stoppedSince && <Badge variant="neutral">stopped {formatMonthYear(sip.stoppedSince)}</Badge>}
                <InfoButton label="How we detected this" expanded={false} onClick={() => onSipDetail(sip)} className="-my-3" />
              </div>
            </li>
          );
        })}
      </ul>
      {missedCount > 0 && costs.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 text-body text-ink-1">
          <span>
            {growthForgone > 0 ? (
              <>Missed SIPs cost you about <strong className="num text-body-strong">{formatRupees(growthForgone)}</strong> in growth</>
            ) : (
              <>Skipping {plural(missedCount, 'instalment')} would have lost about <strong className="num text-body-strong">{formatRupees(Math.abs(growthForgone))}</strong> at the fund's NAVs on those dates</>
            )}
          </span>
          <Badge variant="caution">estimate</Badge>
          <LinkButton sm onClick={() => setMissedOpen(true)}>How we computed this</LinkButton>
        </p>
      )}
      {result.fundsWithoutSip.length > 0 && (
        <p className="mt-2 text-caption text-ink-3">{plural(result.fundsWithoutSip.length, 'fund')} have purchases but no regular SIP</p>
      )}
      <div className="sr-only">
      <table>
        <caption>SIP discipline by fund</caption>
        <thead><tr><th scope="col">Fund</th><th scope="col">Expected</th><th scope="col">Made</th><th scope="col">Missed</th><th scope="col">Percent</th></tr></thead>
        <tbody>
          {result.sips.map((sip) => (
            <tr key={`t-${sipKey(sip)}-${sip.firstDate}`}><td>{schemeNameOf(analysis.fundById, sip.fundId)}</td><td>{sip.counts.made + sip.counts.missed}</td><td>{sip.counts.made}</td><td>{sip.counts.missed}</td><td>{sip.percent}%</td></tr>
          ))}
        </tbody>
      </table>
      </div>
      <MissedCostDrawer open={missedOpen} onClose={() => setMissedOpen(false)} analysis={analysis} costs={costs} />
    </Section>
  );
}
