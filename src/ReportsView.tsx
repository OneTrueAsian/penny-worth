import { FormEvent, useState } from "react";
import type { Account, Asset, Bucket, DebtPayoffPlan, FamilyMember, Report, Transaction } from "./types";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";
import { GROUP_LABELS, GROUP_ORDER, groupOf } from "./accountGroups";

const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

const ASSET_TYPE_OPTIONS = ["real_estate", "vehicle", "other"];
const ASSET_TYPE_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  vehicle: "Vehicle",
  other: "Other",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewAssetForm({
  familyMembers,
  onCreate,
}: {
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState(ASSET_TYPE_OPTIONS[0]);
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [memberId, setMemberId] = useState("");
  const [open, setOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !value.trim()) return;
    onCreate(name.trim(), assetType, value.trim(), todayIso(), notes.trim() || null, memberId ? Number(memberId) : null);
    setName("");
    setValue("");
    setNotes("");
    setMemberId("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}>Add property or valuable…</button>
    );
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Home"' />
      <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
        {ASSET_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {ASSET_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Current value" />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      {familyMembers.length > 0 && (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Unassigned</option>
          {familyMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <button type="submit" disabled={!name.trim() || !value.trim()}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function PropertyAssetsSection({
  assets,
  familyMembers,
  onCreate,
  onUpdateValue,
  onSetMember,
  onDelete,
}: {
  assets: Asset[];
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
  onUpdateValue: (id: number, value: string, valuedOn: string) => void;
  onSetMember: (id: number, memberId: number | null) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const total = assets.reduce((s, a) => s + parseFloat(a.value), 0);

  function commitEdit(id: number, value: string) {
    setEditing(null);
    if (!value.trim()) return;
    onUpdateValue(id, value.trim(), todayIso());
  }

  return (
    <div>
      <h2 className="reports-section-title">
        Property &amp; Valuables <span className="account-col">{formatAmount(total)}</span>
      </h2>
      <table className="ledger">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="amount-col">Value</th>
            <th>Member</th>
            <th>Updated</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>
                <div className="account-name-cell">{a.name}</div>
                {a.notes && <span className="account-col">{a.notes}</span>}
              </td>
              <td>{ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}</td>
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
                    title="Click to update the value"
                    onClick={() => setEditing({ id: a.id, value: a.value })}
                  >
                    {formatAmount(a.value)}
                  </span>
                )}
              </td>
              <td className="member-col">
                <select
                  value={a.member_id ?? ""}
                  onChange={(e) => onSetMember(a.id, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {familyMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>{a.valued_on}</td>
              <td className="actions-col">
                {confirmingDeleteId === a.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" onClick={() => onDelete(a.id)}>
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
          ))}
          {assets.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state">
                No property or valuables tracked yet.
              </td>
            </tr>
          )}
          <tr>
            <td colSpan={6}>
              <NewAssetForm familyMembers={familyMembers} onCreate={onCreate} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
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
type ReportStatKey = "totalSaved" | "income" | "byTag" | "byMember" | "assets" | "liabilities" | "networth";

const REPORT_STAT_LABELS: Record<ReportStatKey, string> = {
  totalSaved: "Total Saved",
  income: "Income (all-time)",
  byTag: "Spending by Tag",
  byMember: "Spending by Member",
  assets: "Total Assets",
  liabilities: "Total Liabilities",
  networth: "Net Worth",
};

/** How much is actually owed on a debt account — the positive counterpart
 * to `netWorthContribution`'s (negative) debt contribution. Matches
 * `AccountRow`'s own `owed` calculation. */
function owedAmount(a: Account): number {
  const group = groupOf(a.account_type);
  if (group === "loan") return parseFloat(a.current_balance);
  return parseFloat(a.starting_balance) - parseFloat(a.current_balance);
}

const DEBT_STRATEGY_OPTIONS: { value: string; label: string }[] = [
  { value: "snowball", label: "Snowball (smallest balance first)" },
  { value: "avalanche", label: "Avalanche (highest rate first)" },
];

export function DebtPayoffPlannerSection({
  accounts,
  onSetAccountInterestRate,
  onCalculateDebtPayoff,
  onSetAccountExcludedFromDebtPayoff,
}: {
  accounts: Account[];
  onSetAccountInterestRate: (accountId: number, rate: string | null) => void;
  onCalculateDebtPayoff: (
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ) => Promise<DebtPayoffPlan | null>;
  onSetAccountExcludedFromDebtPayoff: (accountId: number, excluded: boolean) => void;
}) {
  // Every debt with a balance owed is listed — including ones the user has
  // excluded (e.g. a card paid off in full every month) — so excluding is
  // reversible via the checkbox rather than making the account disappear
  // from view entirely.
  const debtAccounts = accounts.filter((a) => {
    const g = groupOf(a.account_type);
    return (g === "credit" || g === "loan") && owedAmount(a) > 0;
  });

  const [strategy, setStrategy] = useState("snowball");
  const [extraPayment, setExtraPayment] = useState("0");
  const [minimums, setMinimums] = useState<Record<number, string>>({});
  const [plan, setPlan] = useState<DebtPayoffPlan | null>(null);
  const [calculating, setCalculating] = useState(false);

  if (debtAccounts.length === 0) return null;

  async function handleCalculate() {
    setCalculating(true);
    setPlan(
      await onCalculateDebtPayoff(
        strategy,
        extraPayment.trim() || "0",
        debtAccounts.map((a) => ({ accountId: a.id, minimumPayment: minimums[a.id]?.trim() || "0" })),
      ),
    );
    setCalculating(false);
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Debt Payoff Planner</span>
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th>Include</th>
            <th>Debt</th>
            <th className="amount-col">Balance</th>
            <th className="amount-col">APR %</th>
            <th className="amount-col">Minimum payment</th>
          </tr>
        </thead>
        <tbody>
          {debtAccounts.map((a) => (
            <tr key={a.id}>
              <td>
                <input
                  type="checkbox"
                  checked={!a.excluded_from_debt_payoff}
                  title="Include in payoff plan — uncheck for a debt you already pay off in full, like a credit card, so it isn't treated as debt to pay down"
                  onChange={(e) => onSetAccountExcludedFromDebtPayoff(a.id, !e.target.checked)}
                />
              </td>
              <td>{a.name}</td>
              <td className="amount-col">{formatAmount(owedAmount(a))}</td>
              <td className="amount-col">
                <input
                  className="amount-edit-input"
                  defaultValue={a.interest_rate ?? ""}
                  placeholder="0.00"
                  onBlur={(e) => onSetAccountInterestRate(a.id, e.target.value.trim() || null)}
                />
              </td>
              <td className="amount-col">
                <input
                  className="amount-edit-input"
                  value={minimums[a.id] ?? ""}
                  placeholder="0.00"
                  onChange={(e) => setMinimums({ ...minimums, [a.id]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="labeled-field-form" onSubmit={(e) => { e.preventDefault(); handleCalculate(); }}>
        <label className="labeled-field">
          <span className="labeled-field-label">Strategy</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {DEBT_STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="labeled-field">
          <span className="labeled-field-label">Extra monthly payment</span>
          <input value={extraPayment} onChange={(e) => setExtraPayment(e.target.value)} placeholder="0.00" />
        </label>
        <button type="submit" disabled={calculating} style={{ alignSelf: "flex-end" }}>
          {calculating ? "Calculating…" : "Calculate"}
        </button>
      </form>

      {plan && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-value">{plan.total_months !== null ? `${plan.total_months} mo` : "Never"}</span>
              <span className="stat-label">Debt-free in</span>
            </div>
            <div className="stat">
              <span className="stat-value">{formatAmount(plan.total_interest_paid)}</span>
              <span className="stat-label">Total interest</span>
            </div>
          </div>
          <table className="ledger">
            <thead>
              <tr>
                <th>Debt</th>
                <th>Payoff date</th>
                <th className="amount-col">Interest paid</th>
              </tr>
            </thead>
            <tbody>
              {plan.per_account.map((l) => (
                <tr key={l.account_id}>
                  <td>{l.account_name}</td>
                  <td>{l.payoff_date ?? "Never at this payment level"}</td>
                  <td className="amount-col">{formatAmount(l.total_interest_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function AccountRow({
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
      <td className="member-col">
        <select
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
  manualAssetsTotal,
  onSetStartingBalance,
  onUpdateAccountType,
  onDeleteAccount,
  onSetAccountDetails,
  familyMembers,
  onSetAccountMember,
  onAddAccount,
  expandedStat,
  onToggleStat,
}: {
  accounts: Account[];
  /** Sum of manually-tracked assets (Property & Valuables) — folded into
   * the Total Assets / Net Worth stats here alongside real accounts. */
  manualAssetsTotal: number;
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  onDeleteAccount: (accountId: number) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  familyMembers: FamilyMember[];
  onSetAccountMember: (accountId: number, memberId: number | null) => void;
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
  const assets = assetAccounts.reduce((s, a) => s + netWorthContribution(a), 0) + manualAssetsTotal;
  const liabilities = liabilityAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const netWorth = assets + liabilities;

  const manualAssetsRow = manualAssetsTotal !== 0 ? [{ name: "Property & Valuables", amount: manualAssetsTotal }] : [];
  const accountBreakdowns: Record<"assets" | "liabilities" | "networth", { name: string; amount: number }[]> = {
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
                <col style={{ width: "24%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "21%" }} />
                <col style={{ width: "15%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="amount-col">{"Balance / limit"}</th>
                  <th>Member</th>
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
  assets,
  familyMembers,
  onSetStartingBalance,
  onUpdateAccountType,
  onDeleteAccount,
  onSetAccountDetails,
  onSetAccountMember,
  onAddAccount,
  onExportCsv,
  onPrint,
  onDownloadSetupTemplate,
  onImportSetupData,
  onCreateAsset,
  onUpdateAssetValue,
  onSetAssetMember,
  onDeleteAsset,
  onOpenBudget,
}: {
  report: Report | null;
  accounts: Account[];
  buckets: Bucket[];
  transactions: Transaction[];
  assets: Asset[];
  familyMembers: FamilyMember[];
  onSetStartingBalance: (accountId: number, balance: string) => void;
  onUpdateAccountType: (accountId: number, accountType: string) => void;
  onDeleteAccount: (accountId: number) => void;
  onSetAccountDetails: (accountId: number, institution: string | null, mask: string | null) => void;
  onSetAccountMember: (accountId: number, memberId: number | null) => void;
  onAddAccount: () => void;
  onExportCsv: () => void;
  onPrint: () => void;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
  onCreateAsset: (
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) => void;
  onUpdateAssetValue: (id: number, value: string, valuedOn: string) => void;
  onSetAssetMember: (id: number, memberId: number | null) => void;
  onDeleteAsset: (id: number) => void;
  onOpenBudget: () => void;
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

  // All-time spending grouped by family member — same outflows-only
  // convention as tag spending above. Unlike a tag, a transaction carries
  // at most one member, so there's no double-counting; an unattributed
  // transaction is left out entirely rather than lumped into a catch-all
  // "Unassigned" bucket — this is meant to answer "how much did each named
  // person spend," not to track attribution coverage.
  const memberTotals = new Map<string, number>();
  for (const t of transactions) {
    const amount = parseFloat(t.amount);
    if (amount >= 0 || !t.member_name) continue;
    memberTotals.set(t.member_name, (memberTotals.get(t.member_name) ?? 0) + Math.abs(amount));
  }
  const memberBreakdown = Array.from(memberTotals, ([name, amount]) => ({ name, amount }));

  const topLevelBreakdowns: Record<"totalSaved" | "income" | "byTag" | "byMember", { name: string; amount: number }[]> = {
    totalSaved: totalSavedBreakdown,
    income: incomeBreakdown,
    byTag: tagBreakdown,
    byMember: memberBreakdown,
  };

  // Net worth grouped by family member — accounts plus manually-tracked
  // assets, same netWorthContribution convention `AccountsSection` uses for
  // its type-based grouping. An "Unassigned" row covers whatever isn't
  // attributed to anyone, so (unlike the spending breakdown above) this
  // total always reconciles with the overall Net Worth stat.
  const netWorthByMember = new Map<string, number>();
  for (const a of accounts) {
    const key = a.member_name ?? "Unassigned";
    netWorthByMember.set(key, (netWorthByMember.get(key) ?? 0) + netWorthContribution(a));
  }
  for (const asset of assets) {
    const key = asset.member_name ?? "Unassigned";
    netWorthByMember.set(key, (netWorthByMember.get(key) ?? 0) + parseFloat(asset.value));
  }
  const netWorthByMemberRows = Array.from(netWorthByMember, ([name, amount]) => ({ name, amount })).sort((x, y) =>
    x.name === "Unassigned" ? 1 : y.name === "Unassigned" ? -1 : x.name.localeCompare(y.name),
  );

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
        {familyMembers.length > 0 && (
          <button
            type="button"
            className={expandedStat === "byMember" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
            onClick={() => toggleStat("byMember")}
          >
            <span className="stat-value">{memberBreakdown.length}</span>
            <span className="stat-label">Members with spending</span>
          </button>
        )}
      </div>

      {expandedStat && expandedStat in topLevelBreakdowns && (
        <StatDetailPanel
          title={REPORT_STAT_LABELS[expandedStat]}
          rows={topLevelBreakdowns[expandedStat as "totalSaved" | "income" | "byTag" | "byMember"]}
          emptyMessage={
            expandedStat === "totalSaved"
              ? "No savings buckets yet."
              : expandedStat === "income"
                ? "No income recorded yet."
                : expandedStat === "byTag"
                  ? "No tags used yet — add some from the Ledger."
                  : "No spending attributed to a family member yet."
          }
          onClose={() => toggleStat(expandedStat)}
        />
      )}

      <AccountsSection
        accounts={accounts}
        manualAssetsTotal={assets.reduce((s, a) => s + parseFloat(a.value), 0)}
        onSetStartingBalance={onSetStartingBalance}
        onUpdateAccountType={onUpdateAccountType}
        onDeleteAccount={onDeleteAccount}
        onSetAccountDetails={onSetAccountDetails}
        familyMembers={familyMembers}
        onSetAccountMember={onSetAccountMember}
        onAddAccount={onAddAccount}
        expandedStat={expandedStat}
        onToggleStat={toggleStat}
      />

      <PropertyAssetsSection
        assets={assets}
        familyMembers={familyMembers}
        onCreate={onCreateAsset}
        onUpdateValue={onUpdateAssetValue}
        onSetMember={onSetAssetMember}
        onDelete={onDeleteAsset}
      />

      {familyMembers.length > 0 && (
        <div>
          <h2 className="reports-section-title">Net Worth by Member</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th>Member</th>
                <th className="amount-col">Net Worth</th>
              </tr>
            </thead>
            <tbody>
              {netWorthByMemberRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="amount-col">{formatAmount(row.amount)}</td>
                </tr>
              ))}
              {netWorthByMemberRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="empty-state">
                    Nothing to show yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card clickable-row" onClick={onOpenBudget} title="Go to the Budget tab">
        <span className="category-link">This month's budget →</span>
      </div>
    </div>
  );
}
