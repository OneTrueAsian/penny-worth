/** Shared account-type grouping — used anywhere accounts are organized by
 * kind (Reports tab's account sections, the debt payoff planner, the
 * Ledger's account filter), so "what counts as Cash vs. Credit vs. Loan"
 * lives in exactly one place. */
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
