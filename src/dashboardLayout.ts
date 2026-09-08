import { verticalCompactor } from "react-grid-layout/core";

/** The always-available Dashboard widgets, plus the report sections that
 * can also be pinned onto the Dashboard from their home tab (Cash Flow,
 * Investments, Reports). "Pinning" and picking a widget from the "+ Add
 * widget" modal are the same operation — both just add the id to the
 * current layout — so there's no separate "unlocked" concept to track.
 *
 * Each of these is deliberately a single self-contained section — no
 * widget bundles more than one report inside itself — so every one can be
 * independently selected, moved, resized, or removed. ("Stat cards" used
 * to be one combined widget with all four figures inside; "Trend &
 * spending" and "Budget & bills" each used to bundle two reports side by
 * side. All three were split into their real pieces per direct QA
 * feedback — see "Dashboard testing findings" — since bundling defeated
 * the point of a free-form grid: a user couldn't move or drop just the
 * one report they cared about.) */
export type CoreWidgetId =
  | "stat_net_worth"
  | "stat_cash"
  | "stat_debt"
  | "stat_investments"
  | "runway"
  | "needs_a_look"
  | "net_worth_trend"
  | "spend_by_category"
  | "budget_report"
  | "upcoming_bills"
  | "recent_transactions";

export type PinnedReportWidgetId =
  | "top_merchants"
  | "debt_payoff"
  | "allocation"
  | "net_worth_by_member"
  | "income_vs_expenses"
  | "todays_gain_loss";

/** The fixed, always-the-same-shape widgets — the ones `WIDGET_CATALOG`,
 * `LAYOUT_PRESETS`, and the "+ Add widget" modal's list all enumerate. */
export type FixedWidgetId = CoreWidgetId | PinnedReportWidgetId;

/** A widget scoped to one specific account/bucket/investment account,
 * chosen by the user rather than picked from a fixed catalog. Holdings
 * have no `account_id` (InvestmentsView groups them by `account_name`
 * already), so investment widgets key by name — the same string that
 * page already treats as the account's identity. */
export type AccountWidgetId = `account:${number}`;
export type BucketWidgetId = `bucket:${number}`;
export type InvestmentWidgetId = `investment:${string}`;

export type WidgetId = FixedWidgetId | AccountWidgetId | BucketWidgetId | InvestmentWidgetId;

export function accountWidgetId(accountId: number): AccountWidgetId {
  return `account:${accountId}`;
}
export function bucketWidgetId(bucketId: number): BucketWidgetId {
  return `bucket:${bucketId}`;
}
export function investmentWidgetId(accountName: string): InvestmentWidgetId {
  return `investment:${accountName}`;
}

export function parseWidgetId(
  id: WidgetId,
):
  | { kind: "fixed"; id: FixedWidgetId }
  | { kind: "account"; targetId: number }
  | { kind: "bucket"; targetId: number }
  | { kind: "investment"; accountName: string } {
  if (id.startsWith("account:")) return { kind: "account", targetId: Number(id.slice("account:".length)) };
  if (id.startsWith("bucket:")) return { kind: "bucket", targetId: Number(id.slice("bucket:".length)) };
  if (id.startsWith("investment:")) return { kind: "investment", accountName: id.slice("investment:".length) };
  return { kind: "fixed", id: id as FixedWidgetId };
}

/** One widget's position and size in the Dashboard's free-form grid — same
 * shape `react-grid-layout` itself uses (`i`/`x`/`y`/`w`/`h`), so a saved
 * layout can be handed straight to `<GridLayout layout={...}>` with no
 * translation step. */
export type GridWidgetItem = { i: WidgetId; x: number; y: number; w: number; h: number };
export type DashboardGridLayout = GridWidgetItem[];

const GRID_COLS = 12;

// w/h chosen to roughly fit each section's real content at the grid's
// rowHeight (see DashboardView.tsx's gridConfig) — tuned visually, not
// exact. Sized generously enough that a widget's typical default content
// doesn't scroll inside its own card on first load (a widget still gets a
// safety-net scrollbar if a user shrinks it below its content's real
// height, or a widget's own optional detail panel is expanded — that's an
// active, temporary state, not the default view). Solo report widgets
// default to full width (12); a widget that used to sit side-by-side with
// its other half (Net worth trend / Spending by category, This month's
// budget / Upcoming bills) defaults to half width (6) so the pair still
// lands side by side by default, exactly like before the split.
const DEFAULT_SIZE: Record<FixedWidgetId, { w: number; h: number }> = {
  stat_net_worth: { w: 6, h: 4 },
  stat_cash: { w: 6, h: 4 },
  stat_debt: { w: 6, h: 4 },
  stat_investments: { w: 6, h: 4 },
  runway: { w: 12, h: 4 },
  needs_a_look: { w: 12, h: 9 },
  net_worth_trend: { w: 6, h: 8 },
  spend_by_category: { w: 6, h: 8 },
  budget_report: { w: 6, h: 9 },
  upcoming_bills: { w: 6, h: 9 },
  recent_transactions: { w: 12, h: 9 },
  top_merchants: { w: 12, h: 7 },
  debt_payoff: { w: 12, h: 9 },
  allocation: { w: 12, h: 7 },
  net_worth_by_member: { w: 12, h: 6 },
  income_vs_expenses: { w: 12, h: 10 },
  todays_gain_loss: { w: 6, h: 5 },
};
// Account/Bucket/Investment-account widgets default to a compact,
// stat-tile-sized footprint — 2 fit across a 12-column row. Deliberately
// wider than a 4-per-row (w:3) or 3-per-row (w:4) split would allow: the
// app's own default window (see tauri.conf.json) is only 800x600, and a
// narrower default clips a card's own balance/value text before the user
// ever gets a chance to resize anything.
const COMPACT_SIZE = { w: 6, h: 5 };

export function defaultSizeFor(id: WidgetId): { w: number; h: number } {
  const parsed = parseWidgetId(id);
  return parsed.kind === "fixed" ? DEFAULT_SIZE[parsed.id] : COMPACT_SIZE;
}

/** Lays out a flat, ordered id list by packing each widget left-to-right
 * at its own default width, wrapping to a new row once a row is full —
 * simple flow layout, not the vertical compactor (which operates on an
 * already-placed layout). A list of only full-width (w:12) ids — every
 * pre-grid saved layout, and most of `LAYOUT_PRESETS` — still produces
 * exactly the old single full-width column, one per row, since each item
 * alone fills the row. A run of narrower ids (the four stat cards) packs
 * side by side instead, up to `GRID_COLS` per row. */
function synthesizeGridFromOrderedIds(ids: WidgetId[]): DashboardGridLayout {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const items: DashboardGridLayout = [];
  for (const id of ids) {
    const { w, h } = defaultSizeFor(id);
    if (x + w > GRID_COLS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    items.push({ i: id, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return items;
}

/** `react-grid-layout`'s own `LayoutItem` (whether from its compactor or
 * its `onLayoutChange` callback) carries extra bookkeeping fields —
 * `moved`, `static`, and several `undefined` per-item overrides — that
 * `GridWidgetItem` doesn't declare. Strips back down to the plain shape
 * this app actually persists, so what's in localStorage never grows an
 * implicit dependency on the library's internal representation. */
export function toGridWidgetItems(items: readonly { i: string; x: number; y: number; w: number; h: number }[]): DashboardGridLayout {
  return items.map((item) => ({ i: item.i as WidgetId, x: item.x, y: item.y, w: item.w, h: item.h }));
}

/** Appends one new widget to `layout`, placed after everything else.
 * `y: Infinity` is `react-grid-layout`'s own convention for "put this
 * below the rest" — `verticalCompactor.compact` (the same compactor the
 * grid component itself runs on every change) resolves it to a concrete
 * row immediately, so what gets persisted is always finite, valid grid
 * coordinates rather than a literal `Infinity` (which `JSON.stringify`
 * would silently turn into `null`). */
export function appendWidgetToLayout(layout: DashboardGridLayout, id: WidgetId): DashboardGridLayout {
  const { w, h } = defaultSizeFor(id);
  const withNewItem: DashboardGridLayout = [...layout, { i: id, x: 0, y: Infinity, w, h }];
  return toGridWidgetItems(verticalCompactor.compact(withNewItem, GRID_COLS));
}

export const WIDGET_CATALOG: { id: FixedWidgetId; label: string; group: "stats" | "core" | "report" }[] = [
  { id: "stat_net_worth", label: "Net Worth", group: "stats" },
  { id: "stat_cash", label: "Cash", group: "stats" },
  { id: "stat_debt", label: "Debt", group: "stats" },
  { id: "stat_investments", label: "Investments", group: "stats" },
  { id: "runway", label: "Runway", group: "core" },
  { id: "needs_a_look", label: "Needs a look", group: "core" },
  { id: "net_worth_trend", label: "Net worth trend", group: "core" },
  { id: "spend_by_category", label: "Spending by category", group: "core" },
  { id: "budget_report", label: "This month's budget", group: "core" },
  { id: "upcoming_bills", label: "Upcoming bills", group: "core" },
  { id: "recent_transactions", label: "Recent transactions", group: "core" },
  { id: "top_merchants", label: "Top merchants", group: "report" },
  { id: "debt_payoff", label: "Debt payoff planner", group: "report" },
  { id: "allocation", label: "Allocation", group: "report" },
  { id: "net_worth_by_member", label: "Net worth by member", group: "report" },
  { id: "income_vs_expenses", label: "Income vs. expenses", group: "report" },
  { id: "todays_gain_loss", label: "Today's gain/loss", group: "report" },
];

const CATALOG_IDS = new Set(WIDGET_CATALOG.map((w) => w.id));

/** Widget ids retired when "Stat cards", "Trend & spending", and "Budget &
 * bills" were each split into their standalone pieces — kept only so a
 * layout saved before the split (either the legacy flat-array format or
 * today's grid format) still resolves to something instead of silently
 * losing the widget. Not part of `WIDGET_CATALOG` — nothing should ever
 * add one of these ids again. */
const LEGACY_EXPANSIONS: Partial<Record<string, FixedWidgetId[]>> = {
  stats: ["stat_net_worth", "stat_cash", "stat_debt", "stat_investments"],
  trend_spending: ["net_worth_trend", "spend_by_category"],
  budget_bills: ["budget_report", "upcoming_bills"],
};

/** Shape-only validity check — a well-formed id, not proof the target
 * account/bucket/investment account still exists. Existence is checked at
 * render time (DashboardView has the live data; this module doesn't), and
 * a dead reference is pruned from the saved layout once App.tsx notices
 * the target is gone. */
function isValidWidgetId(id: unknown): id is WidgetId {
  if (typeof id !== "string") return false;
  if (CATALOG_IDS.has(id as FixedWidgetId)) return true;
  if (/^(account|bucket):\d+$/.test(id)) return true;
  if (/^investment:.+$/.test(id)) return true;
  return false;
}

export const DEFAULT_LAYOUT: FixedWidgetId[] = [
  "stat_net_worth",
  "stat_cash",
  "stat_debt",
  "stat_investments",
  "runway",
  "needs_a_look",
  "net_worth_trend",
  "spend_by_category",
  "budget_report",
  "upcoming_bills",
  "recent_transactions",
];

// Presets are still authored as a simple ordered id list — the same shape
// as before the grid — and turned into a real grid layout at module load.
// Hand-placing 2D preset coordinates wouldn't buy anything a user can't
// already get by dragging afterward.
const LAYOUT_PRESET_IDS = {
  default: DEFAULT_LAYOUT,
  bills_focus: [
    "stat_net_worth",
    "stat_cash",
    "stat_debt",
    "stat_investments",
    "needs_a_look",
    "budget_report",
    "upcoming_bills",
    "debt_payoff",
    "recent_transactions",
  ],
  investor_focus: [
    "stat_net_worth",
    "stat_cash",
    "stat_debt",
    "stat_investments",
    "net_worth_trend",
    "spend_by_category",
    "allocation",
    "net_worth_by_member",
    "runway",
  ],
} satisfies Record<string, FixedWidgetId[]>;

export const LAYOUT_PRESETS: Record<keyof typeof LAYOUT_PRESET_IDS, DashboardGridLayout> = Object.fromEntries(
  Object.entries(LAYOUT_PRESET_IDS).map(([key, ids]) => [key, synthesizeGridFromOrderedIds(ids)]),
) as Record<keyof typeof LAYOUT_PRESET_IDS, DashboardGridLayout>;

export type LayoutPresetKey = keyof typeof LAYOUT_PRESET_IDS;

export const LAYOUT_PRESET_LABELS: Record<LayoutPresetKey, string> = {
  default: "Default",
  bills_focus: "Bills Focus",
  investor_focus: "Investor Focus",
};

// New key for the grid-shaped layout — OLD_STORAGE_KEY (the pre-grid,
// order-only array) is read once as a migration source and never written
// again, so an existing user's widget selection and order survive the
// upgrade exactly, just reshaped into a single-column grid on first load.
const STORAGE_KEY = "meadow-dashboard-grid-layout";
const OLD_STORAGE_KEY = "meadow-dashboard-layout";

/** Shape-only validity check for one grid item — a well-formed id plus
 * finite, positive size/position, not proof the target still exists (see
 * `isValidWidgetId`'s own comment for that half of validation). */
function isValidGridItem(item: unknown): item is GridWidgetItem {
  if (typeof item !== "object" || item === null) return false;
  const { i, x, y, w, h } = item as Record<string, unknown>;
  return (
    isValidWidgetId(i) &&
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof w === "number" &&
    Number.isFinite(w) &&
    w > 0 &&
    typeof h === "number" &&
    Number.isFinite(h) &&
    h > 0
  );
}

/** Replaces any retired id (see `LEGACY_EXPANSIONS`) found in a saved
 * grid-format layout with its modern replacements, laid out side by side
 * across the same space the retired widget used to occupy — so a user's
 * saved arrangement keeps its position on the board instead of the split
 * widgets silently vanishing. Items that aren't a legacy id pass through
 * completely untouched, position and all. */
function expandLegacyGridItems(items: unknown[]): unknown[] {
  return items.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [raw];
    const item = raw as Record<string, unknown>;
    const replacements = typeof item.i === "string" ? LEGACY_EXPANSIONS[item.i] : undefined;
    if (!replacements) return [raw];
    const x = typeof item.x === "number" ? item.x : 0;
    const y = typeof item.y === "number" ? item.y : 0;
    const h = typeof item.h === "number" && item.h > 0 ? item.h : defaultSizeFor(replacements[0]).h;
    const totalW = typeof item.w === "number" && item.w > 0 ? item.w : defaultSizeFor(replacements[0]).w * replacements.length;
    const w = Math.max(1, Math.floor(totalW / replacements.length));
    return replacements.map((id, i) => ({ i: id, x: x + i * w, y, w, h }));
  });
}

/** Same try/parse/catch-fallback shape as `loadNavOrder`/`theme` in
 * App.tsx — a per-viewer arrangement, not app data, so it lives in
 * localStorage. Drops any entry this build doesn't recognize (an unknown
 * id, or a malformed item) rather than erroring, expands any retired id
 * into its modern replacements (see `expandLegacyGridItems`), and
 * migrates a pre-grid saved layout (see `OLD_STORAGE_KEY`) the first time
 * it's read. */
export function loadDashboardLayout(): DashboardGridLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = expandLegacyGridItems(parsed).filter(isValidGridItem);
        if (filtered.length > 0) return filtered;
      }
    }
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      const oldParsed: unknown = JSON.parse(oldRaw);
      if (Array.isArray(oldParsed)) {
        const expandedIds = oldParsed.flatMap((id) => (typeof id === "string" ? (LEGACY_EXPANSIONS[id] ?? [id]) : [id]));
        const validIds = expandedIds.filter(isValidWidgetId);
        if (validIds.length > 0) return synthesizeGridFromOrderedIds(validIds);
      }
    }
  } catch {
    // fall through to the default layout below
  }
  return synthesizeGridFromOrderedIds(DEFAULT_LAYOUT);
}

export function saveDashboardLayout(layout: DashboardGridLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

/** Which named preset (if any) the current layout's widget *selection*
 * matches — position/size are deliberately ignored now that the grid is
 * free-form, since a user dragging or resizing one card would otherwise
 * fall out of "Default" immediately. Purely derived from `layout` rather
 * than tracked as its own piece of state, so there's no way for it to
 * drift out of sync with a hand-edited arrangement. */
export function matchingLayoutPreset(layout: DashboardGridLayout): LayoutPresetKey | "custom" {
  const ids = new Set(layout.map((item) => item.i));
  for (const key of Object.keys(LAYOUT_PRESETS) as LayoutPresetKey[]) {
    const presetIds = new Set(LAYOUT_PRESETS[key].map((item) => item.i));
    if (ids.size === presetIds.size && [...ids].every((id) => presetIds.has(id))) {
      return key;
    }
  }
  return "custom";
}
