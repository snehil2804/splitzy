"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Shared a11y behavior for every sheet/modal in the app: ESC-to-close,
 * body-scroll lock, focus moved into the dialog on open and restored to
 * whatever triggered it on close, and Tab kept inside the dialog while
 * it's open. Scroll-lock is reference-counted and ESC/Tab only act on the
 * topmost dialog, so this stays correct when one dialog opens another
 * (e.g. a delete confirmation opened from within the expense detail sheet).
 */

let lockCount = 0;
function lockScroll() {
  if (lockCount === 0) document.body.style.overflow = "hidden";
  lockCount++;
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = "";
}

let openStack: symbol[] = [];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [id] = useState(() => Symbol("dialog"));

  // Keeps the ESC handler below reading the latest `onClose` without
  // re-running the open/close setup effect on every parent re-render.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    openStack.push(id);
    triggerRef.current = document.activeElement as HTMLElement | null;
    lockScroll();

    const container = containerRef.current;
    const focusables = () =>
      container
        ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (el) => el.offsetParent !== null,
          )
        : [];

    // Don't steal focus if something inside the dialog already has it (e.g.
    // an `autoFocus` search input placed it there before this effect runs).
    // A `data-autofocus` element (e.g. the safe/non-destructive action in a
    // confirmation dialog) wins over plain DOM-order "first focusable".
    if (!container?.contains(document.activeElement)) {
      const preferred = container?.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? focusables()[0] ?? container)?.focus();
    }

    function onKey(e: KeyboardEvent) {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openStack = openStack.filter((x) => x !== id);
      unlockScroll();
      triggerRef.current?.focus?.();
    };
  }, [open, id]);

  return containerRef;
}
