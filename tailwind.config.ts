import type { Config } from 'tailwindcss';

// Every value here is a token from docs/features/sip-lens-v1/03-ui-design.md §1. Colours resolve to CSS custom
// properties defined in src/index.css so the light and dark values live in one place and charts repaint on a theme switch.
const colorTokens = [
  'page', 'surface', 'sunken', 'info-bg', 'caution-bg', 'gain-bg', 'loss-bg',
  'ink-1', 'ink-2', 'ink-3', 'accent', 'accent-ink', 'accent-track', 'gain', 'loss', 'caution',
  'border', 'border-strong', 'overlay',
  'chart-equity', 'chart-hybrid', 'chart-debt', 'chart-other', 'chart-unclassified', 'chart-benchmark', 'chart-grid',
] as const;

const colors = Object.fromEntries(colorTokens.map((t) => [t, `var(--color-${t})`]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: { transparent: 'transparent', current: 'currentColor', ...colors },
    fontFamily: {
      sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Noto Sans"', 'sans-serif'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
    fontSize: {
      display: ['40px', { lineHeight: '44px', fontWeight: '600' }],
      'display-sm': ['32px', { lineHeight: '36px', fontWeight: '600' }],
      h1: ['28px', { lineHeight: '34px', fontWeight: '600' }],
      'h1-sm': ['24px', { lineHeight: '30px', fontWeight: '600' }],
      h2: ['22px', { lineHeight: '28px', fontWeight: '600' }],
      h3: ['18px', { lineHeight: '24px', fontWeight: '600' }],
      body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
      'body-strong': ['16px', { lineHeight: '24px', fontWeight: '600' }],
      small: ['14px', { lineHeight: '20px', fontWeight: '400' }],
      caption: ['12px', { lineHeight: '16px', fontWeight: '400' }],
      'num-xl': ['32px', { lineHeight: '36px', fontWeight: '600' }],
      'num-lg': ['22px', { lineHeight: '28px', fontWeight: '600' }],
      'num-md': ['16px', { lineHeight: '24px', fontWeight: '500' }],
      'num-sm': ['14px', { lineHeight: '20px', fontWeight: '500' }],
      mono: ['13px', { lineHeight: '20px', fontWeight: '400' }],
    },
    borderRadius: { none: '0', sm: '6px', md: '10px', lg: '16px', full: '9999px' },
    boxShadow: {
      none: 'none',
      'e-1': 'var(--shadow-e-1)',
      'e-2': 'var(--shadow-e-2)',
    },
    screens: { md: '768px', lg: '1024px' },
    zIndex: { banner: '10', sticky: '20', overlay: '30', drawer: '40', tooltip: '50' },
    transitionDuration: { fast: '120ms', base: '200ms', ring: '600ms' },
    extend: {
      maxWidth: { content: '1120px', prose: '68ch' },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
      spacing: { tap: '44px' },
    },
  },
  plugins: [],
} satisfies Config;
