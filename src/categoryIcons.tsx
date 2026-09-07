import {
  ArrowLeftRight,
  Baby,
  Car,
  CreditCard,
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
  Repeat,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Keyword → icon, checked in order (first match wins) against a
 * transaction/budget category name. Deliberately keyword-matched rather
 * than an exact-name lookup table: user-created categories are free text
 * (see CategoryPicker/`set_category`), so there's no fixed enum to key
 * off — this covers the app's own built-in categorization rules (see
 * core/src/rules.rs's default RuleSet) plus common variants, and falls
 * back to a generic tag icon for anything else rather than guessing. */
const CATEGORY_ICON_RULES: [RegExp, LucideIcon][] = [
  [/pet/i, PawPrint],
  [/(rent|mortgage|housing|household)/i, Home],
  [/grocer/i, ShoppingCart],
  [/(dining|restaurant|coffee|cafe|takeout)/i, UtensilsCrossed],
  [/(transport|gas station|fuel|auto\b|parking)/i, Car],
  [/(utilit|electric|water bill|internet|phone bill)/i, Zap],
  [/(entertainment|movie|cinema|streaming|music)/i, Film],
  [/shopping/i, ShoppingBag],
  [/(health|medical|doctor|pharmacy|dental)/i, HeartPulse],
  [/insurance/i, Shield],
  [/travel/i, Plane],
  [/(education|tuition|school)/i, GraduationCap],
  [/subscription/i, Repeat],
  [/(personal care|beauty|salon)/i, Sparkles],
  [/gift/i, Gift],
  [/(income|payroll|salary|paycheck|interest)/i, Wallet],
  [/fee/i, Receipt],
  [/transfer/i, ArrowLeftRight],
  [/(loan|debt)/i, CreditCard],
  [/(invest|brokerage|retirement)/i, TrendingUp],
  [/(child|kid|daycare)/i, Baby],
  [/(gym|fitness)/i, Dumbbell],
  [/(charity|donation)/i, HeartHandshake],
  [/love|romance/i, Heart],
];

export function iconForCategory(category: string | null | undefined): LucideIcon {
  if (!category) return Tag;
  for (const [pattern, Icon] of CATEGORY_ICON_RULES) {
    if (pattern.test(category)) return Icon;
  }
  return Tag;
}

/** A small `currentColor` icon for a category name — sizing/coloring is
 * left to the caller's CSS (pass `className`), matching how `NavIcon`
 * (icons.tsx) stays theme-correct without hardcoding any color itself. */
export function CategoryIcon({ category, className }: { category: string | null | undefined; className?: string }) {
  const Icon = iconForCategory(category);
  return <Icon className={className} aria-hidden="true" />;
}
