// StepsList (UI design component 28): numbered circles, small text, menu items in body-strong, arrows as "→".
import type { ReactNode } from 'react';

export type Step = ReactNode;

export function StepsList({ steps, className = '' }: { steps: Step[]; className?: string }) {
  return (
    <ol className={`space-y-2 ${className}`}>
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3 text-small text-ink-2">
          <span aria-hidden="true" className="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-caption font-semibold text-ink-2">{i + 1}</span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export const CAMS_STEPS: Step[] = [
  <>Go to <strong className="text-body-strong text-ink-1">camsonline.com</strong> → <strong className="font-semibold text-ink-1">Investor Services</strong> → <strong className="font-semibold text-ink-1">CAS – CAMS+KFintech</strong></>,
  <>Statement type: <strong className="font-semibold text-ink-1">Detailed</strong></>,
  <>Period: <strong className="font-semibold text-ink-1">Since inception</strong></>,
  <>Choose a password you will remember; the PDF arrives by email, usually within an hour</>,
];

export const KFINTECH_STEPS: Step[] = [
  <>Go to <strong className="text-body-strong text-ink-1">mfs.kfintech.com</strong> → <strong className="font-semibold text-ink-1">Investor services</strong> → <strong className="font-semibold text-ink-1">Consolidated account statement</strong></>,
  <>Statement type: <strong className="font-semibold text-ink-1">Detailed</strong></>,
  <>Period: <strong className="font-semibold text-ink-1">Since inception</strong></>,
  <>Choose a password; the PDF arrives by email</>,
];
