import { FormEvent, useState } from "react";
import type { Account, FamilyMember, Recurring, RecurringCandidate } from "./types";
import { formatAmount } from "./format";

export const CADENCE_OPTIONS = ["weekly", "biweekly", "monthly", "annual"];

function SuggestedRecurringSection({
  candidates,
  onAdd,
  onDismiss,
}: {
  candidates: RecurringCandidate[];
  onAdd: (candidate: RecurringCandidate) => void;
  onDismiss: (candidate: RecurringCandidate) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Suggested</span>
      </div>
      <p className="modal-message-secondary">
        Detected from your ledger — a merchant and amount that's repeated on a consistent schedule but isn't tracked
        here yet.
      </p>
      {candidates.map((c) => (
        <div className="suggested-row" key={`${c.merchant}|${c.amount}|${c.cadence}`}>
          <div className="suggested-info">
            <div className="suggested-name">{c.merchant}</div>
            <div className="suggested-meta">
              {c.cadence[0].toUpperCase() + c.cadence.slice(1)} · seen {c.occurrence_count} times
              {c.category && ` · ${c.category}`}
            </div>
          </div>
          <span className="suggested-amt">{formatAmount(c.amount)}</span>
          <div className="suggested-actions">
            <button type="button" className="modal-secondary btn-sm" onClick={() => onDismiss(c)}>
              Dismiss
            </button>
            <button type="button" className="btn-sm" onClick={() => onAdd(c)}>
              Add
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function NewRecurringForm({
  accounts,
  familyMembers,
  onCreate,
}: {
  accounts: Account[];
  familyMembers: FamilyMember[];
  onCreate: (
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) => void;
}) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [anchorDate, setAnchorDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [open, setOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!merchant.trim() || !amount.trim() || !anchorDate) return;
    onCreate(
      merchant.trim(),
      null,
      amount.trim(),
      cadence,
      anchorDate,
      accountId ? Number(accountId) : null,
      memberId ? Number(memberId) : null,
    );
    setMerchant("");
    setAmount("");
    setAnchorDate("");
    setAccountId("");
    setMemberId("");
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
      <button type="submit" disabled={!merchant.trim() || !amount.trim() || !anchorDate}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function EditRecurringRow({
  item,
  accounts,
  familyMembers,
  onSave,
  onCancel,
}: {
  item: Recurring;
  accounts: Account[];
  familyMembers: FamilyMember[];
  onSave: (
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) => void;
  onCancel: () => void;
}) {
  const [merchant, setMerchant] = useState(item.merchant);
  const [amount, setAmount] = useState(item.amount);
  const [cadence, setCadence] = useState(item.cadence);
  const [anchorDate, setAnchorDate] = useState(item.anchor_date);
  const [accountId, setAccountId] = useState(item.account_id !== null ? String(item.account_id) : "");
  const [memberId, setMemberId] = useState(item.member_id !== null ? String(item.member_id) : "");

  const valid = merchant.trim() !== "" && amount.trim() !== "" && anchorDate !== "";

  function handleSave() {
    if (!valid) return;
    onSave(
      merchant.trim(),
      item.category,
      amount.trim(),
      cadence,
      anchorDate,
      accountId ? Number(accountId) : null,
      memberId ? Number(memberId) : null,
    );
  }

  return (
    <tr>
      <td>
        <input autoFocus className="row-edit-input" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        {familyMembers.length > 0 && (
          <select
            className="row-edit-input"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            style={{ marginTop: 4 }}
          >
            <option value="">Unassigned</option>
            {familyMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        <select className="row-edit-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">No linked account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select className="row-edit-input" value={cadence} onChange={(e) => setCadence(e.target.value)}>
          {CADENCE_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="date"
          className="row-edit-input"
          value={anchorDate}
          onChange={(e) => setAnchorDate(e.target.value)}
          title="Next/anchor date"
        />
      </td>
      <td className="amount-col">
        <input className="amount-edit-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </td>
      <td className="actions-col">
        <span className="row-delete-confirm">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!valid}>
            Save
          </button>
        </span>
      </td>
    </tr>
  );
}

export function RecurringView({
  recurring,
  candidates,
  accounts,
  familyMembers,
  onCreate,
  onUpdate,
  onDelete,
  onAddCandidate,
  onDismissCandidate,
}: {
  recurring: Recurring[];
  candidates: RecurringCandidate[];
  accounts: Account[];
  familyMembers: FamilyMember[];
  onCreate: (
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) => void;
  onUpdate: (
    id: number,
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) => void;
  onDelete: (id: number) => void;
  onAddCandidate: (candidate: RecurringCandidate) => void;
  onDismissCandidate: (candidate: RecurringCandidate) => void;
}) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  // `recurring` already arrives sorted by next-due date — see
  // `Store::list_recurring`'s own doc comment — so no client-side sort is
  // needed here, just the urgency indicator below.

  // Same 3-day "due soon" window the native bill notification already
  // uses (App.tsx) — reused rather than inventing a second threshold.
  // `next_date` is always today-or-later (see `next_occurrence`'s doc
  // comment — a cadence auto-rolls a lapsed anchor forward), so there's no
  // "overdue" state to detect here, only "coming up soon."
  const todayIso = new Date().toISOString().slice(0, 10);
  function isDueSoon(nextDate: string): boolean {
    const daysUntil = (new Date(nextDate).getTime() - new Date(todayIso).getTime()) / (1000 * 60 * 60 * 24);
    return daysUntil <= 3;
  }

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
          <span className="stat-value">{formatAmount(monthlyExpense.toFixed(2))}</span>
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

      <SuggestedRecurringSection candidates={candidates} onAdd={onAddCandidate} onDismiss={onDismissCandidate} />

      <table className="ledger">
        <thead>
          <tr>
            <th>Merchant</th>
            <th>Account</th>
            <th>Cadence</th>
            <th>Next due</th>
            <th className="amount-col">Amount</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {recurring.map((r) =>
            editingId === r.id ? (
              <EditRecurringRow
                key={r.id}
                item={r}
                accounts={accounts}
                familyMembers={familyMembers}
                onCancel={() => setEditingId(null)}
                onSave={(merchant, category, amount, cadence, anchorDate, accountId, memberId) => {
                  onUpdate(r.id, merchant, category, amount, cadence, anchorDate, accountId, memberId);
                  setEditingId(null);
                }}
              />
            ) : (
              <tr key={r.id}>
                <td>
                  <div className="account-name-cell">{r.merchant}</div>
                  {r.member_name && <span className="account-col">{r.member_name}</span>}
                </td>
                <td>{r.account_name ?? <span className="account-col">—</span>}</td>
                <td>
                  <span className="confidence-badge">{r.cadence}</span>
                </td>
                <td>
                  {r.next_date}
                  {isDueSoon(r.next_date) && <span className="budget-alert-badge budget-alert-warning">Due soon</span>}
                </td>
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
                    <span className="row-delete-confirm">
                      <button type="button" className="modal-secondary" onClick={() => setEditingId(r.id)}>
                        Edit
                      </button>
                      <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(r.id)}>
                        Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ),
          )}
          {recurring.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state">
                No recurring items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <NewRecurringForm accounts={accounts} familyMembers={familyMembers} onCreate={onCreate} />
    </div>
  );
}
