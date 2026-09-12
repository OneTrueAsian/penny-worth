import {
  ArrowLeftRight,
  Baby,
  Dumbbell,
  Film,
  Gift,
  GraduationCap,
  Heart,
  HeartHandshake,
  HeartPulse,
  Home,
  PawPrint,
  Plane,
  Receipt,
  Shield,
  Sparkles,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  Zap,
} from "lucide-react";
import { nounIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Keyword → icon, checked in order (first match wins) against a
 * transaction/budget category name. Deliberately keyword-matched rather
 * than an exact-name lookup table: user-created categories are free text
 * (see CategoryPicker/`set_category`), so there's no fixed enum to key
 * off — this covers the app's own built-in categorization rules (see
 * core/src/rules.rs's default RuleSet) plus common variants, and falls
 * back to a generic tag icon for anything else rather than guessing.
 *
 * A mix of bundled Noun Project images (see `nounIcons.ts`) for the more
 * specific everyday categories, and Lucide vector icons for broader/
 * catch-all buckets — more specific rules are ordered before the broader
 * ones they were carved out of (e.g. "restaurant" before the general
 * dining rule, "car insurance" before general insurance) so first-match-
 * wins still resolves correctly. */
const CATEGORY_ICON_RULES: [RegExp, IconEntry][] = [
  [/pet/i, { kind: "lucide", Icon: PawPrint }],
  [/(mortgage|housing|household)/i, { kind: "lucide", Icon: Home }],
  [/rent/i, nounIconEntry("rent")],
  [/grocer/i, nounIconEntry("groceries")],
  [/(fuel|gas station)/i, nounIconEntry("fuel")],
  [/restaurant/i, nounIconEntry("restaurant")],
  [/(dining|coffee|cafe|takeout)/i, { kind: "lucide", Icon: UtensilsCrossed }],
  [/(transport|auto\b|parking)/i, nounIconEntry("transport")],
  [/electric/i, nounIconEntry("electric")],
  [/water/i, nounIconEntry("water")],
  [/(internet|wifi)/i, nounIconEntry("internet")],
  [/phone/i, nounIconEntry("phone")],
  [/utilit/i, { kind: "lucide", Icon: Zap }],
  [/streaming/i, nounIconEntry("streaming")],
  [/music/i, nounIconEntry("music")],
  [/(entertainment|movie|cinema)/i, { kind: "lucide", Icon: Film }],
  [/shopping/i, nounIconEntry("shopping")],
  [/(health|medical|doctor|pharmacy|dental)/i, { kind: "lucide", Icon: HeartPulse }],
  [/(car insurance|auto insurance)/i, nounIconEntry("car-insurance")],
  [/insurance/i, { kind: "lucide", Icon: Shield }],
  [/travel/i, { kind: "lucide", Icon: Plane }],
  [/(education|tuition|school)/i, { kind: "lucide", Icon: GraduationCap }],
  [/subscription/i, nounIconEntry("subscription")],
  [/(personal care|beauty|salon)/i, { kind: "lucide", Icon: Sparkles }],
  [/gift/i, { kind: "lucide", Icon: Gift }],
  [/(salary|paycheck)/i, nounIconEntry("salary")],
  [/(income|payroll|interest)/i, { kind: "lucide", Icon: Wallet }],
  [/fee/i, { kind: "lucide", Icon: Receipt }],
  [/transfer/i, { kind: "lucide", Icon: ArrowLeftRight }],
  [/(loan|debt)/i, nounIconEntry("credit-card")],
  [/(invest|brokerage|retirement)/i, { kind: "lucide", Icon: TrendingUp }],
  [/(child|kid|daycare)/i, { kind: "lucide", Icon: Baby }],
  [/(gym|fitness)/i, { kind: "lucide", Icon: Dumbbell }],
  [/(charity|donation)/i, { kind: "lucide", Icon: HeartHandshake }],
  [/love|romance/i, { kind: "lucide", Icon: Heart }],
];

const FALLBACK_ICON: IconEntry = { kind: "lucide", Icon: Tag };

export function iconForCategory(category: string | null | undefined): IconEntry {
  if (!category) return FALLBACK_ICON;
  for (const [pattern, entry] of CATEGORY_ICON_RULES) {
    if (pattern.test(category)) return entry;
  }
  return FALLBACK_ICON;
}

export function CategoryIcon({ category, className }: { category: string | null | undefined; className?: string }) {
  return <IconEntryGlyph entry={iconForCategory(category)} className={className} />;
}
