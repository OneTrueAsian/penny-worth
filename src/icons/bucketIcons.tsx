import { Flag } from "lucide-react";
import { nounIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Keyword → icon, checked in order (first match wins) against a bucket's
 * name — same keyword-matched convention `categoryIcons.tsx` uses for
 * transaction categories, since a bucket's "kind" is likewise free text
 * (whatever the user typed when creating it, see BucketsView's
 * `NewBucketForm`), not a fixed enum. Only used when the bucket has no
 * explicit `icon_key` (see `BUCKET_ICON_OPTIONS` below) — the picker lets a
 * user override this guess, but leaves it as the default for anyone who
 * doesn't bother. */
const BUCKET_ICON_RULES: [RegExp, IconEntry][] = [
  [/(travel|vacation|trip|holiday)/i, nounIconEntry("travel-goal")],
  [/(home|house|renovation)/i, nounIconEntry("home-goal")],
  [/gift/i, nounIconEntry("gift-goal")],
  [/(laptop|computer|pc\b)/i, nounIconEntry("laptop-goal")],
];

const FALLBACK_ICON: IconEntry = { kind: "lucide", Icon: Flag };

export type BucketIconKey = "flag" | "travel" | "home" | "gift" | "laptop";

/** Every icon the picker offers, in display order — "flag" first as the
 * explicit "use the generic default" choice, matching the mockup's picker
 * (Flag swatch + the same travel/home/gift/laptop images already bundled
 * for automatic matching, reused rather than adding new image assets). */
export const BUCKET_ICON_OPTIONS: { key: BucketIconKey; entry: IconEntry }[] = [
  { key: "flag", entry: FALLBACK_ICON },
  { key: "travel", entry: nounIconEntry("travel-goal") },
  { key: "home", entry: nounIconEntry("home-goal") },
  { key: "gift", entry: nounIconEntry("gift-goal") },
  { key: "laptop", entry: nounIconEntry("laptop-goal") },
];

const BUCKET_ICON_BY_KEY: Record<BucketIconKey, IconEntry> = Object.fromEntries(
  BUCKET_ICON_OPTIONS.map((o) => [o.key, o.entry]),
) as Record<BucketIconKey, IconEntry>;

export function isBucketIconKey(key: string): key is BucketIconKey {
  return key in BUCKET_ICON_BY_KEY;
}

/** `iconKey` (a bucket's stored `icon_key`, if the user picked one
 * explicitly) always wins over the name-guessed default below — `null`/
 * `undefined`/an unrecognized value all fall back to the guess, so a
 * bucket created before this picker existed keeps looking exactly as it
 * did. */
export function iconForBucket(name: string, iconKey?: string | null): IconEntry {
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
  return <IconEntryGlyph entry={iconForBucket(name, iconKey)} className={className} />;
}
