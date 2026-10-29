// DataTable (UI design component 25): generic table for the cash-flow drawer, tax lots, rules and chart fallbacks.
// `small` header in sunken, numeric cells right-aligned in num-md, horizontal scroll with a sticky first column.
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  numeric?: boolean;
  /** Extra classes for header and body cells. */
  className?: string;
  ariaSort?: 'ascending' | 'descending' | 'none';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  caption: string;
  /** Visually hidden caption (for chart twins); visible otherwise. */
  captionHidden?: boolean;
  variant?: 'plain' | 'striped';
  /** No header row (the allocation legend). */
  headless?: boolean;
  stickyFirst?: boolean;
  rowClassName?: (row: T, index: number) => string;
  footer?: ReactNode;
  className?: string;
  /** Mark the scroll region focusable so keyboard users can scroll it (S7 focus order). */
  focusableRegion?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, caption, captionHidden = false, variant = 'plain', headless = false, stickyFirst = false, rowClassName, footer, className = '', focusableRegion = false }: Props<T>) {
  return (
    <div className={`w-full overflow-x-auto rounded-md border border-border bg-surface ${className}`} tabIndex={focusableRegion ? 0 : undefined} role={focusableRegion ? 'region' : undefined} aria-label={focusableRegion ? caption : undefined}>
      <table className="w-full min-w-full border-collapse text-small text-ink-1">
        <caption className={captionHidden ? 'sr-only' : 'px-3 py-2 text-left text-small text-ink-2'}>{caption}</caption>
        {!headless && (
          <thead className="bg-sunken text-left text-small text-ink-2">
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} scope="col" aria-sort={c.ariaSort} className={`whitespace-nowrap px-3 py-2 font-normal ${c.numeric ? 'text-right' : ''} ${stickyFirst && i === 0 ? 'sticky left-0 z-[1] bg-sunken' : ''} ${c.className ?? ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={rowKey(row, ri)} className={`border-t border-border ${variant === 'striped' && ri % 2 === 1 ? 'bg-sunken/0' : ''} ${rowClassName?.(row, ri) ?? ''}`}>
              {columns.map((c, i) => (
                <td key={c.key} className={`px-3 py-2 align-top ${c.numeric ? 'num text-right text-num-md' : ''} ${stickyFirst && i === 0 ? 'sticky left-0 z-[1] bg-surface' : ''} ${c.className ?? ''}`}>
                  {c.cell(row, ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t border-border bg-sunken text-small">{footer}</tfoot>}
      </table>
    </div>
  );
}
