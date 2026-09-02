import { useState } from "react";
import type { Account, FamilyMember } from "./types";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";
import { GROUP_LABELS, GROUP_ORDER, groupOf, netWorthContribution } from "./accountGroups";

const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

/** Every stat on this page that can be clicked open to show what makes it
 * up — its own state, independent of ReportsView's `ReportStatKey`, so
 * expanding one doesn't affect the other now that they're separate pages. */
type AccountStatKey = "assets" | "liabilities" | "networth";

const ACCOUNT_STAT_LABELS: Record<AccountStatKey, string> = {
  assets: "Total Assets",
  liabilities: "Total Liabilities",
  networth: "Net Worth",
};

/** A small glyph per account group, next to each card's name — purely
 * decorative, matching the mockup's `.type-badge` (a colored circle with
 * an icon isn't worth a whole icon library entry for four groups). */
const GROUP_GLYPH: Record<string, string> = {
  cash: "$",
  credit: "%",
  loan: "%",
  investment: "↗",
  other: "•",
};

function AccountCard({
  account: a,
  editing,
  setEditing,
  onSetStartingBalance,
  onUpdateAccountType,
  editingDetails,
  setEditingDetails,
  onSetAccountDetails,
  familyMembers,
  onSetAccountMember,
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
  familyMembers: FamilyMember[];
  onSetAccountMember: (accountId: number, memberId: number | null) => void;
  confirmingDeleteId: number | null;
  setConfirmingDeleteId: (id: number | null) => void;
  onDeleteAccount: (accountId: number) => void;
}) {
  const group = groupOf(a.account_type);
  const isCredit = group === "credit";
  const isLoan = group === "loan";
  const isLiability = isCredit || isLoan;
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
    <div className="account-card">
      <span className={isLiability ? "type-badge type-badge-neg" : "type-badge"}>{GROUP_GLYPH[group]}</span>
      <div className="info">
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
            className="sub account-name-detail"
            title="Click to set institution / account number"
            onClick={() => setEditingDetails({ id: a.id, institution: a.institution ?? "", mask: a.mask ?? "" })}
          >
            {a.institution ? `${a.institution}${a.mask ? " •••• " + a.mask : ""}` : "Add institution…"}
          </span>
        )}
        <div className="account-card-row">
          <select value={a.account_type} onChange={(e) => onUpdateAccountType(a.id, e.target.value)}>
            {ACCOUNT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
          <select
            className="member-select"
            value={a.member_id ?? ""}
            onChange={(e) => onSetAccountMember(a.id, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Unassigned</option>
            {familyMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="account-card-end">
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
            className={isLiability ? "bal neg amount-editable" : "bal amount-editable"}
            title={
              isCredit
                ? "Click to set the credit limit"
                : isLoan
                  ? "Click to set the amount currently owed"
                  : "Click to set the starting balance"
            }
            onClick={() => setEditing({ id: a.id, value: a.starting_balance })}
          >
            {isCredit
              ? `Owed ${formatAmount(owed)}`
              : isLoan
                ? `Owed ${formatAmount(owed)}`
                : formatAmount(a.current_balance)}
          </span>
        )}
        {isCredit && <span className="sub">Available {formatAmount(a.current_balance)}</span>}
        {confirmingDeleteId === a.id ? (
          <span className="row-delete-confirm">
            <button type="button" className="modal-secondary btn-sm" onClick={() => setConfirmingDeleteId(null)}>
              Cancel
            </button>
            <button type="button" className="btn-sm" onClick={() => onDeleteAccount(a.id)}>
              Delete
            </button>
          </span>
        ) : (
          <button type="button" className="modal-secondary btn-sm" onClick={() => setConfirmingDeleteId(a.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function AccountsView({
  accounts,
  manualAssetsTotal,
  onSetStartingBalance,
  onUpdateAccountType,
  onDeleteAccount,
  onSetAccountDetails,
  familyMembers,
  onSetAccountMember,
  onAddAccount,
}: {
  accounts: Account[];
  /** Sum of manually-tracked assets (Property & Valuables, from Reports) —
   * folded into the Total Assets / Net Worth stats here alongside real
   * accounts, same as before the two pages split apart. */
  manualAssetsTotal: number;
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  onDeleteAccount: (accountId: number) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  familyMembers: FamilyMember[];
  onSetAccountMember: (accountId: number, memberId: number | null) => void;
  onAddAccount: () => void;
}) {
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [editingDetails, setEditingDetails] = useState<{ id: number; institution: string; mask: string } | null>(
    null,
  );
  const [expandedStat, setExpandedStat] = useState<AccountStatKey | null>(null);

  function toggleStat(key: AccountStatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  const assetAccounts = accounts.filter((a) => groupOf(a.account_type) !== "credit" && groupOf(a.account_type) !== "loan");
  const liabilityAccounts = accounts.filter((a) => groupOf(a.account_type) === "credit" || groupOf(a.account_type) === "loan");
  const assetsTotal = assetAccounts.reduce((s, a) => s + netWorthContribution(a), 0) + manualAssetsTotal;
  const liabilities = liabilityAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const netWorth = assetsTotal + liabilities;

  const manualAssetsRow = manualAssetsTotal !== 0 ? [{ name: "Property & Valuables", amount: manualAssetsTotal }] : [];
  const accountBreakdowns: Record<AccountStatKey, { name: string; amount: number }[]> = {
    assets: [...assetAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })), ...manualAssetsRow],
    liabilities: liabilityAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    networth: [...accounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })), ...manualAssetsRow],
  };

  const rowProps = {
    editing,
    setEditing,
    onSetStartingBalance,
    onUpdateAccountType,
    editingDetails,
    setEditingDetails,
    onSetAccountDetails,
    familyMembers,
    onSetAccountMember,
    confirmingDeleteId,
    setConfirmingDeleteId,
    onDeleteAccount,
  };

  return (
    <div className="reports-view">
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
          onClick={() => toggleStat("assets")}
        >
          <span className="stat-value">{formatAmount(assetsTotal)}</span>
          <span className="stat-label">Total Assets</span>
        </button>
        <button
          type="button"
          className={expandedStat === "liabilities" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("liabilities")}
        >
          <span className="stat-value">{formatAmount(liabilities)}</span>
          <span className="stat-label">Total Liabilities</span>
        </button>
        <button
          type="button"
          className={expandedStat === "networth" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("networth")}
        >
          <span className="stat-value">{formatAmount(netWorth)}</span>
          <span className="stat-label">Net Worth</span>
        </button>
      </div>

      {expandedStat && (
        <StatDetailPanel
          title={ACCOUNT_STAT_LABELS[expandedStat]}
          rows={accountBreakdowns[expandedStat]}
          emptyMessage="No accounts contribute to this yet."
          onClose={() => toggleStat(expandedStat)}
        />
      )}

      {GROUP_ORDER.map((group) => {
        const groupAccounts = accounts.filter((a) => groupOf(a.account_type) === group);
        if (groupAccounts.length === 0) return null;
        const subtotal = groupAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
        return (
          <div key={group}>
            <h2 className="account-group-title">
              {GROUP_LABELS[group]} <span className="account-col">{formatAmount(subtotal)}</span>
            </h2>
            <div className="account-cards">
              {groupAccounts.map((a) => (
                <AccountCard key={a.id} account={a} {...rowProps} />
              ))}
            </div>
          </div>
        );
      })}
      {accounts.length === 0 && <p className="empty-state">No accounts yet.</p>}
    </div>
  );
}
