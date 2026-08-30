import { DragEvent, FormEvent, useEffect, useState } from "react";
import type { BudgetAlert, ReportBudgetLine } from "./types";
import { formatAmount } from "./format";

const GROUP_ORDER = ["income", "fixed", "flexible", "nonmonthly"] as const;
type Group = (typeof GROUP_ORDER)[number];
const GROUP_LABELS: Record<Group, string> = {
  income: "Income",
  fixed: "Fixed Expenses",
  flexible: "Flexible Spending",
  nonmonthly: "Non-Monthly",
};

const CATEGORY_ORDER_STORAGE_KEY = "meadow-budget-category-order";

/** A per-viewer display preference (same as theme/nav order) — one flat
 * list covering every category ever manually positioned, regardless of
 * group. Filtering it down to one group's categories naturally keeps
 * their relative order, so a single stored list is enough to give every
 * group its own independent ordering without a separate array each. */
function loadCategoryOrder(): string[] {
  try {
    const stored = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // corrupt/unavailable storage — fall back to the default order
  }
  return [];
}

function saveCategoryOrder(order: string[]) {
  try {
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

/** Sorts `categories` by their position in the saved `order`; anything
 * not yet positioned keeps its original relative order, appended after
 * everything that has been. */
function sortByCustomOrder(categories: string[], order: string[]): string[] {
  const rank = new Map(order.map((c, i) => [c, i]));
  return categories
    .map((c, i) => ({ c, i, r: rank.has(c) ? rank.get(c)! : Infinity }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((x) => x.c);
}

function NewBudgetLineForm({
  availableCategories,
  onSet,
}: {
  availableCategories: string[];
  onSet: (category: string, monthlyAmount: string, budgetGroup: string) => void;
}) {
  const [category, setCategory] = useState(availableCategories[0] ?? "");
  const [amount, setAmount] = useState("");
  const [group, setGroup] = useState<Group>("flexible");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!availableCategories.includes(category)) {
      setCategory(availableCategories[0] ?? "");
    }
  }, [availableCategories, category]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!category || !amount.trim()) return;
    onSet(category, amount.trim(), group);
    setAmount("");
    setOpen(false);
  }

  if (availableCategories.length === 0) {
    return <p className="modal-message-secondary">Every category already has a budget line this month.</p>;
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>Add budget line…</button>;
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {availableCategories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select value={group} onChange={(e) => setGroup(e.target.value as Group)}>
        {GROUP_ORDER.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABELS[g]}
          </option>
        ))}
      </select>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monthly amount" />
      <button type="submit" disabled={!category || !amount.trim()}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function BudgetRow({
  line,
  alertLevel,
  editingAmount,
  setEditingAmount,
  onSetBudget,
  confirmingDelete,
  setConfirmingDelete,
  onDeleteBudget,
  onCategoryClick,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  line: ReportBudgetLine;
  alertLevel: "warning" | "over" | undefined;
  editingAmount: { category: string; value: string } | null;
  setEditingAmount: (v: { category: string; value: string } | null) => void;
  onSetBudget: (category: string, monthlyAmount: string, budgetGroup: string) => void;
  confirmingDelete: string | null;
  setConfirmingDelete: (c: string | null) => void;
  onDeleteBudget: (category: string) => void;
  onCategoryClick: (category: string) => void;
  isDragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  // For expenses, "remaining" is budgeted minus actual (positive = under
  // budget). Income is the opposite — exceeding the expected amount is
  // good, so the sign flips for the income group.
  const remaining =
    line.budget_group === "income"
      ? parseFloat(line.actual) - parseFloat(line.budgeted)
      : parseFloat(line.budgeted) - parseFloat(line.actual);

  function commitAmountEdit(value: string) {
    setEditingAmount(null);
    if (!value.trim()) return;
    onSetBudget(line.category, value.trim(), line.budget_group);
  }

  return (
    <tr
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={isDragging ? "budget-row-dragging" : undefined}
    >
      <td>
        <span className="drag-handle" title="Drag to reorder">
          ⠿
        </span>
        <span
          className="category-link"
          title={`See every transaction under ${line.category} this month`}
          onClick={() => onCategoryClick(line.category)}
        >
          {line.category}
        </span>
        {alertLevel && (
          <span
            className={alertLevel === "over" ? "budget-alert-badge budget-alert-over" : "budget-alert-badge budget-alert-warning"}
            title={
              alertLevel === "over"
                ? "Spent past its monthly budget"
                : Math.abs(remaining) < 0.005
                  ? "Right at its monthly budget"
                  : "Approaching its monthly budget (80%+)"
            }
          >
            {alertLevel === "over" ? "Over" : Math.abs(remaining) < 0.005 ? "100%" : "80%+"}
          </span>
        )}
      </td>
      <td>
        <select value={line.budget_group} onChange={(e) => onSetBudget(line.category, line.budgeted, e.target.value)}>
          {GROUP_ORDER.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      </td>
      <td className="amount-col">
        {editingAmount?.category === line.category ? (
          <input
            autoFocus
            className="amount-edit-input"
            value={editingAmount.value}
            onChange={(e) => setEditingAmount({ category: line.category, value: e.target.value })}
            onBlur={() => commitAmountEdit(editingAmount.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAmountEdit(editingAmount.value);
              if (e.key === "Escape") setEditingAmount(null);
            }}
          />
        ) : (
          <span
            className="amount-editable"
            title="Click to adjust this month's budget"
            onClick={() => setEditingAmount({ category: line.category, value: line.budgeted })}
          >
            {formatAmount(line.budgeted)}
          </span>
        )}
      </td>
      <td className="amount-col">{formatAmount(line.actual)}</td>
      <td className={remaining < 0 ? "amount-col report-over-budget" : "amount-col"}>
        {formatAmount(remaining.toFixed(2))}
      </td>
      <td className="actions-col">
        {confirmingDelete === line.category ? (
          <span className="row-delete-confirm">
            <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => onDeleteBudget(line.category)}>
              Delete
            </button>
          </span>
        ) : (
          <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(line.category)}>
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

export function BudgetView({
  categories,
  budgetActuals,
  budgetAlerts,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  onSetBudget,
  onDeleteBudget,
  onCategoryClick,
}: {
  categories: string[];
  budgetActuals: ReportBudgetLine[];
  budgetAlerts: BudgetAlert[];
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSetBudget: (category: string, monthlyAmount: string, budgetGroup: string) => void;
  onDeleteBudget: (category: string) => void;
  onCategoryClick: (category: string) => void;
}) {
  const alertByCategory = new Map(budgetAlerts.map((a) => [a.category, a.level]));
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState<{ category: string; value: string } | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>(loadCategoryOrder);
  const [dragCategory, setDragCategory] = useState<string | null>(null);

  // Every row shown comes straight from this month's own budget_actuals —
  // no separate global budget list, since a category's budgeted amount is
  // now per-month (see the App.tsx bug this fixes: editing one month's
  // budget used to change every month, since there was only ever one
  // global row per category).
  const budgetedCategories = new Set(budgetActuals.map((b) => b.category));
  const availableCategories = categories.filter((c) => !budgetedCategories.has(c));

  const lineByCategory = new Map(budgetActuals.map((b) => [b.category, b]));
  const orderedCategories = sortByCustomOrder(
    budgetActuals.map((b) => b.category),
    categoryOrder,
  );

  function handleDrop(targetCategory: string) {
    if (!dragCategory || dragCategory === targetCategory) {
      setDragCategory(null);
      return;
    }
    // Reorder within the *full* known set (stored order plus this
    // month's categories), not just this month's subset — otherwise
    // saving would silently drop the positions of categories that only
    // appear in a different month.
    const allKnown = Array.from(new Set([...categoryOrder, ...budgetActuals.map((b) => b.category)]));
    const effective = sortByCustomOrder(allKnown, categoryOrder);
    const next = effective.filter((c) => c !== dragCategory);
    next.splice(next.indexOf(targetCategory), 0, dragCategory);
    setCategoryOrder(next);
    saveCategoryOrder(next);
    setDragCategory(null);
  }

  return (
    <div className="budget-view">
      <div className="month-nav">
        <button type="button" className="modal-secondary" onClick={onPrevMonth} aria-label="Previous month">
          ‹
        </button>
        <span className="month-label">{monthLabel}</span>
        <button type="button" className="modal-secondary" onClick={onNextMonth} aria-label="Next month">
          ›
        </button>
      </div>

      {GROUP_ORDER.map((group) => {
        const groupLines = orderedCategories
          .map((c) => lineByCategory.get(c)!)
          .filter((line) => line.budget_group === group);
        if (groupLines.length === 0) return null;
        const groupBudgeted = groupLines.reduce((s, b) => s + parseFloat(b.budgeted), 0);
        const groupActual = groupLines.reduce((s, b) => s + parseFloat(b.actual), 0);
        return (
          <div key={group}>
            <h2 className="reports-section-title">
              {GROUP_LABELS[group]}{" "}
              <span className="account-col">
                {formatAmount(groupActual.toFixed(2))} of {formatAmount(groupBudgeted.toFixed(2))}
              </span>
            </h2>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Group</th>
                  <th className="amount-col">Monthly budget</th>
                  <th className="amount-col">Actual</th>
                  <th className="amount-col">Remaining</th>
                  <th className="actions-col"></th>
                </tr>
              </thead>
              <tbody>
                {groupLines.map((line) => (
                  <BudgetRow
                    key={line.category}
                    line={line}
                    alertLevel={alertByCategory.get(line.category)}
                    editingAmount={editingAmount}
                    setEditingAmount={setEditingAmount}
                    onSetBudget={onSetBudget}
                    confirmingDelete={confirmingDelete}
                    setConfirmingDelete={setConfirmingDelete}
                    onDeleteBudget={onDeleteBudget}
                    onCategoryClick={onCategoryClick}
                    isDragging={dragCategory === line.category}
                    onDragStart={(e) => {
                      // Native drag-and-drop requires a payload via
                      // setData or the browser treats the drag as
                      // invalid and shows "not-allowed" over every drop
                      // target, regardless of what dragover/drop do.
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", line.category);
                      setDragCategory(line.category);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(line.category);
                    }}
                    onDragEnd={() => setDragCategory(null)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {budgetActuals.length === 0 && <p className="empty-state">No budget lines yet.</p>}

      <NewBudgetLineForm availableCategories={availableCategories} onSet={onSetBudget} />
    </div>
  );
}
