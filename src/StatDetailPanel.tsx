import { useRef } from "react";
import { formatAmount } from "./format";
import { useDelayedVisibility } from "./useDelayedVisibility";

/** Shared "what makes up this number" breakdown panel — a list of named
 * amounts, largest-magnitude first, shown below whichever clickable stat
 * card triggered it. Used by the Dashboard's KPI cards and the Reports/
 * Accounts pages' own stat totals.
 *
 * Always mounted by its caller (not `{expandedStat && <StatDetailPanel/>}`)
 * so it can play a real close transition instead of vanishing the instant
 * `isOpen` flips false — `title`/`rows` go `null` on close, but the panel
 * keeps rendering its *last* content through the closing animation rather
 * than going blank first. */
export function StatDetailPanel({
  title,
  rows,
  emptyMessage,
  isOpen,
  onClose,
}: {
  title: string | null;
  rows: { name: string; amount: number }[] | null;
  emptyMessage?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { shouldRender, closing } = useDelayedVisibility(isOpen);
  const lastContent = useRef<{ title: string; rows: { name: string; amount: number }[] } | null>(null);
  if (title !== null && rows !== null) {
    lastContent.current = { title, rows };
  }

  if (!shouldRender || !lastContent.current) return null;
  const { title: shownTitle, rows: shownRows } = lastContent.current;

  return (
    <div className={closing ? "card stat-detail-panel stat-detail-panel-closing" : "card stat-detail-panel"}>
      <div className="card-head">
        <span className="reports-section-title">What makes up {shownTitle}</span>
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {shownRows.length > 0 ? (
        shownRows
          .slice()
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
          .map((row) => (
            <div
              key={row.name}
              style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px" }}
            >
              <span>{row.name}</span>
              <span className={row.amount < 0 ? "amount-col report-over-budget" : "amount-col"}>
                {formatAmount(row.amount)}
              </span>
            </div>
          ))
      ) : (
        <p className="empty-state">{emptyMessage ?? "Nothing contributes to this yet."}</p>
      )}
    </div>
  );
}
