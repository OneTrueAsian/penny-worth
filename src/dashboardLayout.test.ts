// @vitest-environment jsdom
//
// loadDashboardLayout/saveDashboardLayout read and write real localStorage
// (see vitest.config.ts) — the default node environment has no such global.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  LAYOUT_PRESETS,
  accountWidgetId,
  appendWidgetToLayout,
  bucketWidgetId,
  defaultSizeFor,
  investmentWidgetId,
  loadDashboardLayout,
  matchingLayoutPreset,
  parseWidgetId,
  saveDashboardLayout,
  type DashboardGridLayout,
} from "./dashboardLayout";

const STORAGE_KEY = "meadow-dashboard-grid-layout";
const OLD_STORAGE_KEY = "meadow-dashboard-layout";

describe("parseWidgetId", () => {
  it("parses a fixed catalog id", () => {
    expect(parseWidgetId("stat_net_worth")).toEqual({ kind: "fixed", id: "stat_net_worth" });
    expect(parseWidgetId("allocation")).toEqual({ kind: "fixed", id: "allocation" });
  });

  it("round-trips an account id built by accountWidgetId", () => {
    const id = accountWidgetId(42);
    expect(id).toBe("account:42");
    expect(parseWidgetId(id)).toEqual({ kind: "account", targetId: 42 });
  });

  it("round-trips a bucket id built by bucketWidgetId", () => {
    const id = bucketWidgetId(7);
    expect(id).toBe("bucket:7");
    expect(parseWidgetId(id)).toEqual({ kind: "bucket", targetId: 7 });
  });

  it("round-trips an investment account id built by investmentWidgetId, name and all", () => {
    const id = investmentWidgetId("Fidelity 401k");
    expect(id).toBe("investment:Fidelity 401k");
    expect(parseWidgetId(id)).toEqual({ kind: "investment", accountName: "Fidelity 401k" });
  });
});

describe("defaultSizeFor", () => {
  it("gives a full-width solo report widget its own default", () => {
    expect(defaultSizeFor("recent_transactions")).toEqual({ w: 12, h: 9 });
    expect(defaultSizeFor("needs_a_look")).toEqual({ w: 12, h: 9 });
  });

  it("gives a stat card and a split-report half a half-width default", () => {
    expect(defaultSizeFor("stat_net_worth")).toEqual({ w: 6, h: 4 });
    expect(defaultSizeFor("net_worth_trend")).toEqual({ w: 6, h: 8 });
    expect(defaultSizeFor("spend_by_category")).toEqual({ w: 6, h: 8 });
    expect(defaultSizeFor("budget_report")).toEqual({ w: 6, h: 9 });
    expect(defaultSizeFor("upcoming_bills")).toEqual({ w: 6, h: 9 });
  });

  it("gives every parameterized widget the same compact default", () => {
    expect(defaultSizeFor(accountWidgetId(1))).toEqual({ w: 6, h: 5 });
    expect(defaultSizeFor(bucketWidgetId(1))).toEqual({ w: 6, h: 5 });
    expect(defaultSizeFor(investmentWidgetId("Fidelity 401k"))).toEqual({ w: 6, h: 5 });
  });
});

describe("loadDashboardLayout", () => {
  it("migrates a pre-grid flat ordered list (legacy key) into a row-packed grid", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify(["runway", "recent_transactions"]));
    const layout = loadDashboardLayout();
    expect(layout).toEqual([
      { i: "runway", x: 0, y: 0, w: 12, h: 4 },
      { i: "recent_transactions", x: 0, y: 4, w: 12, h: 9 },
    ]);
  });

  it("expands a retired bundled id (legacy key) into its modern split widgets", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify(["stats", "trend_spending", "budget_bills"]));
    const layout = loadDashboardLayout();
    expect(layout.map((item) => item.i)).toEqual([
      "stat_net_worth",
      "stat_cash",
      "stat_debt",
      "stat_investments",
      "net_worth_trend",
      "spend_by_category",
      "budget_report",
      "upcoming_bills",
    ]);
  });

  it("drops malformed/unrecognized ids from a legacy flat list during migration", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify(["runway", "not_a_real_widget", "account:"]));
    expect(loadDashboardLayout()).toEqual([{ i: "runway", x: 0, y: 0, w: 12, h: 4 }]);
  });

  it("falls back to the default layout when nothing valid is saved anywhere", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OLD_STORAGE_KEY);
    expect(loadDashboardLayout()).toEqual(LAYOUT_PRESETS.default);
  });

  it("reads a new-format grid layout directly, without touching the legacy key", () => {
    const layout: DashboardGridLayout = [{ i: "runway", x: 0, y: 0, w: 6, h: 2 }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify(["recent_transactions"]));
    expect(loadDashboardLayout()).toEqual(layout);
  });

  it("expands a retired bundled id found in an already-migrated (new-format) grid, in place", () => {
    const raw = [
      { i: "stats", x: 0, y: 0, w: 12, h: 4 },
      { i: "runway", x: 0, y: 4, w: 12, h: 4 },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const layout = loadDashboardLayout();
    // The 4 replacements exactly tile the space "stats" used to occupy —
    // same y, same total width — so nothing else on the board moves.
    expect(layout).toEqual([
      { i: "stat_net_worth", x: 0, y: 0, w: 3, h: 4 },
      { i: "stat_cash", x: 3, y: 0, w: 3, h: 4 },
      { i: "stat_debt", x: 6, y: 0, w: 3, h: 4 },
      { i: "stat_investments", x: 9, y: 0, w: 3, h: 4 },
      { i: "runway", x: 0, y: 4, w: 12, h: 4 },
    ]);
  });

  it("drops a malformed grid item (bad shape, negative size, unknown id)", () => {
    const raw = [
      { i: "runway", x: 0, y: 0, w: 6, h: 2 },
      { i: "recent_transactions", x: 0, y: 2, w: -1, h: 2 },
      { i: "not_a_real_widget", x: 0, y: 4, w: 3, h: 2 },
      "not even an object",
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(loadDashboardLayout()).toEqual([{ i: "runway", x: 0, y: 0, w: 6, h: 2 }]);
  });

  it("round-trips through saveDashboardLayout", () => {
    const layout: DashboardGridLayout = [
      { i: "runway", x: 0, y: 0, w: 6, h: 2 },
      { i: accountWidgetId(9), x: 6, y: 0, w: 3, h: 2 },
      { i: investmentWidgetId("Vanguard Brokerage"), x: 9, y: 0, w: 3, h: 2 },
    ];
    saveDashboardLayout(layout);
    expect(loadDashboardLayout()).toEqual(layout);
  });
});

describe("appendWidgetToLayout", () => {
  it("places a new widget after everything else, with finite coordinates", () => {
    const layout: DashboardGridLayout = [
      { i: "runway", x: 0, y: 0, w: 12, h: 3 },
      { i: "needs_a_look", x: 0, y: 3, w: 12, h: 4 },
    ];
    const next = appendWidgetToLayout(layout, accountWidgetId(1));
    const added = next.find((item) => item.i === accountWidgetId(1));
    expect(added).toBeDefined();
    expect(Number.isFinite(added!.y)).toBe(true);
    expect(added).toEqual({ i: accountWidgetId(1), x: 0, y: 7, w: 6, h: 5 });
    // Existing items are untouched.
    expect(next.find((item) => item.i === "runway")).toMatchObject({ x: 0, y: 0, w: 12, h: 3 });
  });

  it("survives a round-trip through JSON (no literal Infinity leaks into storage)", () => {
    const layout = appendWidgetToLayout([], "runway");
    const roundTripped = JSON.parse(JSON.stringify(layout));
    expect(roundTripped).toEqual(layout);
  });
});

describe("matchingLayoutPreset", () => {
  it("still matches the default preset exactly", () => {
    expect(matchingLayoutPreset(LAYOUT_PRESETS.default)).toBe("default");
  });

  it("still matches a named preset exactly", () => {
    expect(matchingLayoutPreset(LAYOUT_PRESETS.investor_focus)).toBe("investor_focus");
  });

  it("still matches a preset even after its widgets have been dragged/resized (position/size ignored)", () => {
    const rearranged = LAYOUT_PRESETS.default.map((item) => ({ ...item, x: item.x + 1, w: item.w - 1 }));
    expect(matchingLayoutPreset(rearranged)).toBe("default");
  });

  it("reports custom when the widget set differs from every preset", () => {
    expect(matchingLayoutPreset([...LAYOUT_PRESETS.default, { i: accountWidgetId(1), x: 0, y: 0, w: 3, h: 2 }])).toBe(
      "custom",
    );
  });
});

describe("synthesizeGridFromOrderedIds (via LAYOUT_PRESETS)", () => {
  it("packs the four stat cards side by side (2 per row) instead of stacking them", () => {
    const stats = LAYOUT_PRESETS.default.filter((item) => item.i.toString().startsWith("stat_"));
    expect(stats).toEqual([
      { i: "stat_net_worth", x: 0, y: 0, w: 6, h: 4 },
      { i: "stat_cash", x: 6, y: 0, w: 6, h: 4 },
      { i: "stat_debt", x: 0, y: 4, w: 6, h: 4 },
      { i: "stat_investments", x: 6, y: 4, w: 6, h: 4 },
    ]);
  });

  it("still stacks full-width (w:12) widgets one per row, exactly like the old single-column layout", () => {
    const runway = LAYOUT_PRESETS.default.find((item) => item.i === "runway")!;
    const needsALook = LAYOUT_PRESETS.default.find((item) => item.i === "needs_a_look")!;
    expect(runway.x).toBe(0);
    expect(needsALook.x).toBe(0);
    expect(needsALook.y).toBe(runway.y + runway.h);
  });

  it("packs a split report's two halves side by side at the same y", () => {
    const trend = LAYOUT_PRESETS.default.find((item) => item.i === "net_worth_trend")!;
    const spend = LAYOUT_PRESETS.default.find((item) => item.i === "spend_by_category")!;
    expect(trend.y).toBe(spend.y);
    expect(spend.x).toBe(trend.x + trend.w);
  });
});

// Keep for documentation purposes: DEFAULT_LAYOUT is the ordered id list
// LAYOUT_PRESETS.default and the legacy migration path are both built from.
describe("DEFAULT_LAYOUT", () => {
  it("matches LAYOUT_PRESETS.default's widget set", () => {
    expect(LAYOUT_PRESETS.default.map((item) => item.i)).toEqual(DEFAULT_LAYOUT);
  });
});
