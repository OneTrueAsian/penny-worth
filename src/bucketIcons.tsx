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
 * `NewBucketForm`), not a fixed enum. Falls back to a generic flag (the
 * icon already used for the Buckets nav item) for anything else, rather
 * than guessing. Bundled Noun Project PNGs, credited in Settings ▸ Icon
 * credits. */
const BUCKET_ICON_RULES: [RegExp, BucketIconEntry][] = [
  [/(travel|vacation|trip|holiday)/i, { kind: "image", src: travelGoalIcon }],
  [/(home|house|renovation)/i, { kind: "image", src: homeGoalIcon }],
  [/gift/i, { kind: "image", src: giftGoalIcon }],
  [/(laptop|computer|pc\b)/i, { kind: "image", src: laptopGoalIcon }],
];

const FALLBACK_ICON: BucketIconEntry = { kind: "lucide", Icon: Flag };

export function iconForBucket(name: string): BucketIconEntry {
  for (const [pattern, entry] of BUCKET_ICON_RULES) {
    if (pattern.test(name)) return entry;
  }
  return FALLBACK_ICON;
}

export function BucketIcon({ name, className }: { name: string; className?: string }) {
  const entry = iconForBucket(name);
  if (entry.kind === "image") {
    return <img src={entry.src} alt="" className={className ? `${className} icon-img` : "icon-img"} aria-hidden="true" />;
  }
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden="true" />;
}
