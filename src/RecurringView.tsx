import { FormEvent, useState } from "react";
import type { Account, FamilyMember, Recurring, RecurringCandidate } from "./types";
import { formatAmount, toLocalIsoDate } from "./format";
import { fmtMoneyShort } from "./charts";
import { useAutoCancelDelete } from "./useAutoCancelDelete";

export const CADENCE_OPTIONS = ["weekly", "biweekly", "monthly", "annual"];

/** One calendar month forward, clamping the day-of-month into range (Jan
 * 31 + 1 month -> Feb 28/29, not Mar 3) — same reasoning as the backend's
 * `add_one_month` (core/src/store.rs), reimplemented here since cadence
 * projection is deliberately client-side and self-contained (see
 * `projectOccurrencesInMonth`'s doc comment). */
function addOneMonthClamped(d: Date): Date {
  const day = d.getDate();
  const daysInNextMonth = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day, daysInNextMonth));
}

/** One year forward, clamping Feb 29 -> Feb 28 in a non-leap target year. */
function addOneYearClamped(d: Date): Date {
  const targetYear = d.getFullYear() + 1;
  const daysInTargetMonth = new Date(targetYear, d.getMonth() + 1, 0).getDate();
  return new Date(targetYear, d.getMonth(), Math.min(d.getDate(), daysInTargetMonth));
}

function stepDate(d: Date, cadence: string): Date {
  switch (cadence) {
    case "weekly":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    case "biweekly":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 14);
    case "monthly":
      return addOneMonthClamped(d);
    case "annual":
      return addOneYearClamped(d);
    default:
      // Unrecognized cadence string (`Recurring.cadence` is plain
      // `string`, not a literal union — see types.ts) — fall back to
      // monthly rather than looping forever or crashing.
      return addOneMonthClamped(d);
  }
}

/** Every date `item` actually lands on within `year`/`month` (1-12),
 * walking forward from `anchor_date` by cadence step — pure and
 * self-contained (no backend round-trip) since `next_date` alone only
 * carries the *next single* occurrence, not every occurrence in an
 * arbitrary displayed month. Usually one date for monthly/annual items,
 * possibly several for weekly/biweekly ones. Capped at 2000 steps as a
 * safety net against a runaway loop; a real anchor/cadence pair never
 * comes close (a 10-year-old weekly item is ~520 steps to "now"). */
export function projectOccurrencesInMonth(item: { anchor_date: string; cadence: string }, year: number, month: number): string[] {
  const [ay, am, ad] = item.anchor_date.split("-").map(Number);
  let current = new Date(ay, am - 1, ad);
  const targetStart = new Date(year, month - 1, 1);
  const targetEnd = new Date(year, month, 0);
  if (current > targetEnd) return [];

  const occurrences: string[] = [];
  let steps = 0;
  while (current <= targetEnd && steps < 2000) {
    if (current >= targetStart) occurrences.push(toLocalIsoDate(current));
    current = stepDate(current, item.cadence);
    steps++;
  }
  return occurrences;
}

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
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingId, setEditingId] = useState<number | null>(null);

  // `recurring` already arrives sorted by next-due date — see
  // `Store::list_recurring`'s own doc comment — so no client-side sort is
  // needed here, just the urgency indicator below.

  // Same 3-day "due soon" window the native bill notification already
  // uses (App.tsx) — reused rather than inventing a second threshold.
  // `next_date` is always today-or-later (see `next_occurrence`'s doc
  // comment — a cadence auto-rolls a lapsed anchor forward), so there's no
  // "overdue" state to detect here, only "coming up soon."
  const todayIso = toLocalIsoDate();
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

  // Not persisted across sessions (unlike theme/nav-order) — not worth
  // remembering, matching the original design call.
  const [view, setView] = useState<"list" | "calendar">("list");
  const now = new Date();
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth() + 1); // 1-12

  const calendarLabel = new Date(calendarYear, calendarMonth - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  function prevCalendarMonth() {
    if (calendarMonth === 1) {
      setCalendarYear((y) => y - 1);
      setCalendarMonth(12);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  }
  function nextCalendarMonth() {
    if (calendarMonth === 12) {
      setCalendarYear((y) => y + 1);
      setCalendarMonth(1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  }

  // date (ISO string) -> every recurring item landing on it this month.
  const occurrencesByDate = new Map<string, Recurring[]>();
  for (const item of recurring) {
    for (const date of projectOccurrencesInMonth(item, calendarYear, calendarMonth)) {
      const existing = occurrencesByDate.get(date);
      if (existing) existing.push(item);
      else occurrencesByDate.set(date, [item]);
    }
  }

  const firstOfMonth = new Date(calendarYear, calendarMonth - 1, 1);
  const daysInCalendarMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const calendarCells: (string | null)[] = [];
  for (let i = 0; i < firstOfMonth.getDay(); i++) calendarCells.push(null);
  for (let d = 1; d <= daysInCalendarMonth; d++) calendarCells.push(toLocalIsoDate(new Date(calendarYear, calendarMonth - 1, d)));
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

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

      <div className="view-toggle" role="group" aria-label="List or calendar view">
        <button type="button" className={view === "list" ? "view-toggle-active" : ""} onClick={() => setView("list")}>
          List
        </button>
        <button
          type="button"
          className={view === "calendar" ? "view-toggle-active" : ""}
          onClick={() => setView("calendar")}
        >
          Calendar
        </button>
      </div>

      {view === "calendar" && (
        <div className="card">
          <div className="month-nav">
            <button type="button" className="modal-secondary" onClick={prevCalendarMonth} aria-label="Previous month">
              ‹
            </button>
            <span className="month-label">{calendarLabel}</span>
            <button type="button" className="modal-secondary" onClick={nextCalendarMonth} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="cal-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div key={label} className="cal-weekday">
                {label}
              </div>
            ))}
            {calendarCells.map((date, i) => {
              if (!date) return <div key={i} className="cal-day cal-day-empty" />;
              const items = occurrencesByDate.get(date) ?? [];
              return (
                <div key={date} className={date === todayIso ? "cal-day cal-day-today" : "cal-day"}>
                  <span className="cal-day-num">{Number(date.slice(-2))}</span>
                  {items.map((item, j) => (
                    <div
                      key={`${item.id}-${j}`}
                      // `isDueSoon` assumes today-or-later by construction
                      // (see its own comment) — true for `r.next_date` in
                      // the list view, but the calendar can show *past*
                      // days in the current month too, which must never
                      // read as "coming up soon."
                      className={date >= todayIso && isDueSoon(date) ? "cal-item cal-item-due-soon" : "cal-item"}
                      title={`${item.merchant} — ${formatAmount(item.amount)}`}
                    >
                      <span className="cal-item-merchant">{item.merchant}</span>
                      <span className="cal-item-amount">{fmtMoneyShort(parseFloat(item.amount))}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "list" && (
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
                      <button type="button" className="btn-danger" onClick={() => onDelete(r.id)}>
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
      )}

      <NewRecurringForm accounts={accounts} familyMembers={familyMembers} onCreate={onCreate} />
    </div>
  );
}
