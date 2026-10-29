// Footer (UI design component 34): "Open source · MIT · GitHub", Privacy, ThemeSwitch, version.
import { useTheme, type ThemeChoice } from '../../hooks/useTheme';
import { LINKS, ROUTES } from '../../lib/links';
import { Link } from './Link';
import { SegmentedControl } from './SegmentedControl';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Footer() {
  const [theme, setTheme] = useTheme();
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-caption text-ink-3 md:px-6 lg:px-8">
        <span>
          Open source · MIT · <Link variant="external" href={LINKS.repo} className="text-caption">GitHub</Link>
        </span>
        <Link variant="standalone" href={ROUTES.privacy} className="text-caption">Privacy</Link>
        <SegmentedControl label="Theme" options={THEMES} value={theme} onChange={setTheme} sm className="ml-auto" />
        <span>v{__APP_VERSION__}</span>
      </div>
    </footer>
  );
}
