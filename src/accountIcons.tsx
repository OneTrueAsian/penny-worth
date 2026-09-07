import { CreditCard, HandCoins, Landmark, PiggyBank, TrendingUp, Wallet, type LucideIcon } from "lucide-react";

/** Keyed by the raw `account_type` string (`ACCOUNT_TYPE_OPTIONS` in
 * Modal.tsx: checking/savings/credit/loan/investment/other) rather than
 * `groupOf()`'s coarser cash/credit/loan/investment/other grouping, so
 * checking and savings — both "cash" to `groupOf` — still get visually
 * distinct icons. */
const ACCOUNT_TYPE_ICONS: Record<string, LucideIcon> = {
  checking: Wallet,
  savings: PiggyBank,
  credit: CreditCard,
  loan: HandCoins,
  investment: TrendingUp,
  other: Landmark,
};

export function iconForAccountType(accountType: string): LucideIcon {
  return ACCOUNT_TYPE_ICONS[accountType] ?? Landmark;
}

export function AccountTypeIcon({ accountType, className }: { accountType: string; className?: string }) {
  const Icon = iconForAccountType(accountType);
  return <Icon className={className} aria-hidden="true" />;
}
