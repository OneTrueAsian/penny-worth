// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  LAYOUT_PRESETS,
  STAT_WIDGET_IDS,
  WIDGET_CATALOG,
  accountWidgetId,
  bucketWidgetId,
  investmentWidgetId,
  loadCustomLayoutPresets,
  loadDashboardLayout,
  matchingLayoutPreset,
  parseWidgetId,
  saveCustomLayoutPresets,
  saveDashboardLayout,
  type WidgetId,
} from "./dashboardLayout";

const STORAGE_KEY = "meadow-dashboard-layout";

beforeEach(() => {
  localStorage.clear();
});

describe("WIDGET_CATALOG / DEFAULT_LAYOUT", () => {
  it("lists the 4 stat cards as their own core widgets", () => {
    for (const id of STAT_WIDGET_IDS) {
      const entry = WIDGET_CATALOG.find((w) => w.id === id);
      expect(entry?.group).toBe("core");
    }
  });

  it("puts the 4 stat cards first in the default layout, in net worth/cash/debt/investments order", () => {
    expect(DEFAULT_LAYOUT.slice(0, 4)).toEqual(["stat_net_worth", "stat_cash", "stat_debt", "stat_investments"]);
  });

  it("includes the 4 stat cards in every preset", () => {
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      for (const id of STAT_WIDGET_IDS) {
        expect(preset).toContain(id);
      }
    }
  });
});

describe("loadDashboardLayout", () => {
  it("returns the default layout when nothing is saved", () => {
    expect(loadDashboardLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("expands a legacy combined 'stats' entry into the 4 new ids, in place", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["needs_a_look", "stats", "runway"]));
    expect(loadDashboardLayout()).toEqual([
      "needs_a_look",
      "stat_net_worth",
      "stat_cash",
      "stat_debt",
      "stat_investments",
      "runway",
    ]);
  });

  it("drops unrecognized ids and falls back to default if nothing valid remains", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["not_a_real_widget"]));
    expect(loadDashboardLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("round-trips a layout already using the new per-stat ids", () => {
    const layout = ["stat_debt", "stat_cash", "recent_transactions"] as const;
    saveDashboardLayout([...layout]);
    expect(loadDashboardLayout()).toEqual([...layout]);
  });
});

describe("parameterized widget ids", () => {
  it("builds and parses an account widget id", () => {
    expect(accountWidgetId(7)).toBe("account:7");
    expect(parseWidgetId("account:7")).toEqual({ kind: "account", targetId: 7 });
  });

  it("builds and parses a bucket widget id", () => {
    expect(bucketWidgetId(3)).toBe("bucket:3");
    expect(parseWidgetId("bucket:3")).toEqual({ kind: "bucket", targetId: 3 });
  });

  it("builds and parses an investment widget id, keyed by account name", () => {
    expect(investmentWidgetId("Brokerage")).toBe("investment:Brokerage");
    expect(parseWidgetId("investment:Brokerage")).toEqual({ kind: "investment", accountName: "Brokerage" });
  });

  it("parses a fixed catalog id as 'fixed'", () => {
    expect(parseWidgetId("stat_cash")).toEqual({ kind: "fixed", id: "stat_cash" });
  });

  it("survives a round trip through loadDashboardLayout/saveDashboardLayout", () => {
    saveDashboardLayout(["stat_cash", accountWidgetId(7), bucketWidgetId(3), investmentWidgetId("Brokerage")]);
    expect(loadDashboardLayout()).toEqual(["stat_cash", "account:7", "bucket:3", "investment:Brokerage"]);
  });
});

describe("matchingLayoutPreset", () => {
  it("matches the default preset with the new per-stat ids", () => {
    expect(matchingLayoutPreset(DEFAULT_LAYOUT)).toBe("default");
  });

  it("reports 'custom' once the arrangement diverges from every preset", () => {
    expect(matchingLayoutPreset(["stat_net_worth", "runway"])).toBe("custom");
  });

  it("matches a saved custom preset, returned as custom:<name>", () => {
    const widgets: WidgetId[] = ["stat_net_worth", "runway"];
    expect(matchingLayoutPreset(widgets, [{ name: "My Report", widgets }])).toBe("custom:My Report");
  });

  it("still reports 'custom' when the arrangement matches no saved preset by name", () => {
    const widgets: WidgetId[] = ["stat_net_worth", "runway"];
    expect(matchingLayoutPreset(widgets, [{ name: "Other", widgets: ["stat_cash"] }])).toBe("custom");
  });
});

describe("loadCustomLayoutPresets / saveCustomLayoutPresets", () => {
  it("returns an empty list when nothing is saved", () => {
    expect(loadCustomLayoutPresets()).toEqual([]);
  });

  it("round-trips a saved custom preset", () => {
    const presets = [{ name: "Weekly check-in", widgets: ["stat_net_worth", "runway"] as WidgetId[] }];
    saveCustomLayoutPresets(presets);
    expect(loadCustomLayoutPresets()).toEqual(presets);
  });

  it("drops unrecognized widget ids from a saved preset, and drops the whole preset if nothing valid remains", () => {
    localStorage.setItem(
      "meadow-dashboard-custom-layouts",
      JSON.stringify([
        { name: "Half valid", widgets: ["stat_cash", "not_a_real_widget"] },
        { name: "All invalid", widgets: ["not_a_real_widget"] },
      ]),
    );
    expect(loadCustomLayoutPresets()).toEqual([{ name: "Half valid", widgets: ["stat_cash"] }]);
  });

  it("ignores malformed entries instead of throwing", () => {
    localStorage.setItem("meadow-dashboard-custom-layouts", JSON.stringify("not an array"));
    expect(loadCustomLayoutPresets()).toEqual([]);
  });
});
