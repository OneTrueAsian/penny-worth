import { Landmark, type LucideIcon } from "lucide-react";
import checkingIcon from "./assets/icons/checking.png";
import savingsIcon from "./assets/icons/savings.png";
import creditCardIcon from "./assets/icons/credit-card.png";
import loanIcon from "./assets/icons/loan.png";
import investmentIcon from "./assets/icons/investment.png";

type AccountIconEntry = { kind: "image"; src: string } | { kind: "lucide"; Icon: LucideIcon };

/** Keyed by the raw `account_type` string (`ACCOUNT_TYPE_OPTIONS` in
 * Modal.tsx: checking/savings/credit/loan/investment/other) rather than
 * `groupOf()`'s coarser cash/credit/loan/investment/other grouping, so
 * checking and savings — both "cash" to `groupOf` — still get visually
 * distinct icons. Bundled Noun Project PNGs (src/assets/icons/, credited
 * in Settings ▸ Icon credits) for every type with a good match; "other" has
 * no equivalent in that set (it's a catch-all, not a specific account
 * shape) so it keeps the existing Lucide icon. */
const ACCOUNT_TYPE_ICONS: Record<string, AccountIconEntry> = {
  checking: { kind: "image", src: checkingIcon },
  savings: { kind: "image", src: savingsIcon },
  credit: { kind: "image", src: creditCardIcon },
  loan: { kind: "image", src: loanIcon },
  investment: { kind: "image", src: investmentIcon },
  other: { kind: "lucide", Icon: Landmark },
};

const FALLBACK_ICON: AccountIconEntry = { kind: "lucide", Icon: Landmark };

export function AccountTypeIcon({ accountType, className }: { accountType: string; className?: string }) {
  const entry = ACCOUNT_TYPE_ICONS[accountType] ?? FALLBACK_ICON;
  if (entry.kind === "image") {
    return <img src={entry.src} alt="" className={className ? `${className} icon-img` : "icon-img"} aria-hidden="true" />;
  }
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden="true" />;
}
