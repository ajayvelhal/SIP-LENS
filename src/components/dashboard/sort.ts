// Fund list ordering (US-13): value descending by default, XIRR with dashes last, name ascending. In memory only.
import type { FundView } from '../../hooks/usePortfolio';

export type SortKey = 'value' | 'xirr' | 'name';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'xirr', label: 'XIRR' },
  { value: 'name', label: 'Name' },
];

export function sortFunds(views: FundView[], key: SortKey): FundView[] {
  const copy = [...views];
  if (key === 'name') return copy.sort((a, b) => a.fund.schemeName.localeCompare(b.fund.schemeName, 'en-IN'));
  if (key === 'xirr') {
    return copy.sort((a, b) => {
      const ra = a.xirr.status === 'ok' ? a.xirr.rate : null;
      const rb = b.xirr.status === 'ok' ? b.xirr.rate : null;
      if (ra === null && rb === null) return 0;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return rb - ra;
    });
  }
  return copy.sort((a, b) => (b.fund.closingValue ?? 0) - (a.fund.closingValue ?? 0));
}

export function sortAnnouncement(key: SortKey): string {
  return key === 'name' ? 'Sorted by name, A to Z' : key === 'xirr' ? 'Sorted by XIRR, highest first' : 'Sorted by value, highest first';
}
