import { FormEvent, useState } from "react";
import { formatAmount } from "./format";
import type { CategoryTransaction, FamilyMember, MonthExpenseDetail } from "./types";

/** Shared shell: a dimmed overlay behind a centered panel. Clicking the
 * overlay (not the panel) cancels, matching how a native dialog behaves. */
function ModalShell({
  title,
  onCancel,
  children,
  wide,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
  /** Content-heavy dialogs (a scrollable list, a table) need more room than
   * a plain form does — pass `wide` rather than growing every modal. */
  wide?: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className={wide ? "modal-panel modal-panel-wide" : "modal-panel"} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function WelcomeDialog({
  onExploreHelp,
  onGetStarted,
}: {
  onExploreHelp: () => void;
  onGetStarted: () => void;
}) {
  return (
    <ModalShell title="Welcome to Penny Worth" onCancel={onGetStarted}>
      <p className="modal-message">
        Get your penny's worth. Before you dive in, would you like a quick
        tour of how everything works?
      </p>
      <p className="modal-message modal-message-secondary">
        You can always come back to this from the Help tab in the sidebar.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onGetStarted}>
          Just get started
        </button>
        <button type="button" onClick={onExploreHelp}>
          Explore Help
        </button>
      </div>
    </ModalShell>
  );
}

export function WhatsNewDialog({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: string[];
  onClose: () => void;
}) {
  return (
    <ModalShell title={`What's new in ${version}`} onCancel={onClose}>
      <ul className="modal-changelog-list">
        {notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </ModalShell>
  );
}

const ACCOUNT_TYPE_OPTIONS = ["checking", "savings", "credit", "loan", "investment", "other"];

export function NewAccountDialog({
  familyMembers,
  onCancel,
  onSubmit,
}: {
  familyMembers: FamilyMember[];
  onCancel: () => void;
  onSubmit: (
    name: string,
    accountType: string,
    startingBalance: string | null,
    institution: string | null,
    mask: string | null,
    memberId: number | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("checking");
  const [startingBalance, setStartingBalance] = useState("");
  const [institution, setInstitution] = useState("");
  const [mask, setMask] = useState("");
  const [memberId, setMemberId] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(
      name.trim(),
      accountType,
      startingBalance.trim() ? startingBalance.trim() : null,
      institution.trim() ? institution.trim() : null,
      mask.trim() ? mask.trim() : null,
      memberId ? Number(memberId) : null,
    );
  }

  const balanceLabel =
    accountType === "credit" ? "Credit limit" : accountType === "loan" ? "Amount currently owed" : "Starting balance";

  return (
    <ModalShell title="New account" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Account name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Everyday Checking"'
          />
        </label>
        <label className="modal-field">
          <span>Account type</span>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            {ACCOUNT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="modal-field">
          <span>{balanceLabel} (optional)</span>
          <input
            value={startingBalance}
            onChange={(e) => setStartingBalance(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="modal-field">
          <span>Institution (optional)</span>
          <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Chase" />
        </label>
        <label className="modal-field">
          <span>Last 4 digits (optional)</span>
          <input value={mask} onChange={(e) => setMask(e.target.value)} placeholder="4821" maxLength={4} />
        </label>
        {familyMembers.length > 0 && (
          <label className="modal-field">
            <span>Family member (optional)</span>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Unassigned</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Create account
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function NewCategoryDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
  }

  return (
    <ModalShell title="New category" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Category name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Pet Care"'
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Add category
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function ManageCategoriesDialog({
  categories,
  onCancel,
  onCreate,
  onRename,
  onDelete,
}: {
  categories: string[];
  onCancel: () => void;
  onCreate: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");

  function startEditing(name: string) {
    setConfirmingDelete(null);
    setEditing(name);
    setDraftName(name);
  }

  function commitRename(oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRename(oldName, trimmed);
    }
    setEditing(null);
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewCategoryName("");
  }

  return (
    <ModalShell title="Manage categories" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        Renaming a category to a name that already exists merges the two.
      </p>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder='New category, e.g. "Pet Care"'
        />
        <button type="submit" disabled={!newCategoryName.trim()}>
          Add
        </button>
      </form>
      {categories.length === 0 ? (
        <p className="modal-message">No categories in use yet.</p>
      ) : (
        <ul className="category-manage-list">
          {categories.map((name) => (
            <li key={name} className="category-manage-row">
              {editing === name ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="category-manage-name">{name}</span>
              )}
              {confirmingDelete === name ? (
                <span className="category-manage-confirm">
                  <span className="modal-message-secondary">Delete? Its transactions become Uncategorized.</span>
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => onDelete(name)}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="category-manage-actions">
                  <button type="button" className="modal-secondary" onClick={() => startEditing(name)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setEditing(null);
                      setConfirmingDelete(name);
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}

/** Same interaction pattern as `ManageCategoriesDialog` — a flat named list
 * with inline rename and delete-with-confirm — since a family member is the
 * same shape of thing as a category: a label other data is attributed to,
 * not a container with its own balance or fields. Unlike a category rename,
 * renaming into an existing name is just an error (surfaced by the caller's
 * usual status handling), not a merge — two family members are never the
 * same person. */
export function ManageFamilyMembersDialog({
  members,
  onCancel,
  onCreate,
  onRename,
  onDelete,
}: {
  members: FamilyMember[];
  onCancel: () => void;
  onCreate: (name: string) => void;
  onRename: (id: number, newName: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [newMemberName, setNewMemberName] = useState("");

  function startEditing(member: FamilyMember) {
    setConfirmingDelete(null);
    setEditing(member.id);
    setDraftName(member.name);
  }

  function commitRename(id: number, oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRename(id, trimmed);
    }
    setEditing(null);
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewMemberName("");
  }

  return (
    <ModalShell title="Manage family members" onCancel={onCancel} wide>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newMemberName}
          onChange={(e) => setNewMemberName(e.target.value)}
          placeholder='New family member, e.g. "Alex"'
        />
        <button type="submit" disabled={!newMemberName.trim()}>
          Add
        </button>
      </form>
      {members.length === 0 ? (
        <p className="modal-message">No family members yet.</p>
      ) : (
        <ul className="category-manage-list">
          {members.map((member) => (
            <li key={member.id} className="category-manage-row">
              {editing === member.id ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(member.id, member.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(member.id, member.name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="category-manage-name">{member.name}</span>
              )}
              {confirmingDelete === member.id ? (
                <span className="category-manage-confirm">
                  <span className="modal-message-secondary">
                    Delete? Anything attributed to {member.name} becomes unassigned.
                  </span>
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => onDelete(member.id)}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="category-manage-actions">
                  <button type="button" className="modal-secondary" onClick={() => startEditing(member)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setEditing(null);
                      setConfirmingDelete(member.id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}

export function MonthExpenseDetailDialog({
  detail,
  onClose,
}: {
  detail: MonthExpenseDetail;
  onClose: () => void;
}) {
  const maxCategory = detail.categories.length ? parseFloat(detail.categories[0].amount) : 1;

  return (
    <ModalShell title={`${detail.month_label} expenses`} onCancel={onClose} wide>
      {detail.categories.length === 0 ? (
        <p className="empty-state">No expenses this month.</p>
      ) : (
        <div style={{ marginBottom: 18 }}>
          {detail.categories.map((c) => (
            <div key={c.category} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{c.category}</span>
                <span className="amount-col">{formatAmount(c.amount)}</span>
              </div>
              <div className="bucket-progress-track">
                <div
                  className="bucket-progress-fill"
                  style={{ width: `${(parseFloat(c.amount) / maxCategory) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="modal-message-secondary" style={{ fontWeight: 700, marginBottom: 8 }}>
        Large expenses
      </p>
      {detail.large_expenses.length === 0 ? (
        <p className="modal-message modal-message-secondary">Nothing stood out as unusually large this month.</p>
      ) : (
        <ul className="large-expense-list">
          {detail.large_expenses.map((e) => (
            <li key={e.transaction_id} className="large-expense-row">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>{e.description}</span>
                <span className="amount-col">{formatAmount(e.amount)}</span>
              </div>
              <div className="modal-message-secondary">{e.detail}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

export function CategoryTransactionsDialog({
  category,
  monthLabel,
  transactions,
  categoryOptions,
  onCorrectCategory,
  onBulkCorrectCategory,
  onClose,
}: {
  category: string;
  monthLabel: string;
  transactions: CategoryTransaction[];
  categoryOptions: string[];
  /** Reconciles a miscategorized whole transaction — not offered for a
   * split line (`is_split`), since a split's category lives on its own
   * split row, edited via the Ledger's "Edit splits" flow instead. */
  onCorrectCategory: (transactionId: number, category: string) => void;
  /** Resolves once the change has actually been applied (or `false` if
   * the user backed out of an in-flight "+ New category…" prompt, or the
   * call failed) — the selection only clears on a real success, same as
   * the Ledger's own bulk bar. */
  onBulkCorrectCategory: (transactionIds: number[], category: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Only whole transactions can be bulk-recategorized this way — a split
  // line's category lives on its own split row (see onCorrectCategory's
  // note above), so it never gets a checkbox here either.
  const selectableIds = transactions.filter((t) => !t.is_split).map((t) => t.transaction_id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleBulkChange(value: string) {
    if (!value) return;
    const applied = await onBulkCorrectCategory(Array.from(selectedIds), value);
    if (applied) setSelectedIds(new Set());
  }

  return (
    <ModalShell title={`${category} — ${monthLabel}`} onCancel={onClose} wide>
      {transactions.length === 0 ? (
        <p className="empty-state">No transactions in this category this month.</p>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="bulk-actions-bar">
              <span className="bulk-actions-count">{selectedIds.size} selected</span>
              <select value="" onChange={(e) => handleBulkChange(e.target.value)}>
                <option value="" disabled>
                  Set category to…
                </option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__new__">+ New category…</option>
              </select>
              <button type="button" className="modal-secondary" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            </div>
          )}
          <div className="modal-table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="select-col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th className="amount-col">Amount</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr
                    key={`${t.transaction_id}-${i}`}
                    className={selectedIds.has(t.transaction_id) ? "ledger-row-selected" : undefined}
                  >
                    <td className="select-col">
                      {!t.is_split && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.transaction_id)}
                          onChange={() => toggleSelected(t.transaction_id)}
                          aria-label={`Select transaction ${t.transaction_id}`}
                        />
                      )}
                    </td>
                    <td>{t.date}</td>
                    <td>
                      {t.description}
                      {t.is_split && (
                        <span className="split-summary"> (split{t.split_note ? `: ${t.split_note}` : ""})</span>
                      )}
                    </td>
                    <td>{t.account_name}</td>
                    <td className="amount-col">{formatAmount(t.amount)}</td>
                    <td>
                      {t.is_split ? (
                        <span className="modal-message-secondary" title="Edit a split's category from the Ledger's Edit splits screen">
                          {category}
                        </span>
                      ) : (
                        <select value={category} onChange={(e) => onCorrectCategory(t.transaction_id, e.target.value)}>
                          {!categoryOptions.includes(category) && <option value={category}>{category}</option>}
                          {categoryOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          <option value="__new__">+ New category…</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

export function ConfirmInvertDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Which way do the amounts go?" onCancel={onCancel}>
      <p className="modal-message">
        Does this file show charges as positive amounts, like a credit card
        statement (with payments shown as negative)?
      </p>
      <p className="modal-message modal-message-secondary">
        Choose "Flip the signs" to match the rest of your ledger (negative =
        money out). Choose "Keep as-is" if it already uses that convention —
        most bank/checking exports do.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Keep as-is
        </button>
        <button type="button" onClick={onConfirm}>
          Flip the signs
        </button>
      </div>
    </ModalShell>
  );
}
