// src/data/categories.ts
// Typed lazy loader for the ISIN -> category map (design §5.2, data design D3): expands the grouped encoding into a
// Map once and exposes a pure categoryOf(isin) lookup. schemaVersion mismatch -> dataset absent (V-7).

import type { CategoryInfo } from '../calculations/tax';
import type { IsinCategoryFile } from './types';

export type CategoryLookup = (isin: string | undefined) => CategoryInfo | undefined;

export function isIsinCategoryFile(v: unknown): v is IsinCategoryFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<IsinCategoryFile>;
  return f.schemaVersion === 1 && Array.isArray(f.groups) && Array.isArray(f.categories) && Array.isArray(f.taxClasses) && Array.isArray(f.subCategories);
}

export function makeCategoryLookup(file: IsinCategoryFile): CategoryLookup {
  const map = new Map<string, CategoryInfo>();
  for (const g of file.groups) {
    const [ci, si, ti, elss] = g.t;
    const category = file.categories[ci];
    const taxClass = file.taxClasses[ti];
    const subCategory = file.subCategories[si] ?? '';
    if (!category || !taxClass) continue;
    const info: CategoryInfo = { category, subCategory, taxClass, isElss: elss === 1 };
    for (const isin of g.isins) map.set(isin, info);
  }
  return (isin) => (isin ? map.get(isin.toUpperCase()) : undefined);
}

/** Lazy import of the bundled JSON (own chunk). Resolves to a lookup that classifies nothing when the file is unreadable. */
export async function loadCategories(): Promise<{ categoryOf: CategoryLookup; file: IsinCategoryFile | null }> {
  const mod = (await import('./isinCategory.json')) as { default?: unknown };
  const file = mod.default ?? mod;
  if (!isIsinCategoryFile(file)) return { categoryOf: () => undefined, file: null };
  return { categoryOf: makeCategoryLookup(file), file };
}
