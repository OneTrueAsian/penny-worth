import { Flag, type LucideIcon } from "lucide-react";
import travelGoalIcon from "./assets/icons/travel-goal.png";
import homeGoalIcon from "./assets/icons/home-goal.png";
import giftGoalIcon from "./assets/icons/gift-goal.png";
import laptopGoalIcon from "./assets/icons/laptop-goal.png";

type BucketIconEntry = { kind: "image"; src: string } | { kind: "lucide"; Icon: LucideIcon };

/** Keyword → icon, checked in order (first match wins) against a bucket's
 * name — same keyword-matched convention `categoryIcons.tsx` uses for
 * transaction categories, since a bucket's "kind" is likewise free text
 * (whatever the user typed when creating it, see BucketsView's
 * `NewBucketForm`), not a fixed enum. Only used when the bucket has no
 * explicit `icon_key` (see `BUCKET_ICON_OPTIONS` below) — the picker lets a
 * user override this guess, but leaves it as the default for anyone who
 * doesn't bother. Bundled Noun Project PNGs, credited in Settings ▸ Icon
 * credits. */
const BUCKET_ICON_RULES: [RegExp, BucketIconEntry][] = [
  [/(travel|vacation|trip|holiday)/i, { kind: "image", src: travelGoalIcon }],
  [/(home|house|renovation)/i, { kind: "image", src: homeGoalIcon }],
  [/gift/i, { kind: "image", src: giftGoalIcon }],
  [/(laptop|computer|pc\b)/i, { kind: "image", src: laptopGoalIcon }],
];

const FALLBACK_ICON: BucketIconEntry = { kind: "lucide", Icon: Flag };

export type BucketIconKey = "flag" | "travel" | "home" | "gift" | "laptop";

/** Every icon the picker offers, in display order — "flag" first as the
 * explicit "use the generic default" choice, matching the mockup's picker
 * (Flag swatch + the same travel/home/gift/laptop images already bundled
 * for automatic matching, reused rather than adding new image assets). */
export const BUCKET_ICON_OPTIONS: { key: BucketIconKey; entry: BucketIconEntry }[] = [
  { key: "flag", entry: FALLBACK_ICON },
  { key: "travel", entry: { kind: "image", src: travelGoalIcon } },
  { key: "home", entry: { kind: "image", src: homeGoalIcon } },
  { key: "gift", entry: { kind: "image", src: giftGoalIcon } },
  { key: "laptop", entry: { kind: "image", src: laptopGoalIcon } },
];

const BUCKET_ICON_BY_KEY: Record<BucketIconKey, BucketIconEntry> = Object.fromEntries(
  BUCKET_ICON_OPTIONS.map((o) => [o.key, o.entry]),
) as Record<BucketIconKey, BucketIconEntry>;

export function isBucketIconKey(key: string): key is BucketIconKey {
  return key in BUCKET_ICON_BY_KEY;
}

/** `iconKey` (a bucket's stored `icon_key`, if the user picked one
 * explicitly) always wins over the name-guessed default below — `null`/
 * `undefined`/an unrecognized value all fall back to the guess, so a
 * bucket created before this picker existed keeps looking exactly as it
 * did. */
export function iconForBucket(name: string, iconKey?: string | null): BucketIconEntry {
  if (iconKey && isBucketIconKey(iconKey)) return BUCKET_ICON_BY_KEY[iconKey];
  for (const [pattern, entry] of BUCKET_ICON_RULES) {
    if (pattern.test(name)) return entry;
  }
  return FALLBACK_ICON;
}

export function BucketIcon({
  name,
  iconKey,
  className,
}: {
  name: string;
  iconKey?: string | null;
  className?: string;
}) {
  const entry = iconForBucket(name, iconKey);
  if (entry.kind === "image") {
    return <img src={entry.src} alt="" className={className ? `${className} icon-img` : "icon-img"} aria-hidden="true" />;
  }
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden="true" />;
}
