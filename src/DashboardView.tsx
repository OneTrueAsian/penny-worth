import { FormEvent, useState } from "react";
import type {
  Account,
  AccountContributionDelta,
  Asset,
  Bucket,
  BudgetAlert,
  CashFlow,
  CategoryAmount,
  FamilyMember,
  Holding,
  Insight,
  NetWorthPoint,
  Recurring,
  Report,
  Transaction,
} from "./types";
import { DonutChart, LineChart, ProgressRing, Sparkline, fmtMoneyShort } from "./charts";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";
import { groupOf, owedAmount } from "./accountGroups";
import { netWorthByMember } from "./memberBreakdowns";
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_LABELS,
  matchingLayoutPreset,
  type LayoutPresetKey,
  type WidgetId,
} from "./dashboardLayout";
import { answerLedgerQuestion, LEDGER_QA_EXAMPLES, type QaResult } from "./ledgerQa";

const CHECKLIST_DISMISSED_KEY = "meadow-checklist-dismissed";

/** A single template-matched natural-language question, answered entirely
 * from data already on hand (see ledgerQa.ts) — never a hosted LLM call.
 * Always visible above the widget layout, not itself a customizable
 * widget, since it's a utility rather than a report. */
function LedgerQaBox({
  onAsk,
}: {
  onAsk: (question: string) => QaResult;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QaResult | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setResult(onAsk(trimmed));
  }

  return (
    <div className="card ledger-qa-card">
      <div className="card-head">
        <span className="reports-section-title">Ask your ledger</span>
      </div>
      <form className="category-create-form" onSubmit={handleSubmit}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`e.g. "${LEDGER_QA_EXAMPLES[0]}"`}
        />
        <button type="submit" disabled={!question.trim()}>
          Ask
        </button>
      </form>
      {result && (
        <p className={result.matched ? "ledger-qa-answer" : "ledger-qa-answer ledger-qa-answer-unmatched"}>
          {result.answer}
        </p>
      )}
    </div>
  );
}

/** Same try/parse/catch-fallback shape as `loadNavOrder`/`theme` in
 * App.tsx — a per-viewer UI preference, not app data, so it lives in
 * localStorage rather than the database. */
function loadChecklistDismissed(): boolean {
  try {
    return localStorage.getItem(CHECKLIST_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

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
  accountContributionDeltas,
  spendingThisMonth,
  report,
  recurring,
  transactions,
  budgetAlerts,
  insights,
  avgMonthlySpend,
  assetsTotal,
  assets,
  holdings,
  familyMembers,
  buckets,
  categories,
  topCategoriesData,
  layoutWidgets,
  onSetLayoutWidgets,
  onOpenAddWidget,
  onOpenLedger,
  onOpenRecurring,
  onOpenBudget,
  onOpenCashFlow,
  onOpenInvestments,
  onOpenReports,
}: {
  accounts: Account[];
  netWorthHistory: NetWorthPoint[];
  /** Per-account "what changed" behind each stat card's own trend, spanning
   * the same two dates the sparkline/delta above it covers (see App.tsx's
   * `refreshDashboard`) — lets the Debt tile explain *which* account moved,
   * not just that the total did. */
  accountContributionDeltas: AccountContributionDelta[];
  spendingThisMonth: CategoryAmount[];
  report: Report | null;
  recurring: Recurring[];
  transactions: Transaction[];
  budgetAlerts: BudgetAlert[];
  insights: Insight[];
  /** Average of actual spend (money out only) over the trailing ~90 days,
   * as a decimal string straight from the backend — powers the runway
   * stat below ("liquid savings ÷ average monthly spend"). */
  avgMonthlySpend: string;
  /** Total value of manually-tracked assets (Property & Valuables, see the
   * Reports tab) — folded into the *current* Net Worth figure shown here,
   * but deliberately not part of `netWorthHistory`'s trend line (an asset
   * carries only a current value, no history — see `total_assets_value` in
   * the core crate for the full reasoning). */
  assetsTotal: number;
  /** Only needed for the "Net worth by member" pinned-report widget, same
   * data `netWorthByMember` already reduces on the Reports tab. */
  assets: Asset[];
  /** Only needed for the "Allocation" pinned-report widget. Already fetched
   * unconditionally at launch (see App.tsx), so pinning it costs no extra
   * request. */
  holdings: Holding[];
  familyMembers: FamilyMember[];
  /** Only needed for "Ask your ledger" (see ledgerQa.ts) — bucket-progress
   * questions ("how much have I saved toward vacation"). */
  buckets: Bucket[];
  /** Only needed for "Ask your ledger" (see ledgerQa.ts) — matching a
   * question's category phrase against the app's real, user-curated
   * category names. */
  categories: string[];
  /** Only needed for the "Top merchants" pinned-report widget — App.tsx
   * fetches this (for whatever month Cash Flow's own "Top merchants" last
   * looked at, defaulting to the current month) whenever this widget is on
   * the layout, mirroring the existing tab-scoped fetch pattern. */
  topCategoriesData: CashFlow | null;
  /** The Dashboard's current widget arrangement, persisted client-side
   * (see dashboardLayout.ts) — not app data, so it isn't fetched from the
   * backend or shared between profiles. */
  layoutWidgets: WidgetId[];
  onSetLayoutWidgets: (widgets: WidgetId[]) => void;
  onOpenAddWidget: () => void;
  /** "Recent transactions"/"Upcoming bills" rows drill into the Ledger/
   * Recurring tab — no filter passed along, matching every other tab
   * switch in this app (simplest useful version, not trying to pre-filter
   * the destination tab down to just that one row). */
  onOpenLedger: () => void;
  onOpenRecurring: () => void;
  onOpenBudget: () => void;
  onOpenCashFlow: () => void;
  onOpenInvestments: () => void;
  onOpenReports: () => void;
}) {
  const [expandedStat, setExpandedStat] = useState<StatKey | null>(null);
  const [showBudgetAlerts, setShowBudgetAlerts] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(loadChecklistDismissed);
  const [customizeMode, setCustomizeMode] = useState(false);
  const [dragWidgetId, setDragWidgetId] = useState<WidgetId | null>(null);

  function dismissChecklist() {
    setChecklistDismissed(true);
    try {
      localStorage.setItem(CHECKLIST_DISMISSED_KEY, "1");
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }

  const checklistSteps = [
    { done: accounts.length > 0, label: "Add an account", detail: "Checking, savings, credit card — whatever you track.", onClick: onOpenLedger },
    { done: transactions.length > 0, label: "Import or add transactions", detail: "Import a CSV from your bank, or add one by hand.", onClick: onOpenLedger },
    { done: (report?.budget_actuals.length ?? 0) > 0, label: "Set up your budget", detail: "Give at least one category a monthly amount.", onClick: onOpenBudget },
  ];
  const showChecklist = !checklistDismissed && checklistSteps.some((s) => !s.done);
  const overCount = budgetAlerts.filter((a) => a.level === "over").length;
  const warningCount = budgetAlerts.filter((a) => a.level === "warning").length;

  const netWorth = netWorthHistory.length ? parseFloat(netWorthHistory[netWorthHistory.length - 1].value) : 0;
  // The trend delta stays purely history-based (comparing two points on the
  // same series); only the headline figure below folds in assetsTotal,
  // since the trend line itself doesn't include it.
  const netWorthDelta = netWorthHistory.length ? netWorth - parseFloat(netWorthHistory[0].value) : 0;
  const netWorthWithAssets = netWorth + assetsTotal;

  const cashAccounts = accounts.filter((a) => accountGroup(a.account_type) === "cash");
  const debtAccounts = accounts.filter((a) => {
    const group = accountGroup(a.account_type);
    return group === "credit" || group === "loan";
  });
  const investmentAccounts = accounts.filter((a) => accountGroup(a.account_type) === "investment");

  const cash = cashAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const debt = debtAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const investments = investmentAccounts.reduce((s, a) => s + netWorthContribution(a), 0);

  // "Months of expenses covered by liquid savings" — null when there's no
  // spend history to divide by yet (a brand-new file), rather than a
  // misleading Infinity/0. Ring visualization caps at 6 months (a common
  // emergency-fund benchmark) = a full ring; the number itself is never
  // clamped, so "12.4 months" still reads correctly past that point.
  const avgSpendNum = parseFloat(avgMonthlySpend);
  const monthsOfRunway = avgSpendNum > 0 ? cash / avgSpendNum : null;
  const runwayPct = monthsOfRunway !== null ? Math.min(100, Math.max(0, (monthsOfRunway / 6) * 100)) : 0;

  // Per-stat sparklines/deltas, straight off the same trailing-months
  // series the big Net worth trend chart uses — real history, not a
  // fabricated illustration, and shared across all four stat cards
  // instead of a separate fetch per group.
  const cashSpark = netWorthHistory.map((p) => parseFloat(p.cash));
  // `p.debt` is negative-signed (see `netWorthContribution` — it's a
  // contribution to net worth, so a bigger debt subtracts more). Flipped
  // here to a plain positive "amount owed" magnitude so the sparkline and
  // the delta arrow below move the way paying off a debt actually feels —
  // the line descends and the arrow points down as the balance shrinks,
  // not up (up/positive is reserved for net worth, cash, and investments
  // actually growing, which is the opposite of what a shrinking debt is).
  const debtSpark = netWorthHistory.map((p) => -parseFloat(p.debt));
  const investmentsSpark = netWorthHistory.map((p) => parseFloat(p.investments));
  const netWorthSpark = netWorthHistory.map((p) => parseFloat(p.value));
  const cashDelta = cashSpark.length ? cashSpark[cashSpark.length - 1] - cashSpark[0] : 0;
  const debtDelta = debtSpark.length ? debtSpark[debtSpark.length - 1] - debtSpark[0] : 0;
  // Now that `debtSpark` is an owed-amount magnitude, a negative debtDelta
  // means the balance shrank — debt actually went DOWN, which is good news
  // and should read as good news (green, ▼), not the alarm color/arrow a
  // merely nonzero balance would otherwise get below.
  const debtTrendingDown = netWorthHistory.length > 1 && debtDelta < 0;
  const investmentsDelta = investmentsSpark.length ? investmentsSpark[investmentsSpark.length - 1] - investmentsSpark[0] : 0;
  const monthsSpan = netWorthHistory.length;

  const breakdowns: Record<StatKey, { name: string; amount: number }[]> = {
    networth: [
      ...accounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
      ...(assetsTotal !== 0 ? [{ name: "Property & Valuables", amount: assetsTotal }] : []),
    ],
    cash: cashAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    debt: debtAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    investments: investmentAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
  };

  // "What changed" rows for each stat card's own detail panel — which
  // account(s) actually drove the trend shown above, not just the total.
  // Sorted by size of the move, capped at 5 like every other Dashboard
  // list. `toRows` covers Net Worth (every account) and each group's own
  // filtered slice; `sign` flips Debt to the same "amount owed" magnitude
  // debtSpark/debtDelta use above, since a growing loan balance should
  // read as a positive change (bad), not the negative net-worth-
  // contribution delta it actually is.
  const toRows = (deltas: AccountContributionDelta[], sign = 1) =>
    deltas
      .map((d) => ({ name: d.name, delta: sign * parseFloat(d.delta) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
  const changeBreakdowns: Record<StatKey, { name: string; delta: number }[]> = {
    networth: toRows(accountContributionDeltas),
    cash: toRows(accountContributionDeltas.filter((d) => d.group === "cash")),
    debt: toRows(accountContributionDeltas.filter((d) => d.group === "credit" || d.group === "loan"), -1),
    investments: toRows(accountContributionDeltas.filter((d) => d.group === "investment")),
  };
  // Which arrow direction reads as "good" for each card's change rows —
  // inverted for Debt, same as debtTrendingDown/debtSpark above.
  const changeGoodDirection: Record<StatKey, "up" | "down"> = {
    networth: "up",
    cash: "up",
    debt: "down",
    investments: "up",
  };

  function toggleStat(key: StatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  const donutData = spendingThisMonth.slice(0, 6).map((c, i) => ({
    label: c.category,
    value: parseFloat(c.amount),
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));
  // The center total matches what the ring itself visually sums to (the
  // top 6 categories charted), not spendingThisMonth's full, possibly
  // longer tail — so the number and the ring never disagree.
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const upcoming = recurring
    .filter((r) => parseFloat(r.amount) < 0)
    .slice()
    .sort((a, b) => (a.next_date < b.next_date ? -1 : 1))
    .slice(0, 5);

  const recent = transactions
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    .slice(0, 8);

  // Pinned-report widgets — condensed, read-only summaries of the same
  // sections that live on Cash Flow/Investments/Reports, each linking back
  // to the real tab rather than duplicating its full interactive controls.
  const topMerchantsList = (topCategoriesData?.top_merchants ?? []).slice(0, 5);
  const maxTopMerchant = topMerchantsList.length ? Math.max(...topMerchantsList.map((m) => parseFloat(m.amount))) : 0;

  const payoffDebtAccounts = accounts.filter((a) => {
    const g = groupOf(a.account_type);
    return (g === "credit" || g === "loan") && owedAmount(a) > 0 && !a.excluded_from_debt_payoff;
  });
  const totalOwed = payoffDebtAccounts.reduce((s, a) => s + owedAmount(a), 0);

  const holdingsByClass = new Map<string, number>();
  for (const h of holdings) {
    const key = h.asset_class ?? "Other";
    holdingsByClass.set(key, (holdingsByClass.get(key) ?? 0) + parseFloat(h.value));
  }
  const allocationData = Array.from(holdingsByClass.entries()).map(([label, value], i) => ({
    label,
    value,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));
  const allocationTotal = allocationData.reduce((s, d) => s + d.value, 0);

  const netWorthByMemberRows = netWorthByMember(accounts, assets);

  // Every widget's content, keyed by id — the layout array below just
  // decides which of these render, and in what order. Wrapping each
  // existing section here (unchanged) rather than restructuring them is
  // deliberate: the customization system should only ever reorder/hide
  // widgets, never change what's inside one.
  const widgetContent: Record<WidgetId, React.ReactNode> = {
    stats: (
      <>
        <div className="stats">
          <button
            type="button"
            className={expandedStat === "networth" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
            onClick={() => toggleStat("networth")}
          >
            <div className="stat-top">
              <div className="stat-top-main">
                <span className="stat-value">{fmtMoneyShort(netWorthWithAssets)}</span>
                <span className="stat-label">Net Worth</span>
              </div>
              <Sparkline points={netWorthSpark} color="var(--accent)" />
            </div>
            {monthsSpan > 1 && (
              <span className={netWorthDelta >= 0 ? "stat-delta up" : "stat-delta down"}>
                {netWorthDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(netWorthDelta))} over {monthsSpan}mo
              </span>
            )}
          </button>
          <button
            type="button"
            className={expandedStat === "cash" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
            onClick={() => toggleStat("cash")}
          >
            <div className="stat-top">
              <div className="stat-top-main">
                <span className="stat-value">{fmtMoneyShort(cash)}</span>
                <span className="stat-label">Cash</span>
              </div>
              <Sparkline points={cashSpark} color="var(--info)" />
            </div>
            {monthsSpan > 1 && (
              <span className={cashDelta >= 0 ? "stat-delta up" : "stat-delta down"}>
                {cashDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(cashDelta))} over {monthsSpan}mo
              </span>
            )}
          </button>
          <button
            type="button"
            className={expandedStat === "debt" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
            onClick={() => toggleStat("debt")}
          >
            <div className="stat-top">
              <div className="stat-top-main">
                <span
                  className={
                    debt === 0 ? "stat-value" : debtTrendingDown ? "stat-value report-good" : "stat-value report-over-budget"
                  }
                >
                  {fmtMoneyShort(debt)}
                </span>
                <span className="stat-label">Debt</span>
              </div>
              <Sparkline points={debtSpark} color={debtTrendingDown ? "var(--positive)" : "var(--negative)"} />
            </div>
            {monthsSpan > 1 && (
              <span className={debtDelta <= 0 ? "stat-delta up" : "stat-delta down"}>
                {debtDelta <= 0 ? "▼" : "▲"} {fmtMoneyShort(Math.abs(debtDelta))} over {monthsSpan}mo
              </span>
            )}
          </button>
          <button
            type="button"
            className={expandedStat === "investments" ? "stat stat-clickable stat-expanded" : "stat stat-clickable"}
            onClick={() => toggleStat("investments")}
          >
            <div className="stat-top">
              <div className="stat-top-main">
                <span className="stat-value">{fmtMoneyShort(investments)}</span>
                <span className="stat-label">Investments</span>
              </div>
              <Sparkline points={investmentsSpark} color="#8A5FB0" />
            </div>
            {monthsSpan > 1 && (
              <span className={investmentsDelta >= 0 ? "stat-delta up" : "stat-delta down"}>
                {investmentsDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(investmentsDelta))} over {monthsSpan}mo
              </span>
            )}
          </button>
        </div>

        <StatDetailPanel
          isOpen={expandedStat !== null}
          title={expandedStat ? STAT_LABELS[expandedStat] : null}
          rows={expandedStat ? breakdowns[expandedStat] : null}
          changeRows={expandedStat ? changeBreakdowns[expandedStat] : null}
          changeLabel={monthsSpan > 1 ? `over ${monthsSpan}mo` : undefined}
          changeGoodDirection={expandedStat ? changeGoodDirection[expandedStat] : "up"}
          emptyMessage="No accounts contribute to this yet."
          onClose={() => setExpandedStat(null)}
        />
      </>
    ),

    runway: monthsOfRunway !== null && (
      <div className="card runway-card">
        <ProgressRing pct={runwayPct} size={64} stroke={7} />
        <div>
          <p className="runway-headline">
            <span className="stat-value">{monthsOfRunway.toFixed(1)}</span> months of expenses covered
          </p>
          <p className="modal-message-secondary">
            {fmtMoneyShort(cash)} in liquid savings ÷ {fmtMoneyShort(avgSpendNum)}/mo average spend (trailing 90
            days).
          </p>
        </div>
      </div>
    ),

    needs_a_look: (
      <>
        {budgetAlerts.length > 0 && (
          <button type="button" className="budget-alert-banner" onClick={() => setShowBudgetAlerts((v) => !v)}>
            {overCount > 0 && `${overCount} categor${overCount === 1 ? "y" : "ies"} over budget`}
            {overCount > 0 && warningCount > 0 && ", "}
            {warningCount > 0 && `${warningCount} approaching ${warningCount === 1 ? "its" : "their"} limit`}
          </button>
        )}
        <StatDetailPanel
          isOpen={showBudgetAlerts}
          title={showBudgetAlerts ? "this month's budget alerts" : null}
          rows={
            showBudgetAlerts
              ? budgetAlerts.map((a) => ({ name: a.category, amount: parseFloat(a.budgeted) - parseFloat(a.actual) }))
              : null
          }
          emptyMessage="Nothing to flag."
          onClose={() => setShowBudgetAlerts(false)}
        />

        {insights.length > 0 && (
          <div className="card">
            <div className="card-head">
              <span className="reports-section-title">Insights</span>
            </div>
            <ul className="insights-list">
              {insights.map((insight, i) => (
                <li key={i} className={`insight-row insight-${insight.severity}`}>
                  <span className={`confidence-badge insight-badge-${insight.severity}`}>{insight.severity}</span>
                  <span>{insight.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    ),

    trend_spending: (
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Net worth trend</span>
          </div>
          <LineChart
            points={netWorthHistory.map((p) => ({ label: p.month_label, value: parseFloat(p.value) + assetsTotal }))}
            height={210}
          />
          <p className="account-col" style={{ marginTop: 8 }}>
            {netWorthDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(netWorthDelta))} over this period
          </p>
          {assetsTotal !== 0 && (
            <p className="modal-message-secondary" style={{ marginTop: 4 }}>
              Includes Property &amp; Valuables at their current value throughout — since they only carry a value as
              of today, past points assume that same value applied back then too.
            </p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Spending by category</span>
          </div>
          {donutData.length > 0 ? (
            <div className="donut-with-legend">
              <DonutChart
                data={donutData}
                size={132}
                center={{ value: fmtMoneyShort(donutTotal), label: "this month" }}
              />
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
    ),

    budget_bills: (
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
              <div
                key={group}
                className="clickable-row"
                style={{ marginBottom: 14, padding: 4, borderRadius: 6 }}
                onClick={onOpenBudget}
                title="Go to the Budget tab"
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{GROUP_LABELS[group]}</span>
                  <span className="account-col">
                    {formatAmount(actual)} of {formatAmount(budgeted)}
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
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
              <div
                className="suggested-row clickable-row"
                key={r.id}
                onClick={onOpenRecurring}
                title="Go to the Recurring tab"
              >
                <div className="suggested-info">
                  <div className="account-name-cell">{r.merchant}</div>
                  <span className="account-col">{r.next_date}</span>
                </div>
                <span className="suggested-amt">{formatAmount(r.amount)}</span>
              </div>
            ))
          ) : (
            <p className="empty-state">Nothing due soon.</p>
          )}
        </div>
      </div>
    ),

    recent_transactions: (
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
              <tr key={t.id} className="clickable-row" onClick={onOpenLedger} title="Go to the Ledger tab">
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
    ),

    top_merchants: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Top merchants</span>
        </div>
        {topMerchantsList.length > 0 ? (
          topMerchantsList.map((m) => (
            <div key={m.description} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{m.description}</span>
                <span className="amount-col">{formatAmount(m.amount)}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(parseFloat(m.amount) / maxTopMerchant) * 100}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="empty-state">No spending yet this month.</p>
        )}
        <div className="clickable-row" onClick={onOpenCashFlow} title="Go to the Cash Flow tab" style={{ marginTop: 4 }}>
          <span className="category-link">View Cash Flow →</span>
        </div>
      </div>
    ),

    debt_payoff: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Debt payoff planner</span>
        </div>
        {payoffDebtAccounts.length > 0 ? (
          <>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Debt</th>
                  <th className="amount-col">Balance</th>
                </tr>
              </thead>
              <tbody>
                {payoffDebtAccounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td className="amount-col">{formatAmount(owedAmount(a))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="modal-message-secondary" style={{ marginTop: 8 }}>
              {formatAmount(totalOwed)} total across {payoffDebtAccounts.length} debt
              {payoffDebtAccounts.length === 1 ? "" : "s"}.
            </p>
          </>
        ) : (
          <p className="empty-state">No debt to pay off — nice.</p>
        )}
        <div className="clickable-row" onClick={onOpenCashFlow} title="Go to the Cash Flow tab" style={{ marginTop: 4 }}>
          <span className="category-link">Open payoff planner →</span>
        </div>
      </div>
    ),

    allocation: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Allocation</span>
        </div>
        {allocationData.length > 0 ? (
          <div className="donut-with-legend">
            <DonutChart data={allocationData} size={132} />
            <div>
              {allocationData.map((d) => (
                <div className="chart-legend-item" key={d.label} style={{ marginBottom: 8 }}>
                  <span className="chart-legend-swatch" style={{ background: d.color }}></span>
                  {d.label}
                  <span className="account-col" style={{ marginLeft: "auto" }}>
                    {fmtMoneyShort(d.value)} ({allocationTotal ? ((d.value / allocationTotal) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-state">No holdings yet.</p>
        )}
        <div className="clickable-row" onClick={onOpenInvestments} title="Go to the Investments tab" style={{ marginTop: 4 }}>
          <span className="category-link">View Investments →</span>
        </div>
      </div>
    ),

    net_worth_by_member: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Net worth by member</span>
        </div>
        {familyMembers.length > 0 ? (
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
        ) : (
          <p className="empty-state">Add a family member in Settings to see this breakdown.</p>
        )}
        <div className="clickable-row" onClick={onOpenReports} title="Go to the Reports tab" style={{ marginTop: 4 }}>
          <span className="category-link">View Reports →</span>
        </div>
      </div>
    ),
  };

  function moveWidget(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= layoutWidgets.length) return;
    const next = [...layoutWidgets];
    [next[index], next[target]] = [next[target], next[index]];
    onSetLayoutWidgets(next);
  }

  function removeWidget(id: WidgetId) {
    onSetLayoutWidgets(layoutWidgets.filter((w) => w !== id));
  }

  // Same drag-and-drop convention as the sidebar nav's own reordering
  // (App.tsx's `handleNavDrop`/`dragNavTab`) — the ↑/↓ buttons above cover
  // the same ground for anyone who'd rather click than drag.
  function handleWidgetDrop(targetId: WidgetId) {
    if (!dragWidgetId || dragWidgetId === targetId) {
      setDragWidgetId(null);
      return;
    }
    const next = layoutWidgets.filter((id) => id !== dragWidgetId);
    next.splice(next.indexOf(targetId), 0, dragWidgetId);
    onSetLayoutWidgets(next);
    setDragWidgetId(null);
  }

  const presetKey = matchingLayoutPreset(layoutWidgets);

  return (
    <div className="reports-view">
      <LedgerQaBox
        onAsk={(question) =>
          answerLedgerQuestion(question, {
            transactions,
            categories,
            accounts,
            buckets,
            recurring,
            avgMonthlySpend,
            today: new Date(),
          })
        }
      />

      <div className="dashboard-toolbar">
        <select
          className="month-select"
          value={presetKey}
          title="Layout"
          onChange={(e) => onSetLayoutWidgets([...LAYOUT_PRESETS[e.target.value as LayoutPresetKey]])}
        >
          {(Object.keys(LAYOUT_PRESETS) as LayoutPresetKey[]).map((key) => (
            <option key={key} value={key}>
              {LAYOUT_PRESET_LABELS[key]}
            </option>
          ))}
          {presetKey === "custom" && (
            <option value="custom" disabled>
              Custom (unsaved)
            </option>
          )}
        </select>
        <button type="button" className="modal-secondary" onClick={() => setCustomizeMode((v) => !v)}>
          {customizeMode ? "Done" : "Customize"}
        </button>
      </div>

      {showChecklist && (
        <div className="card checklist-card">
          <div className="card-head">
            <span className="reports-section-title">Get started</span>
            <button type="button" className="status-dismiss" onClick={dismissChecklist} aria-label="Dismiss checklist">
              ×
            </button>
          </div>
          <ul className="checklist-list">
            {checklistSteps.map((step) => (
              <li key={step.label} className={step.done ? "checklist-step checklist-step-done" : "checklist-step"}>
                <button type="button" className="checklist-step-btn" onClick={step.onClick} disabled={step.done}>
                  <span className="checklist-step-check" aria-hidden="true">{step.done ? "✓" : ""}</span>
                  <span className="checklist-step-text">
                    <span className="checklist-step-label">{step.label}</span>
                    <span className="checklist-step-detail">{step.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {layoutWidgets.map((id, i) => (
        <div
          key={id}
          className={customizeMode ? "dashboard-widget-customizing" : undefined}
          draggable={customizeMode}
          onDragStart={() => setDragWidgetId(id)}
          onDragOver={(e) => customizeMode && e.preventDefault()}
          onDrop={() => handleWidgetDrop(id)}
          onDragEnd={() => setDragWidgetId(null)}
        >
          {customizeMode && (
            <div className="dashboard-widget-controls">
              <button type="button" className="modal-secondary" onClick={() => moveWidget(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </button>
              <button
                type="button"
                className="modal-secondary"
                onClick={() => moveWidget(i, 1)}
                disabled={i === layoutWidgets.length - 1}
                aria-label="Move down"
              >
                ↓
              </button>
              <button type="button" className="modal-secondary" onClick={() => removeWidget(id)} aria-label="Remove widget">
                ✕
              </button>
            </div>
          )}
          {widgetContent[id]}
        </div>
      ))}

      {customizeMode && (
        <button type="button" className="add-tile" onClick={onOpenAddWidget}>
          <span className="add-tile-plus" aria-hidden="true">+</span>
          Add widget…
        </button>
      )}
    </div>
  );
}
