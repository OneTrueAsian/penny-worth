import { formatAmount } from "./format";

/** Shared "what makes up this number" breakdown panel — a list of named
 * amounts, largest-magnitude first, shown below whichever clickable stat
 * card triggered it. Used by the Dashboard's KPI cards and the Reports
 * page's account/bucket/income totals. */
export function StatDetailPanel({
  title,
  rows,
  emptyMessage,
  onClose,
}: {
  title: string;
  rows: { name: string; amount: number }[];
  emptyMessage?: string;
  onClose: () => void;
}) {
  return (
    <div className="card stat-detail-panel">
      <div className="card-head">
        <span className="reports-section-title">What makes up {title}</span>
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {rows.length > 0 ? (
        rows
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
