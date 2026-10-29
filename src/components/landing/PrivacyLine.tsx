// PrivacyLine (UI design component 5).
import { ROUTES } from '../../lib/links';
import { Glyph } from '../ui/Glyph';
import { Link } from '../ui/Link';

export function PrivacyLine({ id, className = '' }: { id?: string; className?: string }) {
  return (
    <p id={id} className={`flex items-start gap-2 text-small text-ink-2 ${className}`}>
      <Glyph name="lock" size={16} className="mt-0.5 text-ink-3" />
      <span>
        Parsed in your browser. Nothing is uploaded, nothing is stored.{' '}
        <Link href={ROUTES.privacy}>How we keep your data on your device</Link>
      </span>
    </p>
  );
}
