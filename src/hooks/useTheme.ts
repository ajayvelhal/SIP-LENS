// src/hooks/useTheme.ts
// Theme preference (UI design §1.2): sets data-theme on <html>; `sip-lens.theme` is the ONLY value this app ever
// stores (US-19, US-21). Reads and writes are wrapped because storage can be absent or blocked; the app then just follows
// prefers-color-scheme.

import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'sip-lens.theme';
const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return CHOICES.includes(v as ThemeChoice) ? (v as ThemeChoice) : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Called once from main.tsx before the first render so there is no flash of the wrong theme. */
export function applyStoredTheme(): void {
  apply(readStored());
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);

  useEffect(() => { apply(choice); }, [choice]);

  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Storage unavailable: the choice still applies for this page view.
    }
  }, []);

  return [choice, set];
}
