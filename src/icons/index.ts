/** Every icon this app uses, pulled from one place. Three kinds live here,
 * each with its own file since their shapes genuinely differ:
 *
 * - `nounIcons.ts` / `credits.ts` — bundled Noun Project raster images
 *   (asset + CC BY 3.0 credit together) used by the three lookup tables
 *   below, plus the derived Settings ▸ Icon credits list.
 * - `navIcons.tsx` — hand-drawn SVG paths for the sidebar, with separate
 *   default/futuristic variants (no images, no credits needed).
 * - `accountIcons.tsx` / `categoryIcons.tsx` / `bucketIcons.tsx` /
 *   `budgetGroupIcons.tsx` — the domain-specific "which icon for this
 *   account/category/bucket/budget-group" lookups, each resolving to
 *   either a Noun Project image or a Lucide vector icon (`iconEntry.tsx`).
 *
 * Import from `"./icons"` (this file) rather than reaching into one of the
 * files above directly. */
export { NavIcon } from "./navIcons";
export { AccountTypeIcon } from "./accountIcons";
export { CategoryIcon, iconForCategory } from "./categoryIcons";
export { BucketIcon, iconForBucket, isBucketIconKey, BUCKET_ICON_OPTIONS, type BucketIconKey } from "./bucketIcons";
export { BudgetGroupIcon, iconForBudgetGroup } from "./budgetGroupIcons";
export { ICON_CREDITS, type IconCredit } from "./credits";
export { NOUN_ICONS, type NounIconId, type NounIcon } from "./nounIcons";
export { IconEntryGlyph, nounIconEntry, type IconEntry } from "./iconEntry";
