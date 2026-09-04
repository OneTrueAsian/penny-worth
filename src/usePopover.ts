import { useEffect, useRef, useState } from "react";

/** Shared open/close plumbing for a toggle-button + panel popover (the
 * account/member filter dropdowns, "More filters") — before this, all
 * three were the same `useState`/`useRef`/outside-click `useEffect`
 * copy-pasted three times, and none of them closed on Escape even though
 * every real dialog in the app does (`Modal.tsx`'s `ModalShell`) —  a
 * user has no way to tell these are a different component family from the
 * outside, so Escape silently doing nothing here reads as a bug, not a
 * deliberate difference. Closes on an outside click (as before) or
 * Escape (new), and on Escape specifically returns focus to the trigger
 * button — the same "give focus somewhere sane" contract `ModalShell`
 * already honors — since an outside click already moves focus somewhere
 * the user chose on purpose. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return { open, setOpen, rootRef, triggerRef };
}
