import { useState } from "react";
import type { Account, BudgetAlert, CategoryAmount, NetWorthPoint, Recurring, Report, Transaction } from "./types";
import { DonutChart, LineChart, fmtMoneyShort } from "./charts";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";

const CATEGORY_COLORS = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9"];
const GROUP_ORDER = ["income", "fixed", "flexible", "nonmonthly"] as const;
const GROUP_LABELS: Record<string, string> = {
  income: "Income",
  fixed: "Fixed Expenses",
  flexible: "Flexible Spending",
  nonmonthly: "Non-Monthly",
};

function accountGroup(accountType: string): string {
  if (accountType === "checking" || accountType === "savings") return "cash";
  if (accountType === "credit") return "credit";
  if (accountType === "loan") return "loan";
  if (accountType === "investment") return "investment";
  return "other";
}

/** Same convention as ReportsView's netWorthContribution: a credit
 * account's starting_balance is a limit (owed starts at $0); a loan's
 * starting_balance is the amount already owed (counts as debt in full
 * from the start); everything else is its balance as-is. */
function netWorthContribution(a: Account): number {
  const group = accountGroup(a.account_type);
  if (group === "credit") return parseFloat(a.current_balance) - parseFloat(a.starting_balance);
  if (group === "loan") return -parseFloat(a.current_balance);
  return parseFloat(a.current_balance);
}

type StatKey = "networth" | "cash" | "debt" | "investments";

const STAT_LABELS: Record<StatKey, string> = {
  networth: "Net Worth",
  cash: "Cash",
  debt: "Debt",
  investments: "Investments",
};

export function DashboardView({
  accounts,
  netWorthHistory,
  spendingThisMonth,
  report,
  recurring,
  transactions,
  budgetAlerts,
}: {
  accounts: Account[];
  netWorthHistory: NetWorthPoint[];
  spendingThisMonth: CategoryAmount[];
  report: Report | null;
  recurring: Recurring[];
  transactions: Transaction[];
  budgetAlerts: BudgetAlert[];
}) {
  const [expandedStat, setExpandedStat] = useState<StatKey | null>(null);
  const [showBudgetAlerts, setShowBudgetAlerts] = useState(false);
  const overCount = budgetAlerts.filter((a) => a.level === "over").length;
  const warningCount = budgetAlerts.filter((a) => a.level === "warning").length;

  const netWorth = netWorthHistory.length ? parseFloat(netWorthHistory[netWorthHistory.length - 1].value) : 0;
  const netWorthDelta = netWorthHistory.length ? netWorth - parseFloat(netWorthHistory[0].value) : 0;

  const cashAccounts = accounts.filter((a) => accountGroup(a.account_type) === "cash");
  const debtAccounts = accounts.filter((a) => {
    const group = accountGroup(a.account_type);
    return group === "credit" || group === "loan";
  });
  const investmentAccounts = accounts.filter((a) => accountGroup(a.account_type) === "investment");

  const cash = cashAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const debt = debtAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const investments = investmentAccounts.reduce((s, a) => s + netWorthContribution(a), 0);

  const breakdowns: Record<StatKey, { name: string; amount: number }[]> = {
    networth: accounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    cash: cashAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    debt: debtAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    investments: investmentAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
  };

  function toggleStat(key: StatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  const donutData = spendingThisMonth.slice(0, 6).map((c, i) => ({
    label: c.category,
    value: parseFloat(c.amount),
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const upcoming = recurring
    .filter((r) => parseFloat(r.amount) < 0)
    .slice()
    .sort((a, b) => (a.next_date < b.next_date ? -1 : 1))
    .slice(0, 5);

  const recent = transactions
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    .slice(0, 8);

  return (
    <div className="reports-view">
      <div className="stats">
        <button
          type="button"
          className={expandedStat === "networth" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("networth")}
        >
          <span className="stat-value">{fmtMoneyShort(netWorth)}</span>
          <span className="stat-label">Net Worth</span>
        </button>
        <button
          type="button"
          className={expandedStat === "cash" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("cash")}
        >
          <span className="stat-value">{fmtMoneyShort(cash)}</span>
          <span className="stat-label">Cash</span>
        </button>
        <button
          type="button"
          className={expandedStat === "debt" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("debt")}
        >
          <span className={debt < 0 ? "stat-value report-over-budget" : "stat-value"}>{fmtMoneyShort(debt)}</span>
          <span className="stat-label">Debt</span>
        </button>
        <button
          type="button"
          className={expandedStat === "investments" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
          onClick={() => toggleStat("investments")}
        >
          <span className="stat-value">{fmtMoneyShort(investments)}</span>
          <span className="stat-label">Investments</span>
        </button>
      </div>

      {expandedStat && (
        <StatDetailPanel
          title={STAT_LABELS[expandedStat]}
          rows={breakdowns[expandedStat]}
          emptyMessage="No accounts contribute to this yet."
          onClose={() => setExpandedStat(null)}
        />
      )}

      {budgetAlerts.length > 0 && (
        <button type="button" className="budget-alert-banner" onClick={() => setShowBudgetAlerts((v) => !v)}>
          {overCount > 0 && `${overCount} categor${overCount === 1 ? "y" : "ies"} over budget`}
          {overCount > 0 && warningCount > 0 && ", "}
          {warningCount > 0 && `${warningCount} approaching ${warningCount === 1 ? "its" : "their"} limit`}
        </button>
      )}
      {showBudgetAlerts && (
        <StatDetailPanel
          title="this month's budget alerts"
          rows={budgetAlerts.map((a) => ({ name: a.category, amount: parseFloat(a.actual) - parseFloat(a.budgeted) }))}
          emptyMessage="Nothing to flag."
          onClose={() => setShowBudgetAlerts(false)}
        />
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Net worth trend</span>
          </div>
          <LineChart points={netWorthHistory.map((p) => ({ label: p.month_label, value: parseFloat(p.value) }))} height={210} />
          <p className="account-col" style={{ marginTop: 8 }}>
            {netWorthDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(netWorthDelta))} over this period
          </p>
        </div>
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Spending by category</span>
          </div>
          {donutData.length > 0 ? (
            <div className="donut-with-legend">
              <DonutChart data={donutData} size={132} />
              <div>
                {donutData.map((d) => (
                  <div className="chart-legend-item" key={d.label} style={{ marginBottom: 8 }}>
                    <span className="chart-legend-swatch" style={{ background: d.color }}></span>
                    {d.label}
                    <span className="account-col" style={{ marginLeft: "auto" }}>
                      {fmtMoneyShort(d.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-state">No spending yet this month.</p>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">{report?.month_label ?? "This month"}'s budget</span>
          </div>
          {GROUP_ORDER.map((group) => {
            const lines = (report?.budget_actuals ?? []).filter((b) => b.budget_group === group);
            if (lines.length === 0) return null;
            const budgeted = lines.reduce((s, b) => s + parseFloat(b.budgeted), 0);
            const actual = lines.reduce((s, b) => s + parseFloat(b.actual), 0);
            const pct = budgeted ? Math.min(100, (actual / budgeted) * 100) : 0;
            const over = group === "income" ? actual < budgeted : actual > budgeted;
            return (
              <div key={group} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{GROUP_LABELS[group]}</span>
                  <span className="account-col">
                    {formatAmount(actual)} of {formatAmount(budgeted)}
                  </span>
                </div>
                <div className="bucket-progress-track">
                  <div
                    className="bucket-progress-fill"
                    style={{ width: `${pct}%`, background: over ? "var(--negative)" : undefined }}
                  />
                </div>
              </div>
            );
          })}
          {(report?.budget_actuals ?? []).length === 0 && <p className="empty-state">No budget lines yet.</p>}
        </div>
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Upcoming bills</span>
          </div>
          {upcoming.length > 0 ? (
            upcoming.map((r) => (
              <div className="account-name-detail" key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", cursor: "default" }}>
                <div>
                  <div className="account-name-cell">{r.merchant}</div>
                  <span className="account-col">{r.next_date}</span>
                </div>
                <span className="amount-col">{formatAmount(r.amount)}</span>
              </div>
            ))
          ) : (
            <p className="empty-state">Nothing due soon.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Recent transactions</span>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="amount-col">Amount</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td>{t.description}</td>
                <td className="amount-col">{formatAmount(t.amount)}</td>
                <td>{t.category ?? "Uncategorized"}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  No transactions yet — import a CSV to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
