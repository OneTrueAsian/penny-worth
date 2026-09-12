import { Landmark } from "lucide-react";
import { nounIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Keyed by the raw `account_type` string (`ACCOUNT_TYPE_OPTIONS` in
 * Modal.tsx: checking/savings/credit/loan/investment/other) rather than
 * `groupOf()`'s coarser cash/credit/loan/investment/other grouping, so
 * checking and savings — both "cash" to `groupOf` — still get visually
 * distinct icons. A bundled Noun Project image (see `nounIcons.ts`) for
 * every type with a good match; "other" has no equivalent in that set
 * (it's a catch-all, not a specific account shape) so it keeps a Lucide
 * icon instead. */
const ACCOUNT_TYPE_ICONS: Record<string, IconEntry> = {
  checking: nounIconEntry("checking"),
  savings: nounIconEntry("savings"),
  credit: nounIconEntry("credit-card"),
  loan: nounIconEntry("loan"),
  investment: nounIconEntry("investment"),
  other: { kind: "lucide", Icon: Landmark },
};

const FALLBACK_ICON: IconEntry = { kind: "lucide", Icon: Landmark };

export function AccountTypeIcon({ accountType, className }: { accountType: string; className?: string }) {
  const entry = ACCOUNT_TYPE_ICONS[accountType] ?? FALLBACK_ICON;
  return <IconEntryGlyph entry={entry} className={className} />;
}
