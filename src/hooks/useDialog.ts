// src/hooks/useDialog.ts
// Shared dialog behaviour for Tooltip, BottomSheet and Drawer (UI design components 10-12, §8.6): Escape closes,
// focus is trapped inside, moved to the title on open (unless the open was automatic) and returned to the opener on close.

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogOptions {
  onClose: () => void;
  /** Element to focus on open (defaults to the first focusable, then the panel). */
  initialFocus?: RefObject<HTMLElement>;
  /** false for the automatic first-visit explainer: the user did not ask for it, so focus stays where it was. */
  moveFocus?: boolean;
  /** Close when a pointer event lands outside the panel. */
  closeOnOutside?: boolean;
}

export function useDialog(panelRef: RefObject<HTMLElement>, open: boolean, opts: DialogOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    const { initialFocus, moveFocus = true } = optsRef.current;

    if (moveFocus) {
      const target = initialFocus?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); optsRef.current.onClose(); return; }
      if (e.key !== 'Tab') return;
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (nodes.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = nodes[0] as HTMLElement;
      const last = nodes[nodes.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (!panel.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    const onPointer = (e: PointerEvent) => {
      if (optsRef.current.closeOnOutside === false) return;
      if (!panel.contains(e.target as Node)) optsRef.current.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}
