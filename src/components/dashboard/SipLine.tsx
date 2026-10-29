// The card / table SIP line with its "How we detected this" InfoButton (UI design §4.5.6).
import type { DetectedSip } from '../../engine';
import { InfoButton } from '../ui/InfoButton';
import { sipLineText } from './fundHelpers';

export function SipLine({ sips, onDetail, className = '' }: { sips: DetectedSip[]; onDetail: (sip: DetectedSip) => void; className?: string }) {
  if (sips.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {sips.map((sip) => (
        <div key={`${sip.folioNumber}:${sip.firstDate}`} className="flex items-center gap-1 text-small text-ink-2">
          <span>{sipLineText(sip)}</span>
          <InfoButton label="How we detected this" expanded={false} onClick={() => onDetail(sip)} className="-my-3" />
        </div>
      ))}
    </div>
  );
}
