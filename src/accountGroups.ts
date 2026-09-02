import type { Account } from "./types";

/** Shared account-type grouping — used anywhere accounts are organized by
 * kind (Accounts/Reports tabs' account sections, the debt payoff planner,
 * the Ledger's account filter), so "what counts as Cash vs. Credit vs.
 * Loan" lives in exactly one place. */
export const GROUP_ORDER = ["cash", "credit", "loan", "investment", "other"] as const;
export type AccountGroup = (typeof GROUP_ORDER)[number];
export const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: "Cash",
  credit: "Credit Cards",
  loan: "Loans",
  investment: "Investments",
  other: "Other Assets",
};

export function groupOf(accountType: string): AccountGroup {
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
 * account's balance counts in full — just negative. Shared between
 * AccountsView (its own assets/liabilities/net-worth stats) and
 * ReportsView (net worth by family member). */
export function netWorthContribution(a: Account): number {
  const group = groupOf(a.account_type);
  if (group === "credit") {
    return parseFloat(a.current_balance) - parseFloat(a.starting_balance);
  }
  if (group === "loan") {
    return -parseFloat(a.current_balance);
  }
  return parseFloat(a.current_balance);
}
