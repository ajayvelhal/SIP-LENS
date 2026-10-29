// src/lib/announce.ts
// Tiny bus behind the LiveRegion component (design component 32): any component can announce without prop drilling.
// Holds nothing but the last message strings.

export type Politeness = 'polite' | 'assertive';
export interface Announcement { polite: string; assertive: string; seq: number }

let state: Announcement = { polite: '', assertive: '', seq: 0 };
const listeners = new Set<() => void>();

export function announce(text: string, politeness: Politeness = 'polite'): void {
  state = { ...state, [politeness]: text, seq: state.seq + 1 };
  for (const l of [...listeners]) l();
}

export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAnnouncement(): Announcement {
  return state;
}
