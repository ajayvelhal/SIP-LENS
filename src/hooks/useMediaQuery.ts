// src/hooks/useMediaQuery.ts
// Breakpoint and motion queries (UI design §1.4): Tooltip vs BottomSheet at 768 px, right Drawer vs sheet at 1024 px,
// and prefers-reduced-motion for chart animation.

import { useSyncExternalStore } from 'react';

type Subscribe = (onChange: () => void) => () => void;
const subscribers = new Map<string, Subscribe>();

function subscribeFor(query: string): Subscribe {
  let s = subscribers.get(query);
  if (!s) {
    s = (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    };
    subscribers.set(query, s);
  }
  return s;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscribeFor(query), () => window.matchMedia(query).matches, () => false);
}

export const useIsMd = (): boolean => useMediaQuery('(min-width: 768px)');
export const useIsLg = (): boolean => useMediaQuery('(min-width: 1024px)');
export const useReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)');
