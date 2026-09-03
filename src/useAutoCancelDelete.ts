import { useEffect } from "react";

/** Auto-cancels a two-step delete confirmation a few seconds after it's
 * shown (used alongside a `confirmingDeleteId`/`confirmingBulkDelete`-style
 * state across every row-delete UI in the app), so a confirm left open from
 * an earlier click can't be completed by an unrelated later click landing
 * near the same spot. `confirming` is whatever falsy/truthy value already
 * represents "not confirming" for that state (`null`, `false`, ...). */
export function useAutoCancelDelete(confirming: unknown, cancel: () => void, ms = 4000) {
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(cancel, ms);
    return () => clearTimeout(timer);
  }, [confirming]);
}
