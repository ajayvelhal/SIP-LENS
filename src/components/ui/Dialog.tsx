// Tooltip, BottomSheet and Drawer (UI design components 10, 11, 12) over one dialog implementation: portal, scrim,
// focus trap, Escape, focus return, swipe-down on sheets. Tooltip is a popover from 768 px and a sheet below;
// Drawer is a 480 px right panel from 1024 px and a full-height sheet below.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../hooks/useDialog';
import { useIsLg, useIsMd } from '../../hooks/useMediaQuery';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Sticky footer for actions (the cash-flow drawer's "Copy as CSV"). */
  footer?: ReactNode;
  /** false for the automatic first-visit explainer. */
  moveFocus?: boolean;
  /** Tooltip popover anchor. */
  anchorRef?: RefObject<HTMLElement>;
  /** Sheet height: `auto` for explainers, `half`, or `full` for drawers. */
  height?: 'auto' | 'half' | 'full';
  /** Hides the visible title (the explainer sheet has its own h3 in the body). */
  titleHidden?: boolean;
}

function useBodyLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

function Sheet({ open, onClose, title, children, footer, moveFocus, height = 'auto', titleHidden }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const startY = useRef<number | null>(null);
  useDialog(panelRef, open, { onClose, moveFocus, initialFocus: titleRef, closeOnOutside: false });
  useBodyLock(open);
  if (!open) return null;
  const onTouchStart = (e: TouchEvent) => { startY.current = e.touches[0]?.clientY ?? null; };
  const onTouchEnd = (e: TouchEvent) => {
    const end = e.changedTouches[0]?.clientY;
    if (startY.current !== null && end !== undefined && end - startY.current > 80) onClose();
    startY.current = null;
  };
  const h = height === 'full' ? 'h-[100dvh] rounded-none' : height === 'half' ? 'max-h-[60dvh]' : 'max-h-[85dvh]';
  return createPortal(
    <div className="fixed inset-0 z-overlay flex items-end bg-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={`z-drawer flex w-full flex-col rounded-t-lg bg-surface shadow-e-1 outline-none transition-transform duration-base ${h}`}
      >
        <div className="shrink-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-border-strong" />
          <div className={`flex items-center justify-between gap-3 px-4 ${height === 'full' ? 'bg-sunken py-3' : 'pt-2'}`}>
            <h3 id={id} ref={titleRef} tabIndex={-1} className={`text-h3 text-ink-1 outline-none ${titleHidden ? 'sr-only' : ''}`}>{title}</h3>
            <Button variant="ghost" sm onClick={onClose} className="ml-auto">Close</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">{children}</div>
        {footer && <div className="shrink-0 border-t border-border bg-surface px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function Popover({ open, onClose, title, children, moveFocus, anchorRef }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 360 });
  useDialog(panelRef, open, { onClose, moveFocus, initialFocus: titleRef, closeOnOutside: true });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const width = Math.min(360, window.innerWidth - 16);
      const rect = anchorRef?.current?.getBoundingClientRect();
      const top = rect ? rect.bottom + 8 : 80;
      const left = rect ? Math.min(Math.max(8, rect.left - 12), window.innerWidth - width - 8) : (window.innerWidth - width) / 2;
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      tabIndex={-1}
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      className="fixed z-tooltip max-h-[70vh] overflow-y-auto rounded-md border border-border bg-surface p-4 text-body text-ink-2 shadow-e-2 outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={id} ref={titleRef} tabIndex={-1} className="text-h3 text-ink-1 outline-none">{title}</h3>
        <Button variant="ghost" sm onClick={onClose} className="-mr-2 -mt-1">Close</Button>
      </div>
      <div className="mt-2">{children}</div>
    </div>,
    document.body,
  );
}

function SidePanel({ open, onClose, title, children, footer, moveFocus }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useDialog(panelRef, open, { onClose, moveFocus, initialFocus: titleRef, closeOnOutside: false });
  useBodyLock(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-overlay flex justify-end bg-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="z-drawer flex h-full w-[480px] max-w-full flex-col bg-surface shadow-e-1 outline-none transition-transform duration-base">
        <div className="flex shrink-0 items-center justify-between gap-3 bg-sunken px-5 py-3">
          <h3 id={id} ref={titleRef} tabIndex={-1} className="text-h3 text-ink-1 outline-none">{title}</h3>
          <Button variant="ghost" sm onClick={onClose}>Close</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-border bg-surface px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Tooltip: popover at >= 768 px, bottom sheet below. */
export function Tooltip(props: DialogProps) {
  const md = useIsMd();
  return md ? <Popover {...props} /> : <Sheet {...props} height={props.height ?? 'auto'} />;
}

/** Drawer: right panel at >= 1024 px, full-height sheet below. */
export function Drawer(props: DialogProps) {
  const lg = useIsLg();
  return lg ? <SidePanel {...props} /> : <Sheet {...props} height="full" />;
}

export const BottomSheet = Sheet;
