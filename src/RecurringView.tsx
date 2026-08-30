import { FormEvent, useState } from "react";
import type { Account, Recurring } from "./types";
import { formatAmount } from "./format";

const CADENCE_OPTIONS = ["weekly", "biweekly", "monthly", "annual"];

function NewRecurringForm({
  accounts,
  onCreate,
}: {
  accounts: Account[];
  onCreate: (
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
  ) => void;
}) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [anchorDate, setAnchorDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [open, setOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!merchant.trim() || !amount.trim() || !anchorDate) return;
    onCreate(merchant.trim(), null, amount.trim(), cadence, anchorDate, accountId ? Number(accountId) : null);
    setMerchant("");
    setAmount("");
    setAnchorDate("");
    setAccountId("");
    setOpen(false);
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>Add recurring…</button>;
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input
        autoFocus
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder='e.g. "Netflix"'
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (negative = bill)"
      />
      <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
        {CADENCE_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {c[0].toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
      <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} title="Next/anchor date" />
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">No linked account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!merchant.trim() || !amount.trim() || !anchorDate}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

export function RecurringView({
  recurring,
  accounts,
  onCreate,
  onDelete,
}: {
  recurring: Recurring[];
  accounts: Account[];
  onCreate: (
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
  ) => void;
  onDelete: (id: number) => void;
}) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const monthlyExpense = recurring
    .filter((r) => parseFloat(r.amount) < 0 && r.cadence === "monthly")
    .reduce((s, r) => s + Math.abs(parseFloat(r.amount)), 0);
  const monthlyIncome = recurring
    .filter((r) => parseFloat(r.amount) > 0)
    .reduce((s, r) => {
      const multiplier = r.cadence === "biweekly" ? 2.166 : r.cadence === "weekly" ? 4.333 : r.cadence === "annual" ? 1 / 12 : 1;
      return s + parseFloat(r.amount) * multiplier;
    }, 0);

  return (
    <div className="buckets-view">
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{formatAmount((-monthlyExpense).toFixed(2))}</span>
          <span className="stat-label">Monthly recurring expenses</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatAmount(monthlyIncome.toFixed(2))}</span>
          <span className="stat-label">Recurring income (est.)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{recurring.length}</span>
          <span className="stat-label">Active items</span>
        </div>
      </div>

      <table className="ledger">
        <thead>
          <tr>
            <th>Merchant</th>
            <th>Cadence</th>
            <th>Next due</th>
            <th className="amount-col">Amount</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {recurring.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="account-name-cell">{r.merchant}</div>
                {r.account_name && <span className="account-col">{r.account_name}</span>}
              </td>
              <td>
                <span className="confidence-badge">{r.cadence}</span>
              </td>
              <td>{r.next_date}</td>
              <td className="amount-col">{formatAmount(r.amount)}</td>
              <td className="actions-col">
                {confirmingDeleteId === r.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" onClick={() => onDelete(r.id)}>
                      Delete
                    </button>
                  </span>
                ) : (
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(r.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
          {recurring.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">
                No recurring items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <NewRecurringForm accounts={accounts} onCreate={onCreate} />
    </div>
  );
}
