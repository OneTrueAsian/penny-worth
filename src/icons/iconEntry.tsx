import type { LucideIcon } from "lucide-react";
import { NOUN_ICONS, type NounIconId } from "./nounIcons";

/** One resolved icon choice — either a bundled Noun Project image or a
 * Lucide vector icon — shared by accountIcons.tsx/categoryIcons.tsx/
 * bucketIcons.tsx's lookup tables, which each map a domain concept
 * (account type, category name, bucket) to one of these. */
export type IconEntry = { kind: "image"; src: string } | { kind: "lucide"; Icon: LucideIcon };

/** Shorthand for `{ kind: "image", src: NOUN_ICONS[id].src }` — every
 * image `IconEntry` in this app's lookup tables ultimately points at a
 * `NOUN_ICONS` id, never a raw import, so there's exactly one place
 * (`nounIcons.ts`) that touches `assets/icons/*.png` directly. */
export function nounIconEntry(id: NounIconId): IconEntry {
  return { kind: "image", src: NOUN_ICONS[id].src };
}

/** Renders whichever kind of `IconEntry` it's given — sizing/coloring is
 * left to the caller's CSS (`className`). A Lucide icon recolors via
 * `currentColor` on its own; a bundled PNG gets the `icon-img` class
 * instead, which only handles staying visible (a dark-mode invert) — see
 * `.icon-img` in App.css. */
export function IconEntryGlyph({ entry, className }: { entry: IconEntry; className?: string }) {
  if (entry.kind === "image") {
    return <img src={entry.src} alt="" className={className ? `${className} icon-img` : "icon-img"} aria-hidden="true" />;
  }
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden="true" />;
}
