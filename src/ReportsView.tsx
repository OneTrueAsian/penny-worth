import { useState } from "react";
import type { Account, Bucket, Report, Transaction } from "./types";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";

const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

const GROUP_ORDER = ["cash", "credit", "loan", "investment", "other"] as const;
type AccountGroup = (typeof GROUP_ORDER)[number];
const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: "Cash",
  credit: "Credit Cards",
  loan: "Loans",
  investment: "Investments",
  other: "Other Assets",
};

function groupOf(accountType: string): AccountGroup {
  if (accountType === "checking" || accountType === "savings") return "cash";
  if (accountType === "credit") return "credit";
  if (accountType === "loan") return "loan";
  if (accountType === "investment") return "investment";
  return "other";
}

/** A credit account's `starting_balance` is a limit — owed starts at $0,
 * so only the change since then (current_balance - starting_balance)
 * counts. A loan's `starting_balance` is the amount already owed, so the
 * whole thing counts as debt from the start, same as a fresh cash
 * account's balance counts in full — just negative. */
function netWorthContribution(a: Account): number {
  const group = groupOf(a.account_type);
  if (group === "credit") {
    return parseFloat(a.current_balance) - parseFloat(a.starting_balance);
  }
  if (group === "loan") {
    return -parseFloat(a.current_balance);
  }
  return parseFloat(a.current_balance);
}

/** Every stat on this page that can be clicked open to show what makes
 * it up — shared between the top-level stats and AccountsSection's own,
 * so only one breakdown panel is ever open at a time. */
type ReportStatKey = "totalSaved" | "income" | "byTag" | "assets" | "liabilities" | "networth";

const REPORT_STAT_LABELS: Record<ReportStatKey, string> = {
  totalSaved: "Total Saved",
  income: "Income (all-time)",
  byTag: "Spending by Tag",
  assets: "Total Assets",
  liabilities: "Total Liabilities",
  networth: "Net Worth",
};

function AccountRow({
  account: a,
  editing,
  setEditing,
  onSetStartingBalance,
  onUpdateAccountType,
  editingDetails,
  setEditingDetails,
  onSetAccountDetails,
  confirmingDeleteId,
  setConfirmingDeleteId,
  onDeleteAccount,
}: {
  account: Account;
  editing: { id: number; value: string } | null;
  setEditing: (v: { id: number; value: string } | null) => void;
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  editingDetails: { id: number; institution: string; mask: string } | null;
  setEditingDetails: (v: { id: number; institution: string; mask: string } | null) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  confirmingDeleteId: number | null;
  setConfirmingDeleteId: (id: number | null) => void;
  onDeleteAccount: (accountId: number) => void;
}) {
  const group = groupOf(a.account_type);
  const isCredit = group === "credit";
  const isLoan = group === "loan";
  const owed = isLoan
    ? a.current_balance
    : (parseFloat(a.starting_balance) - parseFloat(a.current_balance)).toFixed(2);

  function commitEdit(id: number, value: string) {
    setEditing(null);
    if (!value.trim()) return;
    onSetStartingBalance(id, value.trim());
  }

  function commitDetails(id: number) {
    if (!editingDetails) return;
    onSetAccountDetails(id, editingDetails.institution.trim() || null, editingDetails.mask.trim() || null);
    setEditingDetails(null);
  }

  return (
    <tr>
      <td>
        <div className="account-name-cell">{a.name}</div>
        {editingDetails?.id === a.id ? (
          <div className="account-details-edit">
            <input
              autoFocus
              placeholder="Institution"
              value={editingDetails.institution}
              onChange={(e) => setEditingDetails({ ...editingDetails, institution: e.target.value })}
            />
            <input
              placeholder="1234"
              maxLength={4}
              value={editingDetails.mask}
              onChange={(e) => setEditingDetails({ ...editingDetails, mask: e.target.value })}
            />
            <button type="button" onClick={() => commitDetails(a.id)}>
              Save
            </button>
          </div>
        ) : (
          <span
            className="account-name-detail"
            title="Click to set institution / account number"
            onClick={() => setEditingDetails({ id: a.id, institution: a.institution ?? "", mask: a.mask ?? "" })}
          >
            {a.institution ? `${a.institution}${a.mask ? " •••• " + a.mask : ""}` : "Add institution…"}
          </span>
        )}
      </td>
      <td>
        <select value={a.account_type} onChange={(e) => onUpdateAccountType(a.id, e.target.value)}>
          {ACCOUNT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </td>
      <td className="amount-col">
        {editing?.id === a.id ? (
          <input
            autoFocus
            className="amount-edit-input"
            value={editing.value}
            onChange={(e) => setEditing({ id: a.id, value: e.target.value })}
            onBlur={() => commitEdit(a.id, editing.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit(a.id, editing.value);
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <span
            className="amount-editable"
            title={
              isCredit
                ? "Click to set the credit limit"
                : isLoan
                  ? "Click to set the amount currently owed"
                  : "Click to set the starting balance"
            }
            onClick={() => setEditing({ id: a.id, value: a.starting_balance })}
          >
            {formatAmount(a.starting_balance)}
          </span>
        )}
      </td>
      <td className="source-col">
        {isCredit
          ? `Owed ${formatAmount(owed)} · Available ${formatAmount(a.current_balance)}`
          : isLoan
            ? `Owed ${formatAmount(owed)}`
            : `Balance ${formatAmount(a.current_balance)}`}
      </td>
      <td className="actions-col">
        {confirmingDeleteId === a.id ? (
          <span className="row-delete-confirm">
            <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => onDeleteAccount(a.id)}>
              Delete
            </button>
          </span>
        ) : (
          <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(a.id)}>
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

function AccountsSection({
  accounts,
  onSetStartingBalance,
  onUpdateAccountType,
  onDeleteAccount,
  onSetAccountDetails,
  onAddAccount,
  expandedStat,
  onToggleStat,
}: {
  accounts: Account[];
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  onDeleteAccount: (accountId: number) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  onAddAccount: () => void;
  expandedStat: ReportStatKey | null;
  onToggleStat: (key: ReportStatKey) => void;
}) {
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [editingDetails, setEditingDetails] = useState<{ id: number; institution: string; mask: string } | null>(
    null,
  );

  const assetAccounts = accounts.filter((a) => groupOf(a.account_type) !== "credit" && groupOf(a.account_type) !== "loan");
  const liabilityAccounts = accounts.filter((a) => groupOf(a.account_type) === "credit" || groupOf(a.account_type) === "loan");
  const assets = assetAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const liabilities = liabilityAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const netWorth = assets + liabilities;

  const accountBreakdowns: Record<"assets" | "liabilities" | "networth", { name: string; amount: number }[]> = {
    assets: assetAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    liabilities: liabilityAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    networth: accounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
  };

  const rowProps = {
    editing,
    setEditing,
    onSetStartingBalance,
    onUpdateAccountType,
    editingDetails,
    setEditingDetails,
    onSetAccountDetails,
    confirmingDeleteId,
    setConfirmingDeleteId,
    onDeleteAccount,
  };

  return (
    <>
      <div className="reports-section-head">
        <h2 className="reports-section-title">Accounts</h2>
        <button type="button" onClick={onAddAccount}>
          Add account…
        </button>
      </div>

      <div className="stats">
        <button
          type="button"
          className={expandedStat === "assets" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => onToggleStat("assets")}
        >
          <span className="stat-value">{formatAmount(assets)}</span>
          <span className="stat-label">Total Assets</span>
        </button>
        <button
          type="button"
          className={expandedStat === "liabilities" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => onToggleStat("liabilities")}
        >
          <span className="stat-value">{formatAmount(liabilities)}</span>
          <span className="stat-label">Total Liabilities</span>
        </button>
        <button
          type="button"
          className={expandedStat === "networth" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => onToggleStat("networth")}
        >
          <span className="stat-value">{formatAmount(netWorth)}</span>
          <span className="stat-label">Net Worth</span>
        </button>
      </div>

      {expandedStat && expandedStat in accountBreakdowns && (
        <StatDetailPanel
          title={REPORT_STAT_LABELS[expandedStat]}
          rows={accountBreakdowns[expandedStat as "assets" | "liabilities" | "networth"]}
          emptyMessage="No accounts contribute to this yet."
          onClose={() => onToggleStat(expandedStat)}
        />
      )}

      {GROUP_ORDER.map((group) => {
        const groupAccounts = accounts.filter((a) => groupOf(a.account_type) === group);
        if (groupAccounts.length === 0) return null;
        const subtotal = groupAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
        return (
          <div key={group}>
            <h2 className="reports-section-title">
              {GROUP_LABELS[group]} <span className="account-col">{formatAmount(subtotal)}</span>
            </h2>
            <table className="ledger accounts-table">
              <colgroup>
                <col style={{ width: "30%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "30%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="amount-col">{"Balance / limit"}</th>
                  <th>Details</th>
                  <th className="actions-col"></th>
                </tr>
              </thead>
              <tbody>
                {groupAccounts.map((a) => (
                  <AccountRow key={a.id} account={a} {...rowProps} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {accounts.length === 0 && <p className="empty-state">No accounts yet.</p>}
    </>
  );
}

export function ReportsView({
  report,
  accounts,
  buckets,
  transactions,
  onSetStartingBalance,
  onUpdateAccountType,
  onDeleteAccount,
  onSetAccountDetails,
  onAddAccount,
  onExportCsv,
  onPrint,
  onDownloadSetupTemplate,
  onImportSetupData,
}: {
  report: Report | null;
  accounts: Account[];
  buckets: Bucket[];
  transactions: Transaction[];
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  onDeleteAccount: (accountId: number) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  onAddAccount: () => void;
  onExportCsv: () => void;
  onPrint: () => void;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
}) {
  const [expandedStat, setExpandedStat] = useState<ReportStatKey | null>(null);

  function toggleStat(key: ReportStatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  if (!report) {
    return <p className="empty-state">Loading report…</p>;
  }

  const totalSavedBreakdown = buckets.map((b) => ({ name: b.name, amount: parseFloat(b.saved_amount) }));

  const incomeByAccount = new Map<string, number>();
  for (const t of transactions) {
    if (t.category !== "Income") continue;
    incomeByAccount.set(t.account_name, (incomeByAccount.get(t.account_name) ?? 0) + parseFloat(t.amount));
  }
  const incomeBreakdown = Array.from(incomeByAccount, ([name, amount]) => ({ name, amount }));

  // All-time spending grouped by tag (freeform, set from the Ledger) —
  // only outflows count, same "spent" convention as everywhere else spend
  // is summed. A transaction with more than one tag counts under each.
  const tagTotals = new Map<string, number>();
  for (const t of transactions) {
    const amount = parseFloat(t.amount);
    if (amount >= 0) continue;
    for (const tag of t.tags) {
      tagTotals.set(tag, (tagTotals.get(tag) ?? 0) + Math.abs(amount));
    }
  }
  const tagBreakdown = Array.from(tagTotals, ([name, amount]) => ({ name, amount }));

  const topLevelBreakdowns: Record<"totalSaved" | "income" | "byTag", { name: string; amount: number }[]> = {
    totalSaved: totalSavedBreakdown,
    income: incomeBreakdown,
    byTag: tagBreakdown,
  };

  return (
    <div className="reports-view">
      <div className="reports-toolbar no-print">
        <button type="button" className="modal-secondary" onClick={onDownloadSetupTemplate}>
          Download setup template…
        </button>
        <button type="button" className="modal-secondary" onClick={onImportSetupData}>
          Import setup data…
        </button>
        <button type="button" className="modal-secondary" onClick={onExportCsv}>
          Export CSV…
        </button>
        <button type="button" className="modal-secondary" onClick={onPrint}>
          Print / Save as PDF…
        </button>
      </div>

      <div className="stats">
        <button
          type="button"
          className={expandedStat === "totalSaved" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("totalSaved")}
        >
          <span className="stat-value">{formatAmount(report.total_saved)}</span>
          <span className="stat-label">Total saved (all buckets)</span>
        </button>
        <button
          type="button"
          className={expandedStat === "income" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("income")}
        >
          <span className="stat-value">{formatAmount(report.income_total)}</span>
          <span className="stat-label">Income (all-time)</span>
        </button>
        <button
          type="button"
          className={expandedStat === "byTag" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("byTag")}
        >
          <span className="stat-value">{tagBreakdown.length}</span>
          <span className="stat-label">Tags in use</span>
        </button>
      </div>

      {expandedStat && expandedStat in topLevelBreakdowns && (
        <StatDetailPanel
          title={REPORT_STAT_LABELS[expandedStat]}
          rows={topLevelBreakdowns[expandedStat as "totalSaved" | "income" | "byTag"]}
          emptyMessage={
            expandedStat === "totalSaved"
              ? "No savings buckets yet."
              : expandedStat === "income"
                ? "No income recorded yet."
                : "No tags used yet — add some from the Ledger."
          }
          onClose={() => toggleStat(expandedStat)}
        />
      )}

      <AccountsSection
        accounts={accounts}
        onSetStartingBalance={onSetStartingBalance}
        onUpdateAccountType={onUpdateAccountType}
        onDeleteAccount={onDeleteAccount}
        onSetAccountDetails={onSetAccountDetails}
        onAddAccount={onAddAccount}
        expandedStat={expandedStat}
        onToggleStat={toggleStat}
      />

      <h2 className="reports-section-title">{report.month_label}'s budget</h2>
      <table className="ledger">
        <thead>
          <tr>
            <th>Category</th>
            <th className="amount-col">Budgeted</th>
            <th className="amount-col">Actual</th>
            <th className="amount-col">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {report.budget_actuals.map((line) => {
            const remaining =
              line.budget_group === "income"
                ? parseFloat(line.actual) - parseFloat(line.budgeted)
                : parseFloat(line.budgeted) - parseFloat(line.actual);
            return (
              <tr key={line.category}>
                <td>{line.category}</td>
                <td className="amount-col">{formatAmount(line.budgeted)}</td>
                <td className="amount-col">{formatAmount(line.actual)}</td>
                <td className={remaining < 0 ? "amount-col report-over-budget" : "amount-col"}>
                  {formatAmount(remaining.toFixed(2))}
                </td>
              </tr>
            );
          })}
          {report.budget_actuals.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-state">
                No budget lines yet — add one in the Budget tab.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
