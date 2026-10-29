// S6 XIRR explainer (UI design §4.6) and the other two explainers' copy, rendered inside a Tooltip.
import type { RefObject } from 'react';
import { Tooltip } from '../ui/Dialog';
import { LinkButton } from '../ui/Link';

interface XirrProps {
  open: boolean;
  onClose: () => void;
  statementDate: string;
  anchorRef: RefObject<HTMLElement>;
  moveFocus: boolean;
  onSeeCashflows: () => void;
}

export function XirrExplainer({ open, onClose, statementDate, anchorRef, moveFocus, onSeeCashflows }: XirrProps) {
  return (
    <Tooltip open={open} onClose={onClose} title="What XIRR means" anchorRef={anchorRef} moveFocus={moveFocus}>
      <p className="text-body text-ink-2">XIRR is the yearly rate that makes all your investments, with their dates, grow to today's value; here that is the value as of {statementDate}.</p>
      <p className="mt-2 text-body text-ink-2">The "absolute return" your app shows compares what you put in with what it is worth, ignoring when each rupee went in, so money invested last month counts the same as money invested five years ago. XIRR gives every rupee credit only for the time it was actually invested.</p>
      <LinkButton onClick={onSeeCashflows} className="mt-2">See the cash flows we used</LinkButton>
    </Tooltip>
  );
}

export function DisciplineExplainer({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement> }) {
  return (
    <Tooltip open={open} onClose={onClose} title="What the discipline score means" anchorRef={anchorRef}>
      <p className="text-body text-ink-2">It is how consistently you kept your SIPs going: 100 × instalments made ÷ instalments expected, weighted by the instalment amount. Expected dates run from your first instalment to the statement date, with 7 days of grace. A SIP silent for more than two periods counts as stopped, not missed. Funds without a regular SIP don't affect the score. It says nothing about how good the funds are.</p>
    </Tooltip>
  );
}

export function ComparisonExplainer({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement> }) {
  return (
    <Tooltip open={open} onClose={onClose} title="How the comparison works" anchorRef={anchorRef}>
      <p className="text-body text-ink-2">We take every rupee you invested, on the day you invested it, and buy units of the index fund at that day's NAV instead. When you redeemed or switched out, the shadow sells the same fraction of its units. On the statement date we compare what each path is worth plus what each paid out. It is a description of the past using published NAVs; it is not a forecast and it is not advice.</p>
    </Tooltip>
  );
}
