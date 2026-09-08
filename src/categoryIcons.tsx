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
  type LucideIcon,
} from "lucide-react";
import groceriesIcon from "./assets/icons/groceries.png";
import fuelIcon from "./assets/icons/fuel.png";
import restaurantIcon from "./assets/icons/restaurant.png";
import transportIcon from "./assets/icons/transport.png";
import electricIcon from "./assets/icons/electric.png";
import waterIcon from "./assets/icons/water.png";
import internetIcon from "./assets/icons/internet.png";
import phoneIcon from "./assets/icons/phone.png";
import streamingIcon from "./assets/icons/streaming.png";
import musicIcon from "./assets/icons/music.png";
import shoppingIcon from "./assets/icons/shopping.png";
import carInsuranceIcon from "./assets/icons/car-insurance.png";
import subscriptionIcon from "./assets/icons/subscription.png";
import salaryIcon from "./assets/icons/salary.png";
import rentIcon from "./assets/icons/rent.png";
import creditCardIcon from "./assets/icons/credit-card.png";

type CategoryIconEntry = { kind: "image"; src: string } | { kind: "lucide"; Icon: LucideIcon };

/** Keyword → icon, checked in order (first match wins) against a
 * transaction/budget category name. Deliberately keyword-matched rather
 * than an exact-name lookup table: user-created categories are free text
 * (see CategoryPicker/`set_category`), so there's no fixed enum to key
 * off — this covers the app's own built-in categorization rules (see
 * core/src/rules.rs's default RuleSet) plus common variants, and falls
 * back to a generic tag icon for anything else rather than guessing.
 *
 * A mix of bundled Noun Project PNGs (src/assets/icons/, credited in
 * Settings ▸ Icon credits) for the more specific everyday categories, and
 * the original Lucide vector icons for broader/catch-all buckets — more
 * specific rules are ordered before the broader ones they were carved out
 * of (e.g. "restaurant" before the general dining rule, "car insurance"
 * before general insurance) so first-match-wins still resolves correctly. */
const CATEGORY_ICON_RULES: [RegExp, CategoryIconEntry][] = [
  [/pet/i, { kind: "lucide", Icon: PawPrint }],
  [/(mortgage|housing|household)/i, { kind: "lucide", Icon: Home }],
  [/rent/i, { kind: "image", src: rentIcon }],
  [/grocer/i, { kind: "image", src: groceriesIcon }],
  [/(fuel|gas station)/i, { kind: "image", src: fuelIcon }],
  [/restaurant/i, { kind: "image", src: restaurantIcon }],
  [/(dining|coffee|cafe|takeout)/i, { kind: "lucide", Icon: UtensilsCrossed }],
  [/(transport|auto\b|parking)/i, { kind: "image", src: transportIcon }],
  [/electric/i, { kind: "image", src: electricIcon }],
  [/water/i, { kind: "image", src: waterIcon }],
  [/(internet|wifi)/i, { kind: "image", src: internetIcon }],
  [/phone/i, { kind: "image", src: phoneIcon }],
  [/utilit/i, { kind: "lucide", Icon: Zap }],
  [/streaming/i, { kind: "image", src: streamingIcon }],
  [/music/i, { kind: "image", src: musicIcon }],
  [/(entertainment|movie|cinema)/i, { kind: "lucide", Icon: Film }],
  [/shopping/i, { kind: "image", src: shoppingIcon }],
  [/(health|medical|doctor|pharmacy|dental)/i, { kind: "lucide", Icon: HeartPulse }],
  [/(car insurance|auto insurance)/i, { kind: "image", src: carInsuranceIcon }],
  [/insurance/i, { kind: "lucide", Icon: Shield }],
  [/travel/i, { kind: "lucide", Icon: Plane }],
  [/(education|tuition|school)/i, { kind: "lucide", Icon: GraduationCap }],
  [/subscription/i, { kind: "image", src: subscriptionIcon }],
  [/(personal care|beauty|salon)/i, { kind: "lucide", Icon: Sparkles }],
  [/gift/i, { kind: "lucide", Icon: Gift }],
  [/(salary|paycheck)/i, { kind: "image", src: salaryIcon }],
  [/(income|payroll|interest)/i, { kind: "lucide", Icon: Wallet }],
  [/fee/i, { kind: "lucide", Icon: Receipt }],
  [/transfer/i, { kind: "lucide", Icon: ArrowLeftRight }],
  [/(loan|debt)/i, { kind: "image", src: creditCardIcon }],
  [/(invest|brokerage|retirement)/i, { kind: "lucide", Icon: TrendingUp }],
  [/(child|kid|daycare)/i, { kind: "lucide", Icon: Baby }],
  [/(gym|fitness)/i, { kind: "lucide", Icon: Dumbbell }],
  [/(charity|donation)/i, { kind: "lucide", Icon: HeartHandshake }],
  [/love|romance/i, { kind: "lucide", Icon: Heart }],
];

const FALLBACK_ICON: CategoryIconEntry = { kind: "lucide", Icon: Tag };

export function iconForCategory(category: string | null | undefined): CategoryIconEntry {
  if (!category) return FALLBACK_ICON;
  for (const [pattern, entry] of CATEGORY_ICON_RULES) {
    if (pattern.test(category)) return entry;
  }
  return FALLBACK_ICON;
}

/** A small icon for a category name — sizing/coloring is left to the
 * caller's CSS (pass `className`), matching how `NavIcon` (icons.tsx)
 * stays theme-correct without hardcoding any color itself. The Lucide
 * half of the rule set still recolors via `currentColor`; the bundled PNG
 * half gets the `icon-img` class instead, which only handles staying
 * visible (a dark-mode invert) — see the `.icon-img` rule in App.css. */
export function CategoryIcon({ category, className }: { category: string | null | undefined; className?: string }) {
  const entry = iconForCategory(category);
  if (entry.kind === "image") {
    return <img src={entry.src} alt="" className={className ? `${className} icon-img` : "icon-img"} aria-hidden="true" />;
  }
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden="true" />;
}
