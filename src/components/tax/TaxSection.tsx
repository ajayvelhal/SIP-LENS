// S10 Tax preview (UI design §4.10, US-30 to US-34): the long disclaimer renders before any number; tiles, the short
// disclaimer, debt / hybrid / realised / excluded lines, per-fund table (1024 px) or cards, the Lots drawer and
// the "Rules we used" disclosure. Nothing here recommends an action.
import { useState, type ReactNode } from 'react';
import type { FundTax, LotTax, TaxEstimateResult } from '../../engine';
import { fyOf } from '../../engine';
import type { Analysis } from '../../hooks/usePortfolio';
import { DASH, formatDate, formatFy, formatNumber, formatRupees, plural } from '../../lib/format';
import { ROUTES } from '../../lib/links';
import { Badge, CategoryBadge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { DataTable } from '../ui/DataTable';
import { Drawer } from '../ui/Dialog';
import { DisclaimerBlock } from '../ui/DisclaimerBlock';
import { Disclosure } from '../ui/Disclosure';
import { EmptyPanel } from '../ui/EmptyPanel';
import { Link, LinkButton } from '../ui/Link';
import { Money } from '../ui/Money';
import { Section } from '../ui/Section';
import { Skeleton } from '../ui/Skeleton';
import { bucketOf, schemeNameOf } from '../dashboard/fundHelpers';

const CLASS_WORD: Record<FundTax['taxClass'], string> = { equity: 'Equity', debt: 'Debt', 'hybrid-other': 'Hybrid (other)', unknown: 'Unclassified' };
const EXCLUSION_WORD = { unclassified: 'unclassified ISIN', 'may-be-incomplete': 'may be incomplete', 'no-closing-nav': 'no closing NAV' } as const;

function nearestUnlock(ft: FundTax): string | undefined {
  const dates = ft.lots.filter((l) => l.term === 'locked' && l.unlockOn).map((l) => l.unlockOn as string).sort();
  return dates[0];
}

function GainCell({ value }: { value: number }) {
  return <Money value={value} variant="gain-loss" />;
}

export function TaxSection({ analysis }: { analysis: Analysis }) {
  const [lotsFund, setLotsFund] = useState<string | null>(null);
  const asOfText = formatDate(analysis.asOf);
  const t = analysis.tax;

  if (t === 'loading') {
    return (
      <Section id="tax" title="Tax preview" asOf={asOfText}>
        <Skeleton className="h-24 w-full" label="Loading tax rules" />
      </Section>
    );
  }
  if (!t.ok) {
    return (
      <Section id="tax" title="Tax preview" asOf={asOfText}>
        <EmptyPanel title="This section couldn't be computed" actions={<Link variant="standalone" href={ROUTES.report}>Report a parsing issue</Link>} />
      </Section>
    );
  }
  const tax: TaxEstimateResult = t.value;
  const { rules } = tax;
  const title = `Tax preview · ${formatFy(rules.fy)} rules · last verified ${formatDate(rules.lastVerified)}`;
  const realised = tax.funds.reduce((a, f) => a + f.realisedEventsNotIncluded, 0);
  const lotsFundTax = lotsFund ? tax.funds.find((f) => f.fundId === lotsFund) : undefined;

  return (
    <Section id="tax" title={title} asOf={asOfText} badges={rules.status === 'to-verify' ? <Badge variant="caution">unverified</Badge> : undefined}>
      {!tax.exactFy && <Banner variant="caution" className="mb-3" dismissible={false}>Rules for {formatFy(rules.fy)} applied to a statement dated in {formatFy(fyOf(tax.asOf))}.</Banner>}
      <DisclaimerBlock variant="long" text={tax.disclaimerLong} />
      <p className="mt-4 text-body-strong text-ink-1">If you redeemed everything on the statement date</p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4 lg:gap-6">
        <TaxTile label="Short-term gain"><Money value={tax.equity.shortTermGain} variant="gain-loss" style="num-lg" /></TaxTile>
        <TaxTile label="Long-term gain"><Money value={tax.equity.longTermGain} variant="gain-loss" style="num-lg" /></TaxTile>
        <TaxTile label="Exemption applied" caption={`${formatRupees(rules.equity.ltcgExemption)} limit, once per FY`}><Money value={tax.equity.exemptionApplied} style="num-lg" /></TaxTile>
        <TaxTile label="Estimated tax" caption="equity only" badge={<Badge variant="caution">estimate</Badge>}><Money value={tax.estimatedTaxIfRedeemed} style="num-lg" /></TaxTile>
      </div>
      <DisclaimerBlock variant="short" text={tax.disclaimerShort} className="mt-3" />
      <div className="mt-3 space-y-1 text-small text-ink-2">
        {tax.funds.some((f) => f.taxClass === 'debt') && (
          <p>Debt funds: {tax.debt.gain < 0 ? <>loss <span className="num text-loss">{formatRupees(Math.abs(tax.debt.gain))}</span></> : <>gain <span className="num text-ink-1">{formatRupees(tax.debt.gain)}</span></>}, taxed at your income-tax slab</p>
        )}
        {tax.hybridOther.gain !== 0 && <p>Hybrid funds (35–65% equity): gain <span className="num text-ink-1">{formatRupees(tax.hybridOther.gain)}</span>, special hybrid rules; not computed in v1</p>}
        {realised > 0 && <p>{plural(realised, 'past redemption')} not included in v1</p>}
      </div>
      {tax.excludedFunds.length > 0 && (
        <p className="mt-2 text-caption text-caution">
          {plural(tax.excludedFunds.length, 'fund')} excluded: {tax.excludedFunds.map((e) => `${schemeNameOf(analysis.fundById, e.fundId)} (${EXCLUSION_WORD[e.reason]})`).join(', ')}
        </p>
      )}
      {tax.funds.length > 0 && (
        <>
          <div className="mt-4 hidden lg:block">
            <DataTable
              caption="Tax preview by fund"
              captionHidden
              rows={tax.funds}
              rowKey={(f) => f.fundId}
              columns={[
                { key: 'fund', header: 'Fund', cell: (f) => <FundCell analysis={analysis} ft={f} /> },
                { key: 'class', header: 'Class', cell: (f) => CLASS_WORD[f.taxClass] },
                { key: 'st', header: 'Short-term gain', numeric: true, cell: (f) => <GainCell value={f.shortTermGain} /> },
                { key: 'lt', header: 'Long-term gain', numeric: true, cell: (f) => <GainCell value={f.longTermGain} /> },
                { key: 'locked', header: 'Locked gain', numeric: true, cell: (f) => (f.isElss && f.lockedGain !== 0 ? <span className="inline-flex flex-col items-end gap-1"><span>{formatRupees(f.lockedGain)} locked</span>{nearestUnlock(f) && <Badge variant="caution">locked until {formatDate(nearestUnlock(f) as string)}</Badge>}</span> : DASH) },
                { key: 'note', header: 'Note', cell: (f) => <span className="text-caption text-ink-3">{f.note ?? ''}</span> },
                { key: 'lots', header: <span className="sr-only">Lots</span>, cell: (f) => <LinkButton sm onClick={() => setLotsFund(f.fundId)}>Show lots</LinkButton> },
              ]}
            />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 md:gap-4 lg:hidden">
            {tax.funds.map((f) => (
              <div key={f.fundId} className="rounded-md border border-border bg-surface p-4">
                <FundCell analysis={analysis} ft={f} />
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div><dt className="text-small text-ink-2">Tax class</dt><dd className="text-small text-ink-1">{CLASS_WORD[f.taxClass]}</dd></div>
                  <div><dt className="text-small text-ink-2">Short-term gain</dt><dd><GainCell value={f.shortTermGain} /></dd></div>
                  <div><dt className="text-small text-ink-2">Long-term gain</dt><dd><GainCell value={f.longTermGain} /></dd></div>
                  {f.isElss && f.lockedGain !== 0 && (
                    <div><dt className="text-small text-ink-2">Locked gain</dt><dd className="flex flex-col items-start gap-1"><span className="num text-num-md">{formatRupees(f.lockedGain)} locked</span>{nearestUnlock(f) && <Badge variant="caution">locked until {formatDate(nearestUnlock(f) as string)}</Badge>}</dd></div>
                  )}
                </dl>
                {f.note && <p className="mt-2 text-caption text-ink-3">{f.note}</p>}
                <LinkButton sm onClick={() => setLotsFund(f.fundId)} className="mt-1">Show lots</LinkButton>
              </div>
            ))}
          </div>
        </>
      )}
      <Disclosure label="Rules we used" className="mt-4">
        <DataTable
          caption="Rules we used"
          captionHidden
          rows={rules.displayTable}
          rowKey={(r, i) => `${r.fundType}-${i}`}
          columns={[
            { key: 'type', header: 'Fund type', cell: (r) => r.fundType },
            { key: 'period', header: 'Holding period', cell: (r) => r.holdingPeriod },
            { key: 'rate', header: 'Tax rate', cell: (r) => r.rate },
            { key: 'notes', header: 'Notes', cell: (r) => <span className="text-ink-2">{r.notes}</span> },
          ]}
        />
        <h3 className="mt-3 text-small font-semibold text-ink-1">Simplifications</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-small text-ink-2">
          {rules.simplifications.map((s) => <li key={s}>{s}</li>)}
        </ul>
        <p className="mt-2 text-caption text-ink-3">{rules.financeActReference} · {rules.verifiedBy ? `verified by ${rules.verifiedBy}` : 'not yet verified'} on {formatDate(rules.lastVerified)}</p>
      </Disclosure>
      <LotsDrawer analysis={analysis} ft={lotsFundTax} onClose={() => setLotsFund(null)} />
    </Section>
  );
}

function TaxTile({ label, caption, badge, children }: { label: string; caption?: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-small text-ink-2">{label}</div>
      <div className="mt-1">{children}</div>
      {badge && <div className="mt-1">{badge}</div>}
      {caption && <div className="mt-1 text-caption text-ink-3">{caption}</div>}
    </div>
  );
}

function FundCell({ analysis, ft }: { analysis: Analysis; ft: FundTax }) {
  const view = analysis.funds.find((v) => v.fund.id === ft.fundId);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        <CategoryBadge bucket={bucketOf(view?.category)} />
        {ft.isElss && <Badge variant="elss">ELSS</Badge>}
      </div>
      <div className="mt-1 text-small text-ink-1">{schemeNameOf(analysis.fundById, ft.fundId)}</div>
    </div>
  );
}

function termBadge(l: LotTax) {
  if (l.term === 'locked') return <Badge variant="caution">locked until {l.unlockOn ? formatDate(l.unlockOn) : ''}</Badge>;
  if (l.term === 'unknown-holding') return <Badge variant="caution">holding period unknown</Badge>;
  return <Badge variant="neutral">{l.term}</Badge>;
}

function LotsDrawer({ analysis, ft, onClose }: { analysis: Analysis; ft: FundTax | undefined; onClose: () => void }) {
  const fund = ft ? analysis.fundById.get(ft.fundId) : undefined;
  const closingNav = fund?.closingNav ?? 0;
  const decimals = analysis.result.portfolio.unitDecimals;
  const hasSynthetic = ft?.lots.some((l) => l.lot.source === 'opening_balance') ?? false;
  return (
    <Drawer open={!!ft} onClose={onClose} title={`Lots · ${fund?.schemeName ?? ''}`}>
      {ft && (
        <>
          <DataTable
            caption={`Lots · ${fund?.schemeName ?? ''}`}
            captionHidden
            rows={ft.lots}
            rowKey={(l, i) => `${l.lot.acquiredOn}:${i}`}
            stickyFirst
            variant="striped"
            focusableRegion
            columns={[
              { key: 'date', header: 'Acquired on', cell: (l) => <span className="whitespace-nowrap">{formatDate(l.lot.acquiredOn)}</span> },
              { key: 'source', header: 'Source', cell: (l) => l.lot.source.replace('_', ' ') },
              { key: 'units', header: 'Units', numeric: true, cell: (l) => formatNumber(l.lot.units, decimals) },
              { key: 'cost', header: 'Cost per unit', numeric: true, cell: (l) => formatNumber(l.lot.costPerUnit, 4) },
              { key: 'nav', header: 'Closing NAV', numeric: true, cell: () => formatNumber(closingNav, 4) },
              { key: 'gain', header: 'Gain', numeric: true, cell: (l) => <Money value={l.gain} variant="gain-loss" /> },
              { key: 'term', header: 'Term', cell: (l) => termBadge(l) },
            ]}
          />
          {hasSynthetic && <p className="mt-3 text-caption text-ink-3">units held before the statement period; holding period unknown; request a since-inception CAS</p>}
        </>
      )}
    </Drawer>
  );
}
