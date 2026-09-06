/** The 6 always-available Dashboard widgets, plus the 4 report sections
 * that can also be pinned onto the Dashboard from their home tab (Cash
 * Flow, Investments, Reports). "Pinning" and picking a widget from the
 * "+ Add widget" modal are the same operation — both just add the id to
 * the current layout — so there's no separate "unlocked" concept to track. */
export type CoreWidgetId =
  | "stats"
  | "runway"
  | "needs_a_look"
  | "trend_spending"
  | "budget_bills"
  | "recent_transactions";

export type PinnedReportWidgetId = "top_merchants" | "debt_payoff" | "allocation" | "net_worth_by_member";

export type WidgetId = CoreWidgetId | PinnedReportWidgetId;

export const WIDGET_CATALOG: { id: WidgetId; label: string; group: "core" | "report" }[] = [
  { id: "stats", label: "Stat cards", group: "core" },
  { id: "runway", label: "Runway", group: "core" },
  { id: "needs_a_look", label: "Needs a look", group: "core" },
  { id: "trend_spending", label: "Trend & spending", group: "core" },
  { id: "budget_bills", label: "Budget & bills", group: "core" },
  { id: "recent_transactions", label: "Recent transactions", group: "core" },
  { id: "top_merchants", label: "Top merchants", group: "report" },
  { id: "debt_payoff", label: "Debt payoff planner", group: "report" },
  { id: "allocation", label: "Allocation", group: "report" },
  { id: "net_worth_by_member", label: "Net worth by member", group: "report" },
];

const CATALOG_IDS = new Set(WIDGET_CATALOG.map((w) => w.id));

export const DEFAULT_LAYOUT: WidgetId[] = [
  "stats",
  "runway",
  "needs_a_look",
  "trend_spending",
  "budget_bills",
  "recent_transactions",
];

export const LAYOUT_PRESETS = {
  default: DEFAULT_LAYOUT,
  bills_focus: ["stats", "needs_a_look", "budget_bills", "debt_payoff", "recent_transactions"],
  investor_focus: ["stats", "trend_spending", "allocation", "net_worth_by_member", "runway"],
} satisfies Record<string, WidgetId[]>;

export type LayoutPresetKey = keyof typeof LAYOUT_PRESETS;

export const LAYOUT_PRESET_LABELS: Record<LayoutPresetKey, string> = {
  default: "Default",
  bills_focus: "Bills Focus",
  investor_focus: "Investor Focus",
};

const STORAGE_KEY = "meadow-dashboard-layout";

/** Same try/parse/catch-fallback shape as `loadNavOrder`/`theme` in
 * App.tsx — a per-viewer arrangement, not app data, so it lives in
 * localStorage. Drops any id from a future/older version of the catalog
 * this build doesn't recognize, rather than erroring. */
export function loadDashboardLayout(): WidgetId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;
    const filtered = parsed.filter((id): id is WidgetId => CATALOG_IDS.has(id));
    return filtered.length > 0 ? filtered : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveDashboardLayout(widgets: WidgetId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

/** Which named preset (if any) the current layout exactly matches, by
 * order and contents — used to drive the Layout dropdown's selected value
 * and its "Custom (unsaved)" fallback. Purely derived from `widgets`
 * rather than tracked as its own piece of state, so there's no way for it
 * to drift out of sync with a hand-edited layout. */
export function matchingLayoutPreset(widgets: WidgetId[]): LayoutPresetKey | "custom" {
  for (const key of Object.keys(LAYOUT_PRESETS) as LayoutPresetKey[]) {
    const preset = LAYOUT_PRESETS[key];
    if (preset.length === widgets.length && preset.every((id, i) => id === widgets[i])) {
      return key;
    }
  }
  return "custom";
}
