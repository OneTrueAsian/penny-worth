import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import pennyWorthIcon from "./assets/penny-worth-icon-1024.png";
import { toCsv } from "./csv";
import { buildSetupTemplate } from "./setupTemplate";
import { CHANGELOG } from "./changelog";
import {
  CategoryTransactionsDialog,
  ConfirmInvertDialog,
  ManageCategoriesDialog,
  ManageFamilyMembersDialog,
  MonthExpenseDetailDialog,
  NewAccountDialog,
  NewCategoryDialog,
  NewTransactionDialog,
  UseExistingDataFileDialog,
  WelcomeDialog,
  WhatsNewDialog,
} from "./Modal";
import { AccountsView } from "./AccountsView";
import { BucketsView } from "./BucketsView";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { BudgetView } from "./BudgetView";
import { ReportsView } from "./ReportsView";
import { SettingsView } from "./SettingsView";
import { CADENCE_OPTIONS, RecurringView } from "./RecurringView";
import { InvestmentsView } from "./InvestmentsView";
import { CashFlowView } from "./CashFlowView";
import { DashboardView } from "./DashboardView";
import { HelpView } from "./HelpView";
import { AccountFilterDropdown, type AccountFilterValue } from "./AccountFilterDropdown";
import { MemberFilterDropdown, type MemberFilterValue } from "./MemberFilterDropdown";
import { MoreFiltersPopover } from "./MoreFiltersPopover";
import { UpdateBanner } from "./UpdateBanner";
import { NavIcon } from "./icons";
import { formatAmount, toLocalIsoDate } from "./format";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { useDelayedVisibility } from "./useDelayedVisibility";
import type {
  Account,
  AnomalyFlag,
  Asset,
  Backup,
  Bucket,
  BudgetAlert,
  CashFlow,
  CategoryAmount,
  CategoryTransaction,
  DebtPayoffPlan,
  FamilyMember,
  ForecastPoint,
  Holding,
  Insight,
  LivePriceProviderId,
  LivePriceRefreshSummary,
  LivePriceSettings,
  MonthExpenseDetail,
  NetWorthPoint,
  Profile,
  Recurring,
  RecurringCandidate,
  Report,
  ReportBudgetLine,
  RolledAccount,
  SetupImportPreview,
  SetupImportSummary,
  Transaction,
  TransactionSplit,
  YoyCashFlow,
} from "./types";
import "./App.css";

type ImportSummary = {
  inserted: number;
  row_errors: number;
};

type ImportRow = {
  index: number;
  date: string;
  description: string;
  amount: string;
  is_duplicate: boolean;
  /** The row's own Account column, when the file has one — this app's own
   * Ledger CSV export does. `commit_import` routes the row there by
   * default (creating that account if none matches by name) unless the
   * row's dropdown is changed. */
  account_name: string | null;
};

type ImportPreview = {
  rows: ImportRow[];
  row_errors: number;
};

type PendingImport = {
  path: string;
  invertAmounts: boolean;
  defaultAccountId: number;
  preview: ImportPreview;
};

type Stats = {
  total: number;
  auto_categorized: number;
  user_confirmed: number;
  uncategorized: number;
};

type NewAccountResult = {
  name: string;
  accountType: string;
  startingBalance: string | null;
  institution: string | null;
  mask: string | null;
  memberId: number | null;
};

type PendingDialog =
  | {
      kind: "newAccount";
      resolve: (result: NewAccountResult | null) => void;
    }
  | { kind: "newCategory"; resolve: (name: string | null) => void }
  | { kind: "confirmInvert"; resolve: (invert: boolean) => void };

type Tab =
  | "dashboard"
  | "accounts"
  | "ledger"
  | "buckets"
  | "budget"
  | "cashflow"
  | "reports"
  | "recurring"
  | "investments"
  | "settings"
  | "help";

/** Groups the sidebar organizes its (reorderable) tabs under — Settings
 * and Help are pinned below these instead of belonging to a group, so
 * they're never part of the drag-to-reorder set (see `PINNED_NAV_ITEMS`). */
type NavGroup = "overview" | "money" | "planning" | "insights";
const NAV_GROUP_ORDER: NavGroup[] = ["overview", "money", "planning", "insights"];
const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  overview: "Overview",
  money: "Money",
  planning: "Planning",
  insights: "Insights",
};

type Theme = "light" | "dark" | "system";

type StatusKind = "success" | "error" | "info";

type LedgerSortColumn = "date" | "description" | "amount" | "account" | "category" | "source";

function compareTransactionsBy(a: Transaction, b: Transaction, column: LedgerSortColumn): number {
  switch (column) {
    case "date":
      return a.date.localeCompare(b.date);
    case "description":
      return a.description.localeCompare(b.description);
    case "amount":
      return parseFloat(a.amount) - parseFloat(b.amount);
    case "account":
      return a.account_name.localeCompare(b.account_name);
    case "category":
      return (a.category ?? "").localeCompare(b.category ?? "");
    case "source":
      return (a.category_source ?? "").localeCompare(b.category_source ?? "");
  }
}

/** What deleting a transaction will do to its account's number, worded to
 * match what that account actually displays — "balance" for cash/other
 * accounts, "amount owed" for credit/loan (see AccountsView's identical
 * framing). A credit account's tracked value is *available* credit, not
 * owed (owed = limit − available), so removing a negative (spending)
 * transaction there raises available and therefore *lowers* what's owed —
 * the opposite direction from every other account type, where the tracked
 * value and "owed" move together. Returns `null` for a zero amount (no
 * impact to explain) or an unknown account. */
function describeDeleteImpact(amount: string, account: Account | undefined): string | null {
  if (!account) return null;
  const parsed = parseFloat(amount);
  if (Number.isNaN(parsed) || parsed === 0) return null;

  const isCredit = account.account_type === "credit";
  const isLoan = account.account_type === "loan";
  const label = isCredit || isLoan ? "amount owed" : "balance";
  const trackedValueGoesUp = parsed < 0; // removing a negative (expense) frees up that much
  const displayedNumberGoesUp = isCredit ? !trackedValueGoesUp : trackedValueGoesUp;
  const direction = displayedNumberGoesUp ? "increase" : "decrease";
  return `Deleting this will ${direction} ${account.name}'s ${label} by ${formatAmount(Math.abs(parsed).toFixed(2))}.`;
}

/** The sidebar's reorderable tabs — grouped for display (see `NavGroup`)
 * but reordered as one flat sequence via drag-and-drop; rendering then
 * re-partitions that sequence by `group`, so a drag effectively only ever
 * reorders within its own group (dropping across a group boundary changes
 * the stored order but never moves an item out of its group visually) —
 * this keeps the mental model of the grouped redesign intact without
 * needing separate per-group order state. Settings and Help are pinned
 * outside this entirely (see `PINNED_NAV_ITEMS`), not reorderable. */
const NAV_ITEMS: { id: Tab; label: string; icon: string; group: NavGroup }[] = [
  { id: "dashboard", label: "Dashboard", icon: "home", group: "overview" },
  { id: "accounts", label: "Accounts", icon: "bank", group: "money" },
  { id: "ledger", label: "Ledger", icon: "swap", group: "money" },
  { id: "recurring", label: "Recurring", icon: "repeat", group: "money" },
  { id: "budget", label: "Budget", icon: "pie", group: "planning" },
  { id: "buckets", label: "Buckets", icon: "flag", group: "planning" },
  { id: "cashflow", label: "Cash Flow", icon: "trend", group: "insights" },
  { id: "investments", label: "Investments", icon: "barchart", group: "insights" },
  { id: "reports", label: "Reports", icon: "wallet", group: "insights" },
];

/** Fixed, non-reorderable — rendered below a divider, outside every
 * group. */
const PINNED_NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "help", label: "Help", icon: "help" },
];

const THEME_STORAGE_KEY = "meadow-theme";
const NAV_ORDER_STORAGE_KEY = "meadow-nav-order";
const SAVED_FILTERS_STORAGE_KEY = "meadow-saved-ledger-filters";

/** A named snapshot of the Ledger's filter bar — a per-viewer shortcut,
 * same localStorage tier as theme/nav order. `filterAccountIds`/
 * `filterMemberIds` are stored as plain arrays (`Set` doesn't survive
 * `JSON.stringify`) and rehydrated back to `Set`s on apply — see
 * `applySavedFilter`. A saved account/category/tag that's since been
 * deleted just matches nothing once applied, the same as typing a filter
 * that happens to match zero rows — nothing here needs it to still exist. */
type SavedLedgerFilter = {
  name: string;
  searchText: string;
  filterCategory: string;
  filterAccountIds: number[] | "all";
  filterMemberIds: number[] | "all";
  filterFrom: string;
  filterTo: string;
  filterTag: string;
};

function loadSavedFilters(): SavedLedgerFilter[] {
  try {
    const stored = localStorage.getItem(SAVED_FILTERS_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed as SavedLedgerFilter[];
    }
  } catch {
    // corrupt/unavailable storage — fall back to no saved filters
  }
  return [];
}

function saveSavedFilters(filters: SavedLedgerFilter[]) {
  try {
    localStorage.setItem(SAVED_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

/** Reads the sidebar's saved custom order — a per-viewer UI preference,
 * same as theme, so it lives in localStorage rather than the database.
 * Unknown ids (an old order from a build with different tabs) are
 * dropped; any tab missing from a stored order (a new tab shipped since
 * the user last reordered) is appended at the end rather than hidden. */
function loadNavOrder(): Tab[] {
  const known = NAV_ITEMS.map((item) => item.id);
  try {
    const stored = localStorage.getItem(NAV_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((id): id is Tab => known.includes(id as Tab));
        const missing = known.filter((id) => !filtered.includes(id));
        return [...filtered, ...missing];
      }
    }
  } catch {
    // corrupt/unavailable storage — fall back to the default order
  }
  return known;
}

/** The one status line shared by every success confirmation, error, and
 * in-progress message in the app (~90+ call sites) — styled by `kind` so an
 * error doesn't look identical to a routine confirmation (see App.css's
 * `.status-*` rules), with its own dismiss button since errors stay up
 * longer than the auto-dismiss timer and a raw error string is worth being
 * able to clear once read. */
function StatusBanner({
  text,
  kind,
  action,
  onDismiss,
}: {
  text: string;
  kind: StatusKind;
  /** An optional extra button (e.g. "Undo") next to the dismiss ×, as a
   * sibling — not nested inside it, so it's independently clickable/
   * focusable. Used by the Ledger's bulk-delete undo toast, which is its
   * own independent piece of state from `status` (see `undoToast` below)
   * precisely so a routine confirmation elsewhere can't clobber an active
   * undo window — both just render through this one shared component. */
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  return (
    <p className={`status status-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === "success" && <path d="M20 6 9 17l-5-5" />}
        {kind === "error" && <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>}
        {kind === "info" && <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>}
      </svg>
      <span className="status-text">{text}</span>
      {action && (
        <button type="button" className="status-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button type="button" className="status-dismiss" onClick={onDismiss} aria-label="Dismiss message">
        ×
      </button>
    </p>
  );
}

function App({
  initialStatus,
  onDataFileChanged,
}: {
  initialStatus: string;
  /** Called after `relocate_data_file`/`restore_backup` succeeds — the Rust
   * side has already hot-swapped its live connection to the new file (see
   * commands.rs), so all this needs to do is force every piece of frontend
   * state to re-fetch from scratch. The wrapper below does that by
   * remounting this whole component under a fresh `key`, carrying `message`
   * over as the freshly-mounted instance's starting status banner. */
  onDataFileChanged: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system";
    } catch {
      return "system";
    }
  });
  const [navOrder, setNavOrder] = useState<Tab[]>(loadNavOrder);
  const [dragNavTab, setDragNavTab] = useState<Tab | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [anomalyFlags, setAnomalyFlags] = useState<AnomalyFlag[]>([]);
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAccountIds, setFilterAccountIds] = useState<AccountFilterValue>("all");
  const [filterMemberIds, setFilterMemberIds] = useState<MemberFilterValue>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterTag, setFilterTag] = useState("all");
  const [savedFilters, setSavedFilters] = useState<SavedLedgerFilter[]>(loadSavedFilters);
  const [savingFilter, setSavingFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");

  function saveCurrentFilter() {
    const name = newFilterName.trim();
    if (!name) return;
    const snapshot: SavedLedgerFilter = {
      name,
      searchText,
      filterCategory,
      filterAccountIds: filterAccountIds === "all" ? "all" : Array.from(filterAccountIds),
      filterMemberIds: filterMemberIds === "all" ? "all" : Array.from(filterMemberIds),
      filterFrom,
      filterTo,
      filterTag,
    };
    // Saving under a name that's already in use replaces it, rather than
    // accumulating duplicates.
    const next = [...savedFilters.filter((f) => f.name !== name), snapshot];
    setSavedFilters(next);
    saveSavedFilters(next);
    setNewFilterName("");
    setSavingFilter(false);
  }

  function applySavedFilter(filter: SavedLedgerFilter) {
    setSearchText(filter.searchText);
    setFilterCategory(filter.filterCategory);
    setFilterAccountIds(filter.filterAccountIds === "all" ? "all" : new Set(filter.filterAccountIds));
    setFilterMemberIds(filter.filterMemberIds === "all" ? "all" : new Set(filter.filterMemberIds));
    setFilterFrom(filter.filterFrom);
    setFilterTo(filter.filterTo);
    setFilterTag(filter.filterTag);
  }

  function deleteSavedFilter(name: string) {
    const next = savedFilters.filter((f) => f.name !== name);
    setSavedFilters(next);
    saveSavedFilters(next);
  }

  const [sortColumn, setSortColumn] = useState<LedgerSortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [newTagText, setNewTagText] = useState<Record<number, string>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [recurringCandidates, setRecurringCandidates] = useState<RecurringCandidate[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dataFileLocation, setDataFileLocation] = useState<string | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [livePriceSettings, setLivePriceSettings] = useState<LivePriceSettings | null>(null);

  const refreshBackups = useCallback(async () => {
    setBackups(await invoke<Backup[]>("list_backups"));
  }, []);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await invoke<Profile[]>("list_profiles"));
  }, []);

  const refreshLivePriceSettings = useCallback(async () => {
    setLivePriceSettings(await invoke<LivePriceSettings>("get_live_price_settings"));
  }, []);

  useEffect(() => {
    invoke<string>("get_data_file_location").then(setDataFileLocation).catch((e) => setStatus(String(e)));
    refreshBackups().catch((e) => setStatus(String(e)));
    refreshProfiles().catch((e) => setStatus(String(e)));
    refreshLivePriceSettings().catch((e) => setStatus(String(e)));
  }, [refreshBackups, refreshProfiles, refreshLivePriceSettings]);

  // Once live prices are enabled for the active profile, refresh right away
  // and then every 2 hours for as long as the app stays open. Keyed on
  // `enabled` (not an empty-deps mount effect) so flipping the Settings
  // toggle starts/stops this immediately, and re-runs cleanly on every
  // profile-switch remount — a different profile's own enabled state and
  // 2-hour clock take over automatically.
  const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
  useEffect(() => {
    if (!livePriceSettings?.enabled) return;
    handleRefreshLivePrices();
    const timer = setInterval(handleRefreshLivePrices, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePriceSettings?.enabled]);

  async function handleCreateBackupNow() {
    try {
      await invoke("create_backup_now");
      await refreshBackups();
      setStatus("Backup created.", "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRestoreBackup(filename: string) {
    try {
      await invoke("restore_backup", { filename });
      onDataFileChanged(`Restored ${filename} — your prior data was backed up first.`);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRelocateDataFile() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    try {
      const newPath = await invoke<string>("relocate_data_file", { newDir: dir });
      onDataFileChanged(`Data file moved to ${newPath} — your old file was left in place, untouched.`);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCreateProfile(name: string) {
    try {
      const created = await invoke<string>("create_profile", { name });
      onDataFileChanged(`Switched to the new "${created}" profile — it starts completely empty.`);
    } catch (e) {
      setStatus(String(e));
    }
  }

  /** "Use existing file…" step 1: pick the file. Step 2 (naming it) happens
   * in `UseExistingDataFileDialog` once `pendingExistingDbPath` is set —
   * split the same way `handleRelocateDataFile` splits picking a folder
   * from the backend call, except a name has to come from the user first. */
  async function handlePickExistingDataFile() {
    const path = await open({ multiple: false, filters: [{ name: "Penny Worth Database", extensions: ["db"] }] });
    if (!path || Array.isArray(path)) return;
    setPendingExistingDbPath(path);
  }

  async function handleAddExistingProfile(name: string) {
    if (!pendingExistingDbPath) return;
    try {
      const added = await invoke<string>("add_existing_profile", { name, dbPath: pendingExistingDbPath });
      setPendingExistingDbPath(null);
      onDataFileChanged(`Switched to "${added}".`);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSwitchProfile(id: string) {
    try {
      const switched = await invoke<string>("switch_profile", { id });
      onDataFileChanged(`Switched to "${switched}".`);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRenameProfile(id: string, newName: string) {
    try {
      await invoke("rename_profile", { id, newName });
      await refreshProfiles();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteProfile(id: string) {
    try {
      await invoke("delete_profile", { id });
      await refreshProfiles();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetLivePriceApiKey(provider: LivePriceProviderId, apiKey: string | null) {
    try {
      await invoke("set_live_price_settings", { provider, apiKey });
      await refreshLivePriceSettings();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRefreshLivePrices() {
    try {
      const summary = await invoke<LivePriceRefreshSummary>("refresh_live_prices");
      await Promise.all([refreshHoldings(), refreshLivePriceSettings()]);
      let message = `Live prices: updated ${summary.updated.length} symbol(s)`;
      if (summary.failed.length > 0) {
        message += ` — ${summary.failed.map((f) => `${f.symbol}: ${f.error}`).join("; ")}`;
      }
      setStatus(message, summary.failed.length > 0 ? "error" : "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleFetchLiveQuote(symbol: string): Promise<string | null> {
    try {
      return await invoke<string | null>("fetch_live_quote", { symbol });
    } catch {
      return null; // convenience autofill only — swallow errors rather than interrupting the form
    }
  }
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatusState] = useState<{ text: string; kind: StatusKind } | null>(
    initialStatus ? { text: initialStatus, kind: "success" } : null,
  );
  // Wraps the raw state setter so ~90 existing `setStatus(String(e))` catch
  // blocks stay one-line error reports (kind defaults to "error" there) while
  // confirmations/in-progress messages opt into "success"/"info" explicitly —
  // see the `.status-*` rules in App.css for what each kind looks like.
  function setStatus(text: string, kind: StatusKind = "error") {
    setStatusState(text ? { text, kind } : null);
  }

  // Auto-dismiss the status banner so it doesn't sit there stale forever —
  // resets the clock every time a new message replaces it. Errors stay up
  // longer than a routine confirmation since they're more likely to need
  // actually reading (a raw error string), not just glancing at.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatusState(null), status.kind === "error" ? 20000 : 10000);
    return () => clearTimeout(timer);
  }, [status]);

  // Shown once per install — a fresh AppData folder (a brand-new install,
  // or someone else's computer) has never set this, so it always appears
  // there; dismissing it either way (including clicking outside the
  // dialog) marks it seen so it never comes back on this machine.
  const WELCOME_SEEN_STORAGE_KEY = "pennyworth-welcome-seen";
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) !== "1";
    } catch {
      return false; // storage unavailable — don't block the app with a dialog that can't be dismissed
    }
  });

  function dismissWelcome() {
    setShowWelcome(false);
    try {
      localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }

  function handleExploreHelpFromWelcome() {
    dismissWelcome();
    setActiveTab("help");
  }

  // Shown once per version — both on a true first install and after every
  // update, since `lastSeenVersion` starts out unset either way. Compared
  // against the actual installed version (`getVersion()`, from
  // tauri.conf.json), not the frontend bundle's own notion of its version,
  // so it reflects what's really running. Nothing shows if this version
  // has no CHANGELOG entry yet.
  const LAST_SEEN_VERSION_KEY = "pennyworth-last-seen-version";
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const current = await getVersion();
      setAppVersion(current);
      if (!CHANGELOG[current]) return;
      let lastSeen: string | null = null;
      try {
        lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
      } catch {
        // storage unavailable — show it every launch, harmless
      }
      if (lastSeen !== current) setWhatsNewVersion(current);
    })();
  }, []);

  function dismissWhatsNew() {
    if (whatsNewVersion) {
      try {
        localStorage.setItem(LAST_SEEN_VERSION_KEY, whatsNewVersion);
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
    }
    setWhatsNewVersion(null);
  }

  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingSetupImport, setPendingSetupImport] = useState<{
    path: string;
    preview: SetupImportPreview;
    includedAccounts: Set<number>;
    includedCategories: Set<number>;
    includedBudgets: Set<number>;
    includedBuckets: Set<number>;
    includedHoldings: Set<number>;
  } | null>(null);
  const [includedIndices, setIncludedIndices] = useState<Set<number>>(new Set());
  const [accountOverrides, setAccountOverrides] = useState<Map<number, number>>(new Map());
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [manageFamilyMembersOpen, setManageFamilyMembersOpen] = useState(false);
  const [newTransactionOpen, setNewTransactionOpen] = useState(false);
  const [pendingExistingDbPath, setPendingExistingDbPath] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { shouldRender: moreMenuShouldRender, closing: moreMenuClosing } = useDelayedVisibility(moreMenuOpen);

  // Closes the Ledger toolbar's "More" menu on an outside click — same
  // pattern as MoreFiltersPopover/AccountFilterDropdown.
  useEffect(() => {
    if (!moreMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreMenuOpen]);
  const [editingAmount, setEditingAmount] = useState<{ id: number; value: string } | null>(null);
  const [editingDate, setEditingDate] = useState<{ id: number; value: string } | null>(null);
  const [editingDescription, setEditingDescription] = useState<{ id: number; value: string } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [applyingDebtId, setApplyingDebtId] = useState<number | null>(null);
  const [applyDebtForm, setApplyDebtForm] = useState<{ accountId: string; amount: string }>({
    accountId: "",
    amount: "",
  });
  const [expandedSplitId, setExpandedSplitId] = useState<number | null>(null);
  const [splitLines, setSplitLines] = useState<{ category: string; amount: string; note: string }[]>([]);
  const [reviewIds, setReviewIds] = useState<Set<number> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  useAutoCancelDelete(confirmingBulkDelete, () => setConfirmingBulkDelete(false));
  // Its own independent state from `status` (not a `setStatus(...)` call)
  // so a routine message elsewhere can never clobber an active undo
  // window — see `StatusBanner`'s own comment on the `action` prop.
  const [undoToast, setUndoToast] = useState<{ text: string; ids: number[] } | null>(null);
  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => setUndoToast(null), 10000);
    return () => clearTimeout(timer);
  }, [undoToast]);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // `usedCategories` now comes straight from the backend's category
  // registry (`list_categories`, refetched alongside the rest of the
  // ledger) — it already includes the standard suggestions, every budgeted
  // category, and anything created or assigned by hand, so it's the
  // complete, single source of truth for every category picker in the app.
  const categoryOptions = usedCategories;

  // Accounts a payment can be applied toward paying down — loans and
  // credit cards are the two account types that represent debt.
  const debtAccounts = accounts.filter((a) => a.account_type === "loan" || a.account_type === "credit");

  const anomalyFlagsByTransaction = new Map<number, AnomalyFlag[]>();
  for (const flag of anomalyFlags) {
    const existing = anomalyFlagsByTransaction.get(flag.transaction_id);
    if (existing) existing.push(flag);
    else anomalyFlagsByTransaction.set(flag.transaction_id, [flag]);
  }

  // Filtering is client-side over the already-loaded ledger — personal-scale
  // data, no need for a backend query just to search/filter it.
  const filteredTransactions = transactions.filter((t) => {
    if (searchText.trim() && !t.description.toLowerCase().includes(searchText.trim().toLowerCase())) {
      return false;
    }
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    if (filterAccountIds !== "all" && !filterAccountIds.has(t.account_id)) return false;
    if (filterMemberIds !== "all" && (t.member_id === null || !filterMemberIds.has(t.member_id))) return false;
    if (filterFrom && t.date < filterFrom) return false;
    if (filterTo && t.date > filterTo) return false;
    if (filterTag !== "all" && !t.tags.includes(filterTag)) return false;
    return true;
  });

  // The backend returns transactions in insertion order, not date order —
  // sorting is client-side too, same reasoning as filtering above.
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    const cmp = compareTransactionsBy(a, b, sortColumn);
    return sortDirection === "asc" ? cmp : -cmp;
  });

  function toggleSort(column: LedgerSortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  const totalPages = Math.max(1, Math.ceil(sortedTransactions.length / pageSize));
  const pagedTransactions = sortedTransactions.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // a filter/page-size change can leave `currentPage` pointing past the end
  // (or the ledger can shrink out from under it) — snap back rather than
  // showing an empty page the user didn't ask for
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, filterCategory, filterAccountIds, filterMemberIds, filterFrom, filterTo, filterTag, pageSize]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
  }

  const orderedNavItems = navOrder.map((id) => NAV_ITEMS.find((item) => item.id === id)!);

  function handleNavDrop(targetId: Tab) {
    if (!dragNavTab || dragNavTab === targetId) {
      setDragNavTab(null);
      return;
    }
    setNavOrder((prev) => {
      const next = prev.filter((id) => id !== dragNavTab);
      next.splice(next.indexOf(targetId), 0, dragNavTab);
      try {
        localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
      return next;
    });
    setDragNavTab(null);
  }

  /** The keyboard equivalent of dragging a nav item — mouse-only
   * drag-and-drop has no keyboard path otherwise. Swaps `id` with its
   * neighbor *within its own group* (skipping over any other group's items
   * that sit between them in the flat stored order), matching drag's own
   * same-group-only reordering — see `NAV_ITEMS`'s doc comment. */
  function moveNavItem(id: Tab, direction: -1 | 1) {
    setNavOrder((prev) => {
      const group = NAV_ITEMS.find((n) => n.id === id)?.group;
      const sameGroupIds = prev.filter((navId) => NAV_ITEMS.find((n) => n.id === navId)?.group === group);
      const swapWith = sameGroupIds[sameGroupIds.indexOf(id) + direction];
      if (swapWith === undefined) return prev; // already at that edge of its group
      const next = [...prev];
      const i = next.indexOf(id);
      const j = next.indexOf(swapWith);
      [next[i], next[j]] = [next[j], next[i]];
      try {
        localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
      return next;
    });
  }

  function askNewAccount(): Promise<NewAccountResult | null> {
    return new Promise((resolve) => setDialog({ kind: "newAccount", resolve }));
  }
  function askNewCategory(): Promise<string | null> {
    return new Promise((resolve) => setDialog({ kind: "newCategory", resolve }));
  }
  function askConfirmInvert(): Promise<boolean> {
    return new Promise((resolve) => setDialog({ kind: "confirmInvert", resolve }));
  }

  const refresh = useCallback(async () => {
    const [txns, s, accts, cats, flags, tags, members] = await Promise.all([
      invoke<Transaction[]>("list_transactions"),
      invoke<Stats>("get_stats"),
      invoke<Account[]>("list_accounts"),
      invoke<string[]>("list_categories"),
      invoke<AnomalyFlag[]>("list_anomaly_flags"),
      invoke<string[]>("list_all_tags"),
      invoke<FamilyMember[]>("list_family_members"),
    ]);
    setTransactions(txns);
    setStats(s);
    setAccounts(accts);
    setUsedCategories(cats);
    setAnomalyFlags(flags);
    setAllTags(tags);
    setFamilyMembers(members);
  }, []);

  // The first time the app opens in a new calendar month, every account's
  // balance rolls forward into a fresh baseline automatically (see
  // `Store::roll_forward_monthly_balances`) — this just surfaces a
  // one-time note when that happens; it's a no-op on every later refresh
  // this month.
  const checkMonthlyRollover = useCallback(async () => {
    const rolled = await invoke<RolledAccount[]>("check_monthly_rollover");
    if (rolled.length > 0) {
      const names = rolled.map((r) => r.account_name).join(", ");
      setStatus(`Rolled forward this month's starting balance for ${rolled.length} account(s): ${names}.`, "success");
    }
  }, []);

  const refreshBuckets = useCallback(async () => {
    setBuckets(await invoke<Bucket[]>("list_buckets"));
  }, []);

  const refreshReport = useCallback(async () => {
    setReport(await invoke<Report>("get_report"));
  }, []);

  const refreshRecurring = useCallback(async () => {
    setRecurring(await invoke<Recurring[]>("list_recurring"));
  }, []);

  const refreshRecurringCandidates = useCallback(async () => {
    setRecurringCandidates(await invoke<RecurringCandidate[]>("list_recurring_candidates"));
  }, []);

  const refreshAssets = useCallback(async () => {
    setAssets(await invoke<Asset[]>("list_assets"));
  }, []);

  const refreshHoldings = useCallback(async () => {
    setHoldings(await invoke<Holding[]>("list_holdings"));
  }, []);

  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [cashFlowRange, setCashFlowRange] = useState(6);
  const [compareLastYear, setCompareLastYear] = useState(false);
  const [yoyCashFlow, setYoyCashFlow] = useState<YoyCashFlow | null>(null);

  const refreshCashFlow = useCallback(async (months: number) => {
    setCashFlow(await invoke<CashFlow>("get_cash_flow", { months }));
  }, []);

  // Same trailing window get_cash_flow already shows, paired against the
  // identical span exactly one year earlier.
  const refreshYoy = useCallback(async (months: number) => {
    const today = new Date();
    const toYear = today.getFullYear();
    const toMonth = today.getMonth() + 1;
    let fromYear = toYear;
    let fromMonth = toMonth - (months - 1);
    while (fromMonth <= 0) {
      fromMonth += 12;
      fromYear -= 1;
    }
    setYoyCashFlow(await invoke<YoyCashFlow>("year_over_year_cash_flow", { fromYear, fromMonth, toYear, toMonth }));
  }, []);

  const [monthDetail, setMonthDetail] = useState<MonthExpenseDetail | null>(null);

  async function handleMonthClick(year: number, month: number) {
    try {
      setMonthDetail(await invoke<MonthExpenseDetail>("month_expense_detail", { year, month }));
    } catch (e) {
      setStatus(String(e));
    }
  }

  // "Top categories"/"Top merchants" are scoped to one month at a time —
  // deliberately separate from the bar chart's trailing 3/6-month window
  // above, and defaulting to the current month rather than that window's
  // aggregate. `cash_flow_for_range` already computes both for an
  // arbitrary month range; passing the same month as both ends of the
  // range gets exactly one month's breakdown with no new backend code.
  const topCategoriesNow = new Date();
  const [topCategoriesMonth, setTopCategoriesMonth] = useState({
    year: topCategoriesNow.getFullYear(),
    month: topCategoriesNow.getMonth() + 1,
  });
  const [topCategoriesData, setTopCategoriesData] = useState<CashFlow | null>(null);
  // Uncapped per-category spend for the month right before the one being
  // viewed — a category can be in the *current* month's top 6 without
  // having been in the *prior* month's, so this can't come from that
  // month's own (also-capped) top_categories list.
  const [previousMonthCategorySpending, setPreviousMonthCategorySpending] = useState<CategoryAmount[]>([]);

  const refreshTopCategories = useCallback(async (year: number, month: number) => {
    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const [current, previous] = await Promise.all([
      invoke<CashFlow>("cash_flow_for_range", { fromYear: year, fromMonth: month, toYear: year, toMonth: month }),
      invoke<CategoryAmount[]>("category_spending_for_month", { year: prevYear, month: prevMonth }),
    ]);
    setTopCategoriesData(current);
    setPreviousMonthCategorySpending(previous);
  }, []);

  const [forecastDays, setForecastDays] = useState(30);
  const [forecastData, setForecastData] = useState<ForecastPoint[] | null>(null);

  const refreshForecast = useCallback(async (days: number) => {
    setForecastData(await invoke<ForecastPoint[]>("cash_flow_forecast", { days }));
  }, []);

  useEffect(() => {
    if (activeTab === "cashflow") {
      refreshCashFlow(cashFlowRange).catch((e) => setStatus(String(e)));
      if (compareLastYear) refreshYoy(cashFlowRange).catch((e) => setStatus(String(e)));
      refreshTopCategories(topCategoriesMonth.year, topCategoriesMonth.month).catch((e) => setStatus(String(e)));
      refreshForecast(forecastDays).catch((e) => setStatus(String(e)));
    }
  }, [
    activeTab,
    cashFlowRange,
    compareLastYear,
    topCategoriesMonth,
    forecastDays,
    refreshCashFlow,
    refreshYoy,
    refreshTopCategories,
    refreshForecast,
  ]);

  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthPoint[]>([]);
  const [spendingThisMonth, setSpendingThisMonth] = useState<CategoryAmount[]>([]);
  const [dashboardBudgetAlerts, setDashboardBudgetAlerts] = useState<BudgetAlert[]>([]);
  const [dashboardInsights, setDashboardInsights] = useState<Insight[]>([]);
  const [avgMonthlySpend, setAvgMonthlySpend] = useState("0");

  const refreshDashboard = useCallback(async () => {
    const today = new Date();
    const [nw, spend, alerts, insights, avgSpend] = await Promise.all([
      invoke<NetWorthPoint[]>("net_worth_history", { months: 6 }),
      invoke<CategoryAmount[]>("spending_this_month"),
      invoke<BudgetAlert[]>("budget_alerts_for_month", { year: today.getFullYear(), month: today.getMonth() + 1 }),
      invoke<Insight[]>("dashboard_insights"),
      invoke<string>("average_monthly_spend"),
    ]);
    setNetWorthHistory(nw);
    setSpendingThisMonth(spend);
    setDashboardBudgetAlerts(alerts);
    setDashboardInsights(insights);
    setAvgMonthlySpend(avgSpend);
  }, []);

  useEffect(() => {
    if (activeTab === "dashboard") {
      refreshDashboard().catch((e) => setStatus(String(e)));
      refreshReport().catch((e) => setStatus(String(e)));
    }
  }, [activeTab, refreshDashboard, refreshReport]);

  // Launch-time bill-due check — not a background reminder (this only runs
  // when the app is actually open), and deliberately no backend command:
  // it filters `recurring` data the app already loaded. Deduped per
  // install via localStorage (same pattern as theme/nav-order/welcome-seen)
  // so a bill isn't re-notified every single launch on the same day.
  useEffect(() => {
    if (recurring.length === 0) return;
    const NOTIFIED_KEY = "pennyworth-notified-bills";
    const DUE_SOON_DAYS = 3;

    (async () => {
      const todayIso = toLocalIsoDate();
      const today = new Date(todayIso);
      const dueSoon = recurring.filter((r) => {
        if (parseFloat(r.amount) >= 0) return false; // bills only, not income
        const daysUntil = (new Date(r.next_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        return daysUntil >= 0 && daysUntil <= DUE_SOON_DAYS;
      });
      if (dueSoon.length === 0) return;

      let notified: Record<string, string> = {};
      try {
        notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "{}");
      } catch {
        notified = {};
      }
      const toNotify = dueSoon.filter((r) => notified[String(r.id)] !== todayIso);
      if (toNotify.length === 0) return;

      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) return;

      for (const r of toNotify) {
        sendNotification({ title: "Upcoming bill", body: `${r.merchant} — ${formatAmount(r.amount)} due ${r.next_date}` });
        notified[String(r.id)] = todayIso;
      }
      try {
        localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));
      } catch {
        // localStorage can throw (private window, blocked site data) — a
        // missed dedup write just means this bill might notify again next
        // launch, not a functional failure worth surfacing to the user.
      }
    })();
  }, [recurring]);

  const now = new Date();
  const [budgetYear, setBudgetYear] = useState(now.getFullYear());
  const [budgetMonthNum, setBudgetMonthNum] = useState(now.getMonth() + 1);
  const [budgetMonthActuals, setBudgetMonthActuals] = useState<ReportBudgetLine[]>([]);
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([]);

  const refreshBudgetMonthActuals = useCallback(async (year: number, month: number) => {
    const [actuals, alerts] = await Promise.all([
      invoke<ReportBudgetLine[]>("budget_actuals_for_month", { year, month }),
      invoke<BudgetAlert[]>("budget_alerts_for_month", { year, month }),
    ]);
    setBudgetMonthActuals(actuals);
    setBudgetAlerts(alerts);
  }, []);

  // Memoized so `BudgetRow`'s fetch-on-mount effect (keyed on this
  // function's identity, see BudgetView.tsx) only refires when the viewed
  // month actually changes — not on every unrelated App re-render.
  const handleFetchBudgetTrend = useCallback(
    async (category: string): Promise<{ month: string; actual: string }[]> => {
      try {
        return await invoke<{ month: string; actual: string }[]>("budget_actuals_trend", {
          category,
          year: budgetYear,
          month: budgetMonthNum,
          months: 4,
        });
      } catch {
        return []; // decorative sparkline only — swallow errors rather than interrupting the row
      }
    },
    [budgetYear, budgetMonthNum],
  );

  useEffect(() => {
    checkMonthlyRollover()
      .catch((e) => setStatus(String(e)))
      .finally(() => {
        refresh().catch((e) => setStatus(String(e)));
      });
    refreshBuckets().catch((e) => setStatus(String(e)));
    refreshRecurring().catch((e) => setStatus(String(e)));
    refreshRecurringCandidates().catch((e) => setStatus(String(e)));
    refreshHoldings().catch((e) => setStatus(String(e)));
    refreshAssets().catch((e) => setStatus(String(e)));
  }, [
    checkMonthlyRollover,
    refresh,
    refreshBuckets,
    refreshRecurring,
    refreshRecurringCandidates,
    refreshHoldings,
    refreshAssets,
  ]);

  useEffect(() => {
    // the report aggregates ledger/bucket/budget data, so refetch it fresh
    // whenever the user actually looks at that tab, rather than tracking
    // every mutation that could affect one of its numbers
    if (activeTab === "reports") {
      refreshReport().catch((e) => setStatus(String(e)));
    }
  }, [activeTab, refreshReport]);

  useEffect(() => {
    // the Budget tab browses arbitrary months, independent of Reports'
    // fixed "current month" view — refetch whenever the tab is open or
    // the selected month changes
    if (activeTab === "budget") {
      refreshBudgetMonthActuals(budgetYear, budgetMonthNum).catch((e) => setStatus(String(e)));
    }
  }, [activeTab, budgetYear, budgetMonthNum, refreshBudgetMonthActuals]);

  function handlePrevBudgetMonth() {
    if (budgetMonthNum === 1) {
      setBudgetYear((y) => y - 1);
      setBudgetMonthNum(12);
    } else {
      setBudgetMonthNum((m) => m - 1);
    }
  }

  function handleNextBudgetMonth() {
    if (budgetMonthNum === 12) {
      setBudgetYear((y) => y + 1);
      setBudgetMonthNum(1);
    } else {
      setBudgetMonthNum((m) => m + 1);
    }
  }

  const budgetMonthLabel = new Date(budgetYear, budgetMonthNum - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // The Budget tab's month-nav'd period ("YYYY-MM") — every set/delete
  // below is scoped to exactly this month, on purpose: editing a budget
  // must never move a different month's numbers (see BudgetView).
  const budgetPeriod = `${budgetYear}-${String(budgetMonthNum).padStart(2, "0")}`;

  async function handleSetBudget(category: string, monthlyAmount: string, budgetGroup: string) {
    try {
      await invoke("set_budget", { category, period: budgetPeriod, monthlyAmount, budgetGroup });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteBudget(category: string) {
    try {
      await invoke("delete_budget", { category, period: budgetPeriod });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(String(e));
    }
  }

  const [categoryTransactions, setCategoryTransactions] = useState<{
    category: string;
    items: CategoryTransaction[];
  } | null>(null);

  async function handleCategoryClick(category: string) {
    try {
      const items = await invoke<CategoryTransaction[]>("transactions_for_category", {
        category,
        year: budgetYear,
        month: budgetMonthNum,
      });
      setCategoryTransactions({ category, items });
    } catch (e) {
      setStatus(String(e));
    }
  }

  // Reconciling a miscategorized transaction from the drill-down dialog —
  // same command the Ledger's own category dropdown uses. Refreshes the
  // dialog's own list too (the corrected transaction no longer belongs to
  // the category being viewed, so it should drop out immediately) as well
  // as everywhere else a category total is shown, same as renaming/
  // deleting a category already does.
  // Shared tail end of both handlers below: everywhere a category total
  // or this dialog's own list is shown needs to catch up after either a
  // single or bulk correction from it.
  async function refreshAfterCategoryDialogEdit() {
    await Promise.all([refresh(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    if (categoryTransactions) {
      const items = await invoke<CategoryTransaction[]>("transactions_for_category", {
        category: categoryTransactions.category,
        year: budgetYear,
        month: budgetMonthNum,
      });
      setCategoryTransactions({ category: categoryTransactions.category, items });
    }
  }

  async function handleCorrectCategoryFromDialog(transactionId: number, value: string) {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return;
      value = custom;
    }
    try {
      await invoke("correct_category", { id: transactionId, category: value });
      await refreshAfterCategoryDialogEdit();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleBulkCorrectCategoryFromDialog(transactionIds: number[], value: string): Promise<boolean> {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return false;
      value = custom;
    }
    try {
      await invoke("bulk_correct_category", { ids: transactionIds, category: value });
      await refreshAfterCategoryDialogEdit();
      return true;
    } catch (e) {
      setStatus(String(e));
      return false;
    }
  }

  async function handleSetStartingBalance(accountId: number, balance: string) {
    try {
      await invoke("set_account_starting_balance", { id: accountId, balance });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetBalanceOverride(accountId: number, balance: string) {
    try {
      await invoke("set_account_balance_override", { id: accountId, balance });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleUpdateAccountType(accountId: number, accountType: string) {
    try {
      await invoke("update_account_type", { id: accountId, accountType });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteAccount(accountId: number) {
    try {
      const removed = await invoke<number>("delete_account", { id: accountId });
      await refresh();
      setStatus(`Deleted account and ${removed} transaction(s).`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetAccountDetails(accountId: number, institution: string | null, mask: string | null) {
    try {
      await invoke("set_account_details", { id: accountId, institution, mask });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetAccountInterestRate(accountId: number, rate: string | null) {
    try {
      await invoke("set_account_interest_rate", { id: accountId, rate });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetAccountExcludedFromDebtPayoff(accountId: number, excluded: boolean) {
    try {
      await invoke("set_account_excluded_from_debt_payoff", { id: accountId, excluded });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCalculateDebtPayoff(
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ): Promise<DebtPayoffPlan | null> {
    try {
      return await invoke<DebtPayoffPlan>("debt_payoff_projection", {
        strategy,
        extraPayment,
        minimums: minimums.map((m) => ({ account_id: m.accountId, minimum_payment: m.minimumPayment })),
      });
    } catch (e) {
      setStatus(String(e));
      return null;
    }
  }

  async function handleCreateBucket(
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_bucket", { name, targetAmount, targetDate, accountId });
      if (memberId !== null) {
        await invoke("set_bucket_member", { id, memberId });
      }
      await refreshBuckets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleAddContribution(bucketId: number, date: string, amount: string, note: string | null) {
    try {
      await invoke("add_bucket_contribution", { bucketId, date, amount, note });
      await refreshBuckets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteBucket(id: number) {
    try {
      await invoke("delete_bucket", { id });
      await refreshBuckets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCreateRecurring(
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_recurring", { merchant, category, amount, cadence, anchorDate, accountId });
      if (memberId !== null) {
        await invoke("set_recurring_member", { id, memberId });
      }
      await refreshRecurring();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleUpdateRecurring(
    id: number,
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      await invoke("update_recurring", { id, merchant, category, amount, cadence, anchorDate, accountId });
      await invoke("set_recurring_member", { id, memberId });
      await refreshRecurring();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteRecurring(id: number) {
    try {
      await invoke("delete_recurring", { id });
      await refreshRecurring();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleAddRecurringCandidate(candidate: RecurringCandidate) {
    try {
      await invoke("create_recurring", {
        merchant: candidate.merchant,
        category: candidate.category,
        amount: candidate.amount,
        cadence: candidate.cadence,
        anchorDate: candidate.anchor_date,
        accountId: null,
      });
      await refreshRecurring();
      await refreshRecurringCandidates();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDismissRecurringCandidate(candidate: RecurringCandidate) {
    try {
      await invoke("dismiss_recurring_candidate", {
        merchant: candidate.merchant,
        amount: candidate.amount,
        cadence: candidate.cadence,
      });
      await refreshRecurringCandidates();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCreateHolding(
    accountId: number,
    symbol: string,
    name: string,
    shares: string,
    price: string,
    costBasis: string,
    assetClass: string | null,
  ) {
    try {
      await invoke("create_holding", { accountId, symbol, name, shares, price, costBasis, assetClass });
      await refreshHoldings();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleUpdateHoldingPrice(id: number, price: string) {
    try {
      await invoke("update_holding_price", { id, price });
      await refreshHoldings();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteHolding(id: number) {
    try {
      await invoke("delete_holding", { id });
      await refreshHoldings();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCreateAsset(
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_asset", { name, assetType, value, valuedOn, notes });
      if (memberId !== null) {
        await invoke("set_asset_member", { id, memberId });
      }
      await refreshAssets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleUpdateAssetValue(id: number, value: string, valuedOn: string) {
    try {
      await invoke("update_asset_value", { id, value, valuedOn });
      await refreshAssets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetAssetMember(id: number, memberId: number | null) {
    try {
      await invoke("set_asset_member", { id, memberId });
      await refreshAssets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleSetAccountMember(accountId: number, memberId: number | null) {
    try {
      await invoke("set_account_member", { id: accountId, memberId });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteAsset(id: number) {
    try {
      await invoke("delete_asset", { id });
      await refreshAssets();
    } catch (e) {
      setStatus(String(e));
    }
  }

  useEffect(() => {
    // keep the selection valid as accounts come and go; default to the first one
    if (selectedAccountId === null || !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(accounts.length > 0 ? accounts[0].id : null);
    }
  }, [accounts, selectedAccountId]);

  async function handleNewAccount(): Promise<number | null> {
    const result = await askNewAccount();
    if (!result) return null;

    try {
      const id = await invoke<number>("create_account", {
        name: result.name,
        accountType: result.accountType,
        startingBalance: result.startingBalance,
        institution: result.institution,
        mask: result.mask,
      });
      if (result.memberId !== null) {
        await invoke("set_account_member", { id, memberId: result.memberId });
      }
      await refresh();
      setSelectedAccountId(id);
      return id;
    } catch (e) {
      setStatus(String(e));
      return null;
    }
  }

  function handleAccountSelectChange(value: string) {
    if (value === "__new__") {
      handleNewAccount();
      return;
    }
    setSelectedAccountId(Number(value));
  }

  async function handleImport() {
    let accountId = selectedAccountId;
    if (accountId === null) {
      accountId = await handleNewAccount();
      if (accountId === null) return; // user cancelled account creation
    }

    const path = await open({
      multiple: false,
      filters: [{ name: "Transactions", extensions: ["csv", "ofx", "qfx", "qif"] }],
    });
    if (!path || Array.isArray(path)) return;

    const invertAmounts = await askConfirmInvert();

    setBusy(true);
    setStatus("Reading file…", "info");
    try {
      const preview = await invoke<ImportPreview>("preview_import", {
        path,
        invertAmounts,
        accountId,
      });
      // duplicates default to excluded (matches the old behavior), everything
      // else defaults to included; the user can flip any row either way
      setIncludedIndices(new Set(preview.rows.filter((r) => !r.is_duplicate).map((r) => r.index)));
      // A row whose file said which account it belongs to (this app's own
      // Ledger CSV export does) pre-selects that account in its dropdown
      // when it matches one that already exists, rather than defaulting
      // every row to the account picked before the file was chosen — the
      // user still sees exactly what will happen and can change it.
      // Unmatched account names (commit_import creates those fresh) are
      // left showing the default, with a hint below the dropdown instead.
      const seededOverrides = new Map<number, number>();
      for (const row of preview.rows) {
        if (!row.account_name) continue;
        const matched = accounts.find((a) => a.name.toLowerCase() === row.account_name!.toLowerCase());
        if (matched && matched.id !== accountId) {
          seededOverrides.set(row.index, matched.id);
        }
      }
      setAccountOverrides(seededOverrides);
      setPendingImport({ path, invertAmounts, defaultAccountId: accountId, preview });
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleIncluded(index: number) {
    setIncludedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleSelectAllImportRows() {
    if (!pendingImport) return;
    const rows = pendingImport.preview.rows;
    const allIncluded = rows.length > 0 && rows.every((r) => includedIndices.has(r.index));
    setIncludedIndices(allIncluded ? new Set() : new Set(rows.map((r) => r.index)));
  }

  function setImportRowAccount(index: number, accountId: number) {
    if (!pendingImport) return;
    setAccountOverrides((prev) => {
      const next = new Map(prev);
      if (accountId === pendingImport.defaultAccountId) {
        next.delete(index); // matches the default again — no override needed
      } else {
        next.set(index, accountId);
      }
      return next;
    });
  }

  async function confirmPendingImport() {
    if (!pendingImport) return;
    setBusy(true);
    setStatus("Importing…", "info");
    const totalRows = pendingImport.preview.rows.length;
    const includedCount = includedIndices.size;
    try {
      const summary = await invoke<ImportSummary>("commit_import", {
        path: pendingImport.path,
        invertAmounts: pendingImport.invertAmounts,
        defaultAccountId: pendingImport.defaultAccountId,
        includedIndices: Array.from(includedIndices),
        accountOverrides: Object.fromEntries(accountOverrides),
      });
      await refresh();
      const skipped = totalRows - includedCount;
      setStatus(
        `Imported ${summary.inserted} transaction(s)` +
          (skipped ? ` — ${skipped} excluded` : "") +
          (summary.row_errors ? ` — ${summary.row_errors} row(s) couldn't be read` : ""),
        summary.row_errors ? "error" : "success",
      );
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
      setPendingImport(null);
    }
  }

  function cancelPendingImport() {
    setPendingImport(null);
    setIncludedIndices(new Set());
    setAccountOverrides(new Map());
    setStatus("Import cancelled.", "info");
  }

  async function handleCategoryChange(id: number, value: string) {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return;
      value = custom;
    }

    // optimistic update so the dropdown doesn't snap back while the call is in flight
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category: value, category_source: "user" } : t)),
    );
    try {
      await invoke("correct_category", { id, category: value });
      await refresh();
    } catch (e) {
      setStatus(String(e));
      await refresh();
    }
  }

  function openManageCategories() {
    setManageCategoriesOpen(true);
  }

  function openManageFamilyMembers() {
    setManageFamilyMembersOpen(true);
  }

  async function handleCreateManualTransaction(
    accountId: number,
    date: string,
    description: string,
    amount: string,
    category: string | null,
    memberId: number | null,
  ) {
    try {
      await invoke("create_manual_transaction", { accountId, date, description, amount, category, memberId });
      await refresh();
      setNewTransactionOpen(false);
      setStatus(`Added "${description}".`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCreateFamilyMember(name: string) {
    try {
      await invoke("create_family_member", { name });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRenameFamilyMember(id: number, newName: string) {
    try {
      await invoke("rename_family_member", { id, newName });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteFamilyMember(id: number) {
    try {
      await invoke("delete_family_member", { id });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleCreateCategory(name: string) {
    try {
      await invoke("create_category", { name });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRecategorize() {
    setBusy(true);
    setStatus("Categorizing…", "info");
    try {
      const ids = await invoke<number[]>("recategorize_uncategorized");
      await refresh();
      if (ids.length > 0) {
        setReviewIds(new Set(ids));
        setStatus(`Categorized ${ids.length} transaction(s) — review below and fix any mistakes.`, "success");
      } else {
        setReviewIds(null);
        setStatus("Nothing new to categorize.", "info");
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameCategory(oldName: string, newName: string) {
    try {
      await invoke("rename_category", { oldName, newName });
      await Promise.all([refresh(), refreshReport(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteCategory(name: string) {
    try {
      await invoke("delete_category", { name });
      await Promise.all([refresh(), refreshReport(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function commitAmountEdit(id: number, value: string) {
    setEditingAmount(null);
    try {
      await invoke("update_transaction_amount", { id, amount: value.trim() });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function commitDateEdit(id: number, value: string) {
    setEditingDate(null);
    if (!value.trim()) return;
    try {
      await invoke("update_transaction_date", { id, date: value.trim() });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function commitDescriptionEdit(id: number, value: string) {
    setEditingDescription(null);
    try {
      await invoke("update_transaction_description", { id, description: value.trim() });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleAccountChangeForTransaction(id: number, accountId: string) {
    try {
      await invoke("update_transaction_account", { id, accountId: Number(accountId) });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleMemberChangeForTransaction(id: number, memberId: string) {
    try {
      await invoke("set_transaction_member", { id, memberId: memberId === "" ? null : Number(memberId) });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleBulkMemberChange(value: string) {
    const ids = Array.from(selectedIds);
    try {
      await invoke("bulk_set_transaction_member", { ids, memberId: value === "__none__" ? null : Number(value) });
      setSelectedIds(new Set());
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDownloadSetupTemplate() {
    const path = await save({
      defaultPath: "pennyworth-setup-template.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      await invoke("write_text_file", { path, content: buildSetupTemplate() });
      setStatus(`Setup template saved to ${path} — fill it in, then use "Import setup data…".`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleImportSetupData() {
    const path = await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const preview = await invoke<SetupImportPreview>("preview_setup_import", { path });
      const total =
        preview.accounts.length +
        preview.categories.length +
        preview.budgets.length +
        preview.buckets.length +
        preview.holdings.length;
      if (total === 0) {
        setStatus(
          preview.row_errors > 0
            ? `Nothing importable found — ${preview.row_errors} row(s) had errors.`
            : "Nothing importable found in that file — is it a filled-in setup template?",
          preview.row_errors > 0 ? "error" : "info",
        );
        return;
      }
      // Duplicates start unchecked, same convention as the transaction
      // import's review screen; budget "will update" rows stay checked
      // since updating an existing budget line is usually the intent.
      // Holdings with an unresolved account start unchecked too — checking
      // one would just get silently skipped at commit time anyway.
      setPendingSetupImport({
        path,
        preview,
        includedAccounts: new Set(preview.accounts.filter((r) => !r.already_exists).map((r) => r.index)),
        includedCategories: new Set(preview.categories.filter((r) => !r.already_exists).map((r) => r.index)),
        includedBudgets: new Set(preview.budgets.map((r) => r.index)),
        includedBuckets: new Set(preview.buckets.filter((r) => !r.already_exists).map((r) => r.index)),
        includedHoldings: new Set(preview.holdings.filter((r) => r.account_found).map((r) => r.index)),
      });
    } catch (e) {
      setStatus(String(e));
    }
  }

  function toggleSetupIncluded(
    section: "includedAccounts" | "includedCategories" | "includedBudgets" | "includedBuckets" | "includedHoldings",
    index: number,
  ) {
    setPendingSetupImport((prev) => {
      if (!prev) return prev;
      const next = new Set(prev[section]);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...prev, [section]: next };
    });
  }

  async function confirmSetupImport() {
    if (!pendingSetupImport) return;
    setBusy(true);
    try {
      const summary = await invoke<SetupImportSummary>("commit_setup_import", {
        path: pendingSetupImport.path,
        includedAccounts: Array.from(pendingSetupImport.includedAccounts),
        includedCategories: Array.from(pendingSetupImport.includedCategories),
        includedBudgets: Array.from(pendingSetupImport.includedBudgets),
        includedBuckets: Array.from(pendingSetupImport.includedBuckets),
        includedHoldings: Array.from(pendingSetupImport.includedHoldings),
      });
      setPendingSetupImport(null);
      await Promise.all([refresh(), refreshBuckets(), refreshReport(), refreshHoldings()]);
      const parts = [
        `${summary.accounts_created} account(s)`,
        `${summary.categories_created} categor${summary.categories_created === 1 ? "y" : "ies"}`,
        `${summary.budgets_set} budget line(s)`,
        `${summary.buckets_created} bucket(s)`,
        `${summary.holdings_created} holding(s)`,
      ];
      let message = `Setup import done: ${parts.join(", ")}.`;
      if (summary.skipped.length > 0) message += ` Skipped: ${summary.skipped.join("; ")}.`;
      if (summary.row_errors > 0) message += ` ${summary.row_errors} row(s) had errors and were ignored.`;
      setStatus(message, summary.row_errors > 0 ? "error" : "success");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExportReportsCsv() {
    const path = await save({
      defaultPath: `reports-export-${toLocalIsoDate()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    const accountsCsv = toCsv(
      ["Account", "Type", "Balance / Limit", "Current Balance"],
      accounts.map((a) => [a.name, a.account_type, a.starting_balance, a.current_balance]),
    );
    const budgetCsv = toCsv(
      ["Category", "Group", "Budgeted", "Actual"],
      (report?.budget_actuals ?? []).map((b) => [b.category, b.budget_group, b.budgeted, b.actual]),
    );
    const csv = `Accounts\r\n${accountsCsv}\r\n${report?.month_label ?? ""}'s Budget\r\n${budgetCsv}`;
    try {
      await invoke("write_text_file", { path, content: csv });
      setStatus(`Exported reports to ${path}.`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleExportLedgerCsv() {
    const path = await save({
      defaultPath: `ledger-export-${toLocalIsoDate()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    const csv = toCsv(
      ["Date", "Description", "Amount", "Account", "Category", "Tags"],
      sortedTransactions.map((t) => [
        t.date,
        t.description,
        t.amount,
        t.account_name,
        t.category ?? "",
        t.tags.join("; "),
      ]),
    );
    try {
      await invoke("write_text_file", { path, content: csv });
      setStatus(`Exported ${sortedTransactions.length} transaction(s) to ${path}.`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleDeleteTransaction(id: number) {
    setConfirmingDeleteId(null);
    try {
      await invoke("delete_transaction", { id });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  function startApplyingDebtPayment(t: Transaction) {
    setApplyingDebtId(t.id);
    setApplyDebtForm({
      accountId: debtAccounts[0] ? String(debtAccounts[0].id) : "",
      amount: Math.abs(parseFloat(t.amount)).toFixed(2),
    });
  }

  async function handleApplyDebtPayment(sourceTransactionId: number, date: string) {
    if (!applyDebtForm.accountId || !applyDebtForm.amount.trim()) return;
    try {
      await invoke("apply_debt_payment", {
        sourceTransactionId,
        debtAccountId: Number(applyDebtForm.accountId),
        amount: applyDebtForm.amount.trim(),
        date,
      });
      setApplyingDebtId(null);
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleUnapplyDebtPayment(sourceTransactionId: number) {
    try {
      await invoke("unapply_debt_payment", { sourceTransactionId });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function toggleSplitEditor(t: Transaction) {
    if (expandedSplitId === t.id) {
      setExpandedSplitId(null);
      return;
    }
    try {
      const existing = await invoke<TransactionSplit[]>("get_transaction_splits", { transactionId: t.id });
      if (existing.length > 0) {
        setSplitLines(
          existing.map((s) => ({
            category: s.category ?? "",
            amount: Math.abs(parseFloat(s.amount)).toFixed(2),
            note: s.note ?? "",
          })),
        );
      } else {
        setSplitLines([
          { category: t.category ?? categoryOptions[0] ?? "", amount: Math.abs(parseFloat(t.amount)).toFixed(2), note: "" },
        ]);
      }
      setExpandedSplitId(t.id);
    } catch (e) {
      setStatus(String(e));
    }
  }

  function addSplitLine() {
    setSplitLines((prev) => [...prev, { category: categoryOptions[0] ?? "", amount: "", note: "" }]);
  }

  function removeSplitLine(index: number) {
    setSplitLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSplitLine(index: number, patch: Partial<{ category: string; amount: string; note: string }>) {
    setSplitLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function splitRemaining(t: Transaction): number {
    const total = Math.abs(parseFloat(t.amount));
    const allocated = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    return total - allocated;
  }

  async function saveSplits(t: Transaction) {
    const sign = parseFloat(t.amount) < 0 ? -1 : 1;
    const splits = splitLines
      .filter((l) => l.category && l.amount.trim())
      .map((l): [string, string, string | null] => [
        l.category,
        (sign * Math.abs(parseFloat(l.amount))).toFixed(2),
        l.note.trim() ? l.note.trim() : null,
      ]);
    try {
      await invoke("set_transaction_splits", { transactionId: t.id, splits });
      setExpandedSplitId(null);
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function clearSplits(t: Transaction) {
    try {
      await invoke("set_transaction_splits", { transactionId: t.id, splits: [] });
      setExpandedSplitId(null);
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleAddTag(id: number, tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    try {
      await invoke("add_tag", { transactionId: id, tag: trimmed });
      setNewTagText((prev) => ({ ...prev, [id]: "" }));
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleRemoveTag(id: number, tag: string) {
    try {
      await invoke("remove_tag", { transactionId: id, tag });
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const allSelected = pagedTransactions.length > 0 && pagedTransactions.every((t) => selectedIds.has(t.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pagedTransactions.forEach((t) => next.delete(t.id));
      } else {
        pagedTransactions.forEach((t) => next.add(t.id));
      }
      return next;
    });
  }

  async function handleBulkCategoryChange(value: string) {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return;
      value = custom;
    }
    const ids = Array.from(selectedIds);
    try {
      await invoke("bulk_correct_category", { ids, category: value });
      setSelectedIds(new Set());
      await refresh();
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleBulkDelete() {
    setConfirmingBulkDelete(false);
    const ids = Array.from(selectedIds);
    try {
      const deletedIds = await invoke<number[]>("bulk_delete_transactions", { ids });
      setSelectedIds(new Set());
      await refresh();
      setUndoToast({ text: `Deleted ${deletedIds.length} transaction(s).`, ids: deletedIds });
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleUndoBulkDelete() {
    if (!undoToast) return;
    const ids = undoToast.ids;
    setUndoToast(null);
    try {
      await invoke("restore_transactions", { ids });
      await refresh();
      setStatus(`Restored ${ids.length} transaction(s).`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleAddSelectedToRecurring(cadence: string) {
    const ids = Array.from(selectedIds);
    try {
      const created = await invoke<number>("bulk_create_recurring_from_transactions", { ids, cadence });
      setSelectedIds(new Set());
      await refreshRecurring();
      setStatus(`Added ${created} transaction(s) to Recurring — adjust the cadence per item there if needed.`, "success");
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <div className="app-shell">
      {showWelcome && (
        <WelcomeDialog onExploreHelp={handleExploreHelpFromWelcome} onGetStarted={dismissWelcome} />
      )}
      {!showWelcome && whatsNewVersion && (
        <WhatsNewDialog version={whatsNewVersion} notes={CHANGELOG[whatsNewVersion]} onClose={dismissWhatsNew} />
      )}
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={pennyWorthIcon} alt="" />
          <span className="brand-word">Penny Worth</span>
        </div>
        <ProfileSwitcher
          profiles={profiles}
          onSwitchProfile={handleSwitchProfile}
          onManageProfiles={() => setActiveTab("settings")}
        />
        {NAV_GROUP_ORDER.map((group) => (
          <div className="nav-group" key={group}>
            <div className="nav-group-label">{NAV_GROUP_LABELS[group]}</div>
            <nav className="nav-list">
              {orderedNavItems
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    draggable
                    className={
                      activeTab === item.id
                        ? "nav-item nav-item-active"
                        : dragNavTab === item.id
                          ? "nav-item nav-item-dragging"
                          : "nav-item"
                    }
                    onClick={() => setActiveTab(item.id)}
                    onKeyDown={(e) => {
                      // Alt+Up/Down: keyboard equivalent of dragging this
                      // item — see `moveNavItem`'s doc comment.
                      if (e.altKey && e.key === "ArrowUp") {
                        e.preventDefault();
                        moveNavItem(item.id, -1);
                      } else if (e.altKey && e.key === "ArrowDown") {
                        e.preventDefault();
                        moveNavItem(item.id, 1);
                      }
                    }}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    title="Drag to reorder, or focus and press Alt+↑/↓"
                    onDragStart={(e) => {
                      // Native drag-and-drop requires a payload via setData or
                      // the browser treats the drag as invalid and shows
                      // "not-allowed" over every drop target, regardless of
                      // what dragover/drop do.
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", item.id);
                      setDragNavTab(item.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleNavDrop(item.id);
                    }}
                    onDragEnd={() => setDragNavTab(null)}
                  >
                    <NavIcon name={item.icon} />
                    <span className="nav-text">{item.label}</span>
                  </button>
                ))}
            </nav>
          </div>
        ))}
        <div className="sidebar-spacer"></div>
        <div className="sidebar-divider"></div>
        <nav className="nav-list">
          {PINNED_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={activeTab === item.id ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveTab(item.id)}
            >
              <NavIcon name={item.icon} />
              <span className="nav-text">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {appVersion && <p className="sidebar-version">v{appVersion}</p>}
          <div className="theme-toggle" role="group" aria-label="Theme">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button
                key={t}
                className={theme === t ? "theme-toggle-active" : ""}
                onClick={() => setTheme(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>Penny Worth</h1>
            <p className="subtitle">Get your penny's worth.</p>
          </div>
          {activeTab === "ledger" && (
            <div className="import-controls">
              <select
                className="account-select"
                value={selectedAccountId ?? ""}
                onChange={(e) => handleAccountSelectChange(e.target.value)}
                disabled={busy || pendingImport !== null}
              >
                {accounts.length === 0 && <option value="">No accounts yet</option>}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="__new__">+ New account…</option>
              </select>
              <button onClick={handleImport} disabled={busy || pendingImport !== null}>
                {busy ? "Importing…" : "Import transactions…"}
              </button>
              <button
                className="modal-secondary"
                onClick={() => setNewTransactionOpen(true)}
                disabled={busy || pendingImport !== null}
              >
                Add transaction…
              </button>
              <div className="more-menu" ref={moreMenuRef}>
                <button
                  type="button"
                  className="modal-secondary btn-icon"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  disabled={busy || pendingImport !== null}
                  aria-label="More actions"
                  title="More actions"
                  aria-haspopup="true"
                  aria-expanded={moreMenuOpen}
                >
                  ⋯
                </button>
                {moreMenuShouldRender && (
                  <div className={moreMenuClosing ? "more-menu-panel more-menu-panel-closing" : "more-menu-panel"}>
                    <button
                      type="button"
                      className="more-menu-item"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        openManageCategories();
                      }}
                    >
                      Manage categories…
                    </button>
                    <button
                      type="button"
                      className="more-menu-item"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        openManageFamilyMembers();
                      }}
                    >
                      Manage family members…
                    </button>
                    <div className="more-menu-divider"></div>
                    <button
                      type="button"
                      className="more-menu-item"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleRecategorize();
                      }}
                      title="Re-run categorization on every Uncategorized transaction using what's been learned so far"
                    >
                      Categorize uncategorized
                    </button>
                    <div className="more-menu-divider"></div>
                    <button
                      type="button"
                      className="more-menu-item"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleExportLedgerCsv();
                      }}
                    >
                      Export CSV…
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </header>

        <div className="page">

      <UpdateBanner />
      <div className="toast-stack">
        {status && <StatusBanner text={status.text} kind={status.kind} onDismiss={() => setStatusState(null)} />}
        {undoToast && (
          <StatusBanner
            text={undoToast.text}
            kind="info"
            action={{ label: "Undo", onClick: handleUndoBulkDelete }}
            onDismiss={() => setUndoToast(null)}
          />
        )}
      </div>

      {activeTab === "dashboard" && (
        <DashboardView
          accounts={accounts}
          netWorthHistory={netWorthHistory}
          spendingThisMonth={spendingThisMonth}
          report={report}
          recurring={recurring}
          transactions={transactions}
          budgetAlerts={dashboardBudgetAlerts}
          insights={dashboardInsights}
          avgMonthlySpend={avgMonthlySpend}
          assetsTotal={assets.reduce((s, a) => s + parseFloat(a.value), 0)}
          onOpenLedger={() => setActiveTab("ledger")}
          onOpenRecurring={() => setActiveTab("recurring")}
          onOpenBudget={() => setActiveTab("budget")}
        />
      )}

      {activeTab === "ledger" && pendingImport && (
        <div className="dup-review">
          <p className="dup-review-summary">
            Reviewing {pendingImport.preview.rows.length} transaction(s) from this file
            {pendingImport.preview.row_errors
              ? ` (${pendingImport.preview.row_errors} row(s) couldn't be read)`
              : ""}
            . Uncheck any you don't want to import, and fix the account for any row that doesn't belong to{" "}
            {accounts.find((a) => a.id === pendingImport.defaultAccountId)?.name ?? "the selected account"}.
          </p>
          <div className="dup-review-table-scroll">
            <table className="dup-review-table">
              <thead>
                <tr>
                  <th className="dup-review-check">
                    <input
                      type="checkbox"
                      checked={
                        pendingImport.preview.rows.length > 0 &&
                        pendingImport.preview.rows.every((r) => includedIndices.has(r.index))
                      }
                      onChange={toggleSelectAllImportRows}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="amount-col">Amount</th>
                  <th>Account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingImport.preview.rows.map((row) => (
                  <tr key={row.index} className={row.is_duplicate ? "import-row-duplicate" : undefined}>
                    <td className="dup-review-check">
                      <input
                        type="checkbox"
                        checked={includedIndices.has(row.index)}
                        onChange={() => toggleIncluded(row.index)}
                      />
                    </td>
                    <td>{row.date}</td>
                    <td>{row.description}</td>
                    <td className="amount-col">{formatAmount(row.amount)}</td>
                    <td>
                      <select
                        value={accountOverrides.get(row.index) ?? pendingImport.defaultAccountId}
                        onChange={(e) => setImportRowAccount(row.index, Number(e.target.value))}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      {row.account_name &&
                        !accounts.some((a) => a.name.toLowerCase() === row.account_name!.toLowerCase()) && (
                          <div className="account-col" title="No account by that name exists yet — it'll be created on import">
                            CSV: {row.account_name} (new)
                          </div>
                        )}
                    </td>
                    <td className="source-col">{row.is_duplicate ? "Already in ledger" : "New"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dup-review-actions">
            <button className="modal-secondary" onClick={cancelPendingImport} disabled={busy}>
              Cancel
            </button>
            <button onClick={confirmPendingImport} disabled={busy || includedIndices.size === 0}>
              {busy ? "Importing…" : `Import ${includedIndices.size} transaction(s)`}
            </button>
          </div>
        </div>
      )}

      {activeTab === "ledger" && reviewIds && reviewIds.size > 0 && (
        <div className="dup-review">
          <p className="dup-review-summary">
            Just categorized {reviewIds.size} transaction(s). Review and fix any that are wrong.
          </p>
          <table className="dup-review-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="amount-col">Amount</th>
                <th>Category</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {transactions
                .filter((t) => reviewIds.has(t.id))
                .map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td>{t.description}</td>
                    <td className="amount-col">{formatAmount(t.amount)}</td>
                    <td>
                      <select value={t.category ?? ""} onChange={(e) => handleCategoryChange(t.id, e.target.value)}>
                        <option value="" disabled>
                          Uncategorized
                        </option>
                        {t.category && !categoryOptions.includes(t.category) && (
                          <option value={t.category}>{t.category}</option>
                        )}
                        {categoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        <option value="__new__">+ New category…</option>
                      </select>
                    </td>
                    <td className="source-col">
                      {t.category_source ?? ""}
                      {t.confidence !== null && (
                        <span className="confidence-badge">{Math.round(t.confidence * 100)}%</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="dup-review-actions">
            <button onClick={() => setReviewIds(null)}>Done</button>
          </div>
        </div>
      )}

      {activeTab === "ledger" && stats && (
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Transactions</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.auto_categorized}</span>
            <span className="stat-label">Auto-categorized</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.user_confirmed}</span>
            <span className="stat-label">Corrected by you</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.uncategorized}</span>
            <span className="stat-label">Needs a category</span>
          </div>
        </div>
      )}

      {activeTab === "ledger" && (
        <div className="ledger-filters">
          <input
            type="search"
            placeholder="Search description…"
            aria-label="Search description"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <AccountFilterDropdown accounts={accounts} value={filterAccountIds} onChange={setFilterAccountIds} />
          <MemberFilterDropdown members={familyMembers} value={filterMemberIds} onChange={setFilterMemberIds} />
          <MoreFiltersPopover
            filterFrom={filterFrom}
            onSetFrom={setFilterFrom}
            filterTo={filterTo}
            onSetTo={setFilterTo}
            filterTag={filterTag}
            allTags={allTags}
            onSetTag={setFilterTag}
          />
          <datalist id="known-tags">
            {allTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>
      )}

      {activeTab === "ledger" && (
        <div className="saved-filter-bar">
          {savedFilters.map((f) => (
            <span key={f.name} className="saved-filter-chip">
              <button type="button" onClick={() => applySavedFilter(f)} title={`Apply saved filter "${f.name}"`}>
                {f.name}
              </button>
              <button
                type="button"
                className="saved-filter-chip-remove"
                onClick={() => deleteSavedFilter(f.name)}
                aria-label={`Remove saved filter ${f.name}`}
              >
                ×
              </button>
            </span>
          ))}
          {savingFilter ? (
            <form
              className="saved-filter-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveCurrentFilter();
              }}
            >
              <input
                autoFocus
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                placeholder='e.g. "Uncategorized this month"'
              />
              <button type="submit" className="btn-sm" disabled={!newFilterName.trim()}>
                Save
              </button>
              <button
                type="button"
                className="modal-secondary btn-sm"
                onClick={() => {
                  setSavingFilter(false);
                  setNewFilterName("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="modal-secondary btn-sm" onClick={() => setSavingFilter(true)}>
              + Save current filter…
            </button>
          )}
        </div>
      )}

      {activeTab === "ledger" && selectedIds.size > 0 && (
        <div className="bulk-actions-bar">
          <span className="bulk-actions-count">{selectedIds.size} selected</span>
          <select value="" onChange={(e) => handleBulkCategoryChange(e.target.value)}>
            <option value="" disabled>
              Set category to…
            </option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new__">+ New category…</option>
          </select>
          <select value="" onChange={(e) => handleAddSelectedToRecurring(e.target.value)}>
            <option value="" disabled>
              Add to Recurring…
            </option>
            {CADENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
          {familyMembers.length > 0 && (
            <select value="" onChange={(e) => handleBulkMemberChange(e.target.value)}>
              <option value="" disabled>
                Set member to…
              </option>
              <option value="__none__">Unassigned</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          {confirmingBulkDelete ? (
            <span className="row-delete-confirm">
              <button type="button" className="modal-secondary" onClick={() => setConfirmingBulkDelete(false)}>
                Cancel
              </button>
              <button type="button" className="btn-danger" onClick={handleBulkDelete}>
                Delete {selectedIds.size}
              </button>
            </span>
          ) : (
            <button type="button" className="modal-secondary" onClick={() => setConfirmingBulkDelete(true)}>
              Delete selected
            </button>
          )}
          <button type="button" className="modal-secondary" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {activeTab === "ledger" && (
      <table className="ledger">
        <thead>
          <tr>
            <th className="select-col">
              <input
                type="checkbox"
                checked={pagedTransactions.length > 0 && pagedTransactions.every((t) => selectedIds.has(t.id))}
                onChange={toggleSelectAllOnPage}
                aria-label="Select all on this page"
              />
            </th>
            <th className="sortable-col" onClick={() => toggleSort("date")}>
              Date{sortColumn === "date" && (sortDirection === "asc" ? " ▲" : " ▼")}
            </th>
            <th className="sortable-col" onClick={() => toggleSort("description")}>
              Description{sortColumn === "description" && (sortDirection === "asc" ? " ▲" : " ▼")}
            </th>
            <th className="amount-col sortable-col" onClick={() => toggleSort("amount")}>
              Amount{sortColumn === "amount" && (sortDirection === "asc" ? " ▲" : " ▼")}
            </th>
            <th className="sortable-col" onClick={() => toggleSort("account")}>
              Account{sortColumn === "account" && (sortDirection === "asc" ? " ▲" : " ▼")}
            </th>
            <th>Member</th>
            <th className="sortable-col" onClick={() => toggleSort("category")}>
              Category{sortColumn === "category" && (sortDirection === "asc" ? " ▲" : " ▼")}
            </th>
            <th className="sortable-col" onClick={() => toggleSort("source")}>
              Source{sortColumn === "source" && (sortDirection === "asc" ? " ▲" : " ▼")}
            </th>
            <th>Debt</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {pagedTransactions.map((t) => (
            <Fragment key={t.id}>
            <tr className={selectedIds.has(t.id) ? "ledger-row-selected" : undefined}>
              <td className="select-col">
                <input
                  type="checkbox"
                  checked={selectedIds.has(t.id)}
                  onChange={() => toggleSelected(t.id)}
                  aria-label={`Select transaction ${t.id}`}
                />
              </td>
              <td>
                {editingDate?.id === t.id ? (
                  <input
                    autoFocus
                    type="date"
                    className="row-edit-input"
                    value={editingDate.value}
                    onChange={(e) => setEditingDate({ id: t.id, value: e.target.value })}
                    onBlur={() => commitDateEdit(t.id, editingDate.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitDateEdit(t.id, editingDate.value);
                      if (e.key === "Escape") setEditingDate(null);
                    }}
                  />
                ) : (
                  <span
                    className="amount-editable"
                    title="Click to fix the date"
                    onClick={() => setEditingDate({ id: t.id, value: t.date })}
                  >
                    {t.date}
                  </span>
                )}
              </td>
              <td>
                {editingDescription?.id === t.id ? (
                  <input
                    autoFocus
                    className="row-edit-input"
                    value={editingDescription.value}
                    onChange={(e) => setEditingDescription({ id: t.id, value: e.target.value })}
                    onBlur={() => commitDescriptionEdit(t.id, editingDescription.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitDescriptionEdit(t.id, editingDescription.value);
                      if (e.key === "Escape") setEditingDescription(null);
                    }}
                  />
                ) : (
                  <span
                    className="amount-editable"
                    title="Click to fix the description"
                    onClick={() => setEditingDescription({ id: t.id, value: t.description })}
                  >
                    {t.description}
                  </span>
                )}
                {(anomalyFlagsByTransaction.get(t.id) ?? []).map((flag, i) => (
                  <span
                    key={i}
                    className={flag.kind === "large" ? "anomaly-badge anomaly-large" : "anomaly-badge anomaly-duplicate"}
                    title={flag.detail}
                  >
                    {flag.kind === "large" ? "⚠" : "⧉"}
                  </span>
                ))}
                <div className="tag-pills">
                  {t.tags.map((tag) => (
                    <span key={tag} className="tag-pill">
                      {tag}
                      <button type="button" onClick={() => handleRemoveTag(t.id, tag)} aria-label={`Remove tag ${tag}`}>
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    list="known-tags"
                    placeholder="+ tag"
                    value={newTagText[t.id] ?? ""}
                    onChange={(e) => setNewTagText((prev) => ({ ...prev, [t.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTag(t.id, newTagText[t.id] ?? "");
                      }
                    }}
                  />
                </div>
              </td>
              <td className="amount-col">
                {editingAmount?.id === t.id ? (
                  <input
                    autoFocus
                    className="amount-edit-input"
                    value={editingAmount.value}
                    onChange={(e) => setEditingAmount({ id: t.id, value: e.target.value })}
                    onBlur={() => commitAmountEdit(t.id, editingAmount.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAmountEdit(t.id, editingAmount.value);
                      if (e.key === "Escape") setEditingAmount(null);
                    }}
                  />
                ) : (
                  <span
                    className="amount-editable"
                    title="Click to fix the amount"
                    onClick={() => setEditingAmount({ id: t.id, value: t.amount })}
                  >
                    {formatAmount(t.amount)}
                  </span>
                )}
              </td>
              <td className="account-col">
                <select value={t.account_id} onChange={(e) => handleAccountChangeForTransaction(t.id, e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="member-col">
                <select
                  value={t.member_id ?? ""}
                  onChange={(e) => handleMemberChangeForTransaction(t.id, e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {familyMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {t.split_count > 0 ? (
                  <span className="split-summary">Split ({t.split_count})</span>
                ) : (
                  <select
                    value={t.category ?? ""}
                    onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                  >
                    <option value="" disabled>
                      Uncategorized
                    </option>
                    {t.category && !categoryOptions.includes(t.category) && (
                      <option value={t.category}>{t.category}</option>
                    )}
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value="__new__">+ New category…</option>
                  </select>
                )}
                <button type="button" className="modal-secondary split-toggle" onClick={() => toggleSplitEditor(t)}>
                  {t.split_count > 0 ? "Edit splits" : "Split →"}
                </button>
              </td>
              <td className="source-col">
                {t.category_source ?? ""}
                {t.confidence !== null && (
                  <span className="confidence-badge">{Math.round(t.confidence * 100)}%</span>
                )}
              </td>
              <td className="debt-col">
                {t.applied_to_debt ? (
                  <span className="debt-applied-badge">
                    → {t.applied_to_debt.debt_account_name} ({formatAmount(t.applied_to_debt.amount)})
                    <button type="button" className="modal-secondary" onClick={() => handleUnapplyDebtPayment(t.id)}>
                      Undo
                    </button>
                  </span>
                ) : applyingDebtId === t.id ? (
                  <span className="debt-apply-form">
                    <select
                      value={applyDebtForm.accountId}
                      onChange={(e) => setApplyDebtForm({ ...applyDebtForm, accountId: e.target.value })}
                    >
                      {debtAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="debt-apply-amount"
                      value={applyDebtForm.amount}
                      onChange={(e) => setApplyDebtForm({ ...applyDebtForm, amount: e.target.value })}
                      title="How much of this payment counts toward the debt (e.g. just the principal on a mortgage payment)"
                    />
                    <button type="button" className="debt-apply-confirm" onClick={() => handleApplyDebtPayment(t.id, t.date)}>
                      Apply
                    </button>
                    <button type="button" className="modal-secondary" onClick={() => setApplyingDebtId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  debtAccounts.length > 0 &&
                  accounts.find((a) => a.id === t.account_id)?.account_type !== "loan" &&
                  accounts.find((a) => a.id === t.account_id)?.account_type !== "credit" && (
                    <button type="button" className="modal-secondary debt-apply-trigger" onClick={() => startApplyingDebtPayment(t)}>
                      Apply to a debt →
                    </button>
                  )
                )}
              </td>
              <td className="actions-col">
                {confirmingDeleteId === t.id ? (
                  <span className="row-delete-confirm row-delete-confirm-detailed">
                    {(() => {
                      const impact = describeDeleteImpact(t.amount, accounts.find((a) => a.id === t.account_id));
                      return impact ? <span className="delete-impact-note">{impact}</span> : null;
                    })()}
                    <span className="row-delete-confirm-actions">
                      <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn-danger" onClick={() => handleDeleteTransaction(t.id)}>
                        Delete
                      </button>
                    </span>
                  </span>
                ) : (
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(t.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
            {expandedSplitId === t.id && (
              <tr className="split-editor-row">
                <td colSpan={10}>
                  <div className="split-editor">
                    {splitLines.map((line, i) => (
                      <div className="split-editor-line" key={i}>
                        <select value={line.category} onChange={(e) => updateSplitLine(i, { category: e.target.value })}>
                          {categoryOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          className="debt-apply-amount"
                          value={line.amount}
                          onChange={(e) => updateSplitLine(i, { amount: e.target.value })}
                          placeholder="Amount"
                        />
                        <input
                          value={line.note}
                          onChange={(e) => updateSplitLine(i, { note: e.target.value })}
                          placeholder="Note (optional)"
                        />
                        <button type="button" className="modal-secondary" onClick={() => removeSplitLine(i)}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="split-editor-actions">
                      <button type="button" className="modal-secondary" onClick={addSplitLine}>
                        Add line
                      </button>
                      <span className={Math.abs(splitRemaining(t)) < 0.01 ? "split-remaining split-remaining-ok" : "split-remaining"}>
                        Remaining to allocate: {formatAmount(splitRemaining(t).toFixed(2))}
                      </span>
                      <button type="button" disabled={Math.abs(splitRemaining(t)) >= 0.01} onClick={() => saveSplits(t)}>
                        Save splits
                      </button>
                      {t.split_count > 0 && (
                        <button type="button" className="modal-secondary" onClick={() => clearSplits(t)}>
                          Clear splits
                        </button>
                      )}
                      <button type="button" className="modal-secondary" onClick={() => setExpandedSplitId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
          ))}
          {filteredTransactions.length === 0 && (
            <tr>
              <td colSpan={10} className="empty-state">
                {transactions.length === 0
                  ? "No transactions yet — import a CSV to get started."
                  : "No transactions match your filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      )}

      {activeTab === "ledger" && filteredTransactions.length > 0 && (
        <div className="ledger-pagination">
          <label className="ledger-page-size">
            Show
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            per page
          </label>
          <div className="month-nav">
            <button
              type="button"
              className="modal-secondary"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="month-label">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="modal-secondary"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
          <span className="ledger-page-count">{filteredTransactions.length} total</span>
        </div>
      )}

      {activeTab === "buckets" && (
        <BucketsView
          buckets={buckets}
          accounts={accounts}
          familyMembers={familyMembers}
          onCreateBucket={handleCreateBucket}
          onAddContribution={handleAddContribution}
          onDeleteBucket={handleDeleteBucket}
        />
      )}

      {activeTab === "budget" && (
        <BudgetView
          categories={usedCategories}
          budgetActuals={budgetMonthActuals}
          budgetAlerts={budgetAlerts}
          monthLabel={budgetMonthLabel}
          onPrevMonth={handlePrevBudgetMonth}
          onNextMonth={handleNextBudgetMonth}
          onSetBudget={handleSetBudget}
          onDeleteBudget={handleDeleteBudget}
          onCategoryClick={handleCategoryClick}
          onFetchTrend={handleFetchBudgetTrend}
        />
      )}

      {categoryTransactions && (
        <CategoryTransactionsDialog
          category={categoryTransactions.category}
          monthLabel={budgetMonthLabel}
          transactions={categoryTransactions.items}
          categoryOptions={categoryOptions}
          onCorrectCategory={handleCorrectCategoryFromDialog}
          onBulkCorrectCategory={handleBulkCorrectCategoryFromDialog}
          onClose={() => setCategoryTransactions(null)}
        />
      )}

      {activeTab === "recurring" && (
        <RecurringView
          recurring={recurring}
          candidates={recurringCandidates}
          accounts={accounts}
          familyMembers={familyMembers}
          onCreate={handleCreateRecurring}
          onUpdate={handleUpdateRecurring}
          onDelete={handleDeleteRecurring}
          onAddCandidate={handleAddRecurringCandidate}
          onDismissCandidate={handleDismissRecurringCandidate}
        />
      )}

      {activeTab === "investments" && (
        <InvestmentsView
          holdings={holdings}
          accounts={accounts}
          onCreate={handleCreateHolding}
          onUpdatePrice={handleUpdateHoldingPrice}
          onDelete={handleDeleteHolding}
          livePricesEnabled={livePriceSettings?.enabled ?? false}
          onFetchQuote={handleFetchLiveQuote}
        />
      )}

      {activeTab === "help" && <HelpView />}

      {activeTab === "cashflow" && (
        <CashFlowView
          cashFlow={cashFlow}
          range={cashFlowRange}
          onSetRange={setCashFlowRange}
          compareLastYear={compareLastYear}
          onToggleCompareLastYear={() => setCompareLastYear((v) => !v)}
          yoyCashFlow={yoyCashFlow}
          onMonthClick={handleMonthClick}
          topCategoriesData={topCategoriesData}
          topCategoriesMonth={topCategoriesMonth}
          onSetTopCategoriesMonth={(year, month) => setTopCategoriesMonth({ year, month })}
          previousMonthCategorySpending={previousMonthCategorySpending}
          forecastData={forecastData}
          forecastDays={forecastDays}
          onSetForecastDays={setForecastDays}
          accounts={accounts}
          onSetAccountInterestRate={handleSetAccountInterestRate}
          onCalculateDebtPayoff={handleCalculateDebtPayoff}
          onSetAccountExcludedFromDebtPayoff={handleSetAccountExcludedFromDebtPayoff}
        />
      )}

      {monthDetail && <MonthExpenseDetailDialog detail={monthDetail} onClose={() => setMonthDetail(null)} />}

      {activeTab === "reports" && pendingSetupImport && (
        <div className="dup-review">
          <p className="dup-review-summary">
            Reviewing setup data from this file — uncheck anything you don't want imported.
            {pendingSetupImport.preview.row_errors > 0 &&
              ` ${pendingSetupImport.preview.row_errors} row(s) had errors and will be ignored.`}
          </p>

          {pendingSetupImport.preview.accounts.length > 0 && (
            <>
              <h2 className="reports-section-title">Accounts</h2>
              <table className="dup-review-table">
                <thead>
                  <tr>
                    <th className="select-col"></th>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="amount-col">Starting balance</th>
                    <th>Institution</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSetupImport.preview.accounts.map((row) => (
                    <tr key={row.index} className={row.already_exists ? "import-row-duplicate" : undefined}>
                      <td className="select-col">
                        <input
                          type="checkbox"
                          checked={pendingSetupImport.includedAccounts.has(row.index)}
                          onChange={() => toggleSetupIncluded("includedAccounts", row.index)}
                          aria-label={`Include account ${row.name}`}
                        />
                      </td>
                      <td>{row.name}</td>
                      <td>{row.account_type}</td>
                      <td className="amount-col">{row.starting_balance ? formatAmount(row.starting_balance) : ""}</td>
                      <td>{row.institution ?? ""}</td>
                      <td className="source-col">{row.already_exists ? "Already exists" : "New"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {pendingSetupImport.preview.categories.length > 0 && (
            <>
              <h2 className="reports-section-title">Categories</h2>
              <table className="dup-review-table">
                <thead>
                  <tr>
                    <th className="select-col"></th>
                    <th>Name</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSetupImport.preview.categories.map((row) => (
                    <tr key={row.index} className={row.already_exists ? "import-row-duplicate" : undefined}>
                      <td className="select-col">
                        <input
                          type="checkbox"
                          checked={pendingSetupImport.includedCategories.has(row.index)}
                          onChange={() => toggleSetupIncluded("includedCategories", row.index)}
                          aria-label={`Include category ${row.name}`}
                        />
                      </td>
                      <td>{row.name}</td>
                      <td className="source-col">{row.already_exists ? "Already exists" : "New"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {pendingSetupImport.preview.budgets.length > 0 && (
            <>
              <h2 className="reports-section-title">Budgets</h2>
              <table className="dup-review-table">
                <thead>
                  <tr>
                    <th className="select-col"></th>
                    <th>Category</th>
                    <th>Group</th>
                    <th className="amount-col">Monthly amount</th>
                    <th>Period</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSetupImport.preview.budgets.map((row) => (
                    <tr key={row.index}>
                      <td className="select-col">
                        <input
                          type="checkbox"
                          checked={pendingSetupImport.includedBudgets.has(row.index)}
                          onChange={() => toggleSetupIncluded("includedBudgets", row.index)}
                          aria-label={`Include budget ${row.category}`}
                        />
                      </td>
                      <td>{row.category}</td>
                      <td>{row.budget_group}</td>
                      <td className="amount-col">{formatAmount(row.monthly_amount)}</td>
                      <td>{row.period ?? "This month"}</td>
                      <td className="source-col">{row.will_update ? "Will update existing" : "New"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {pendingSetupImport.preview.buckets.length > 0 && (
            <>
              <h2 className="reports-section-title">Buckets</h2>
              <table className="dup-review-table">
                <thead>
                  <tr>
                    <th className="select-col"></th>
                    <th>Name</th>
                    <th className="amount-col">Target</th>
                    <th>Target date</th>
                    <th>Linked account</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSetupImport.preview.buckets.map((row) => (
                    <tr key={row.index} className={row.already_exists ? "import-row-duplicate" : undefined}>
                      <td className="select-col">
                        <input
                          type="checkbox"
                          checked={pendingSetupImport.includedBuckets.has(row.index)}
                          onChange={() => toggleSetupIncluded("includedBuckets", row.index)}
                          aria-label={`Include bucket ${row.name}`}
                        />
                      </td>
                      <td>{row.name}</td>
                      <td className="amount-col">{row.target_amount ? formatAmount(row.target_amount) : ""}</td>
                      <td>{row.target_date ?? ""}</td>
                      <td>{row.linked_account_name ?? ""}</td>
                      <td className="source-col">{row.already_exists ? "Already exists" : "New"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {pendingSetupImport.preview.holdings.length > 0 && (
            <>
              <h2 className="reports-section-title">Holdings</h2>
              <table className="dup-review-table">
                <thead>
                  <tr>
                    <th className="select-col"></th>
                    <th>Account</th>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th className="amount-col">Shares</th>
                    <th className="amount-col">Price</th>
                    <th className="amount-col">Cost basis</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSetupImport.preview.holdings.map((row) => (
                    <tr key={row.index} className={row.account_found ? undefined : "import-row-duplicate"}>
                      <td className="select-col">
                        <input
                          type="checkbox"
                          checked={pendingSetupImport.includedHoldings.has(row.index)}
                          onChange={() => toggleSetupIncluded("includedHoldings", row.index)}
                          aria-label={`Include holding ${row.symbol}`}
                        />
                      </td>
                      <td>{row.account_name}</td>
                      <td>{row.symbol}</td>
                      <td>{row.name ?? ""}</td>
                      <td className="amount-col">{row.shares}</td>
                      <td className="amount-col">{formatAmount(row.price)}</td>
                      <td className="amount-col">{formatAmount(row.cost_basis)}</td>
                      <td className="source-col">{row.account_found ? "New" : "Account not found"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="dup-review-actions">
            <button className="modal-secondary" onClick={() => setPendingSetupImport(null)} disabled={busy}>
              Cancel
            </button>
            <button
              onClick={confirmSetupImport}
              disabled={
                busy ||
                pendingSetupImport.includedAccounts.size +
                  pendingSetupImport.includedCategories.size +
                  pendingSetupImport.includedBudgets.size +
                  pendingSetupImport.includedBuckets.size +
                  pendingSetupImport.includedHoldings.size ===
                  0
              }
            >
              {busy ? "Importing…" : "Import selected"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "accounts" && (
        <AccountsView
          accounts={accounts}
          manualAssetsTotal={assets.reduce((s, a) => s + parseFloat(a.value), 0)}
          onSetStartingBalance={handleSetStartingBalance}
          onSetBalanceOverride={handleSetBalanceOverride}
          onUpdateAccountType={handleUpdateAccountType}
          onDeleteAccount={handleDeleteAccount}
          onSetAccountDetails={handleSetAccountDetails}
          familyMembers={familyMembers}
          onSetAccountMember={handleSetAccountMember}
          onAddAccount={handleNewAccount}
        />
      )}

      {activeTab === "reports" && !pendingSetupImport && (
        <ReportsView
          report={report}
          accounts={accounts}
          buckets={buckets}
          transactions={transactions}
          assets={assets}
          familyMembers={familyMembers}
          onExportCsv={handleExportReportsCsv}
          onPrint={() => window.print()}
          onDownloadSetupTemplate={handleDownloadSetupTemplate}
          onImportSetupData={handleImportSetupData}
          onCreateAsset={handleCreateAsset}
          onUpdateAssetValue={handleUpdateAssetValue}
          onSetAssetMember={handleSetAssetMember}
          onDeleteAsset={handleDeleteAsset}
          onOpenBudget={() => setActiveTab("budget")}
        />
      )}

      {activeTab === "settings" && (
        <SettingsView
          appVersion={appVersion}
          dataFileLocation={dataFileLocation}
          onRelocateDataFile={handleRelocateDataFile}
          backups={backups}
          onCreateBackupNow={handleCreateBackupNow}
          onRestoreBackup={handleRestoreBackup}
          profiles={profiles}
          onCreateProfile={handleCreateProfile}
          onUseExistingDataFile={handlePickExistingDataFile}
          onSwitchProfile={handleSwitchProfile}
          onRenameProfile={handleRenameProfile}
          onDeleteProfile={handleDeleteProfile}
          livePriceSettings={livePriceSettings}
          onSetLivePriceApiKey={handleSetLivePriceApiKey}
          onRefreshLivePrices={handleRefreshLivePrices}
        />
      )}

      {dialog?.kind === "newAccount" && (
        <NewAccountDialog
          familyMembers={familyMembers}
          onCancel={() => {
            dialog.resolve(null);
            setDialog(null);
          }}
          onSubmit={(name, accountType, startingBalance, institution, mask, memberId) => {
            dialog.resolve({ name, accountType, startingBalance, institution, mask, memberId });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "newCategory" && (
        <NewCategoryDialog
          onCancel={() => {
            dialog.resolve(null);
            setDialog(null);
          }}
          onSubmit={(name) => {
            dialog.resolve(name);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "confirmInvert" && (
        <ConfirmInvertDialog
          onCancel={() => {
            dialog.resolve(false);
            setDialog(null);
          }}
          onConfirm={() => {
            dialog.resolve(true);
            setDialog(null);
          }}
        />
      )}
      {manageCategoriesOpen && (
        <ManageCategoriesDialog
          categories={usedCategories}
          onCancel={() => setManageCategoriesOpen(false)}
          onCreate={handleCreateCategory}
          onRename={handleRenameCategory}
          onDelete={handleDeleteCategory}
        />
      )}
      {manageFamilyMembersOpen && (
        <ManageFamilyMembersDialog
          members={familyMembers}
          onCancel={() => setManageFamilyMembersOpen(false)}
          onCreate={handleCreateFamilyMember}
          onRename={handleRenameFamilyMember}
          onDelete={handleDeleteFamilyMember}
        />
      )}
      {pendingExistingDbPath && (
        <UseExistingDataFileDialog
          path={pendingExistingDbPath}
          onCancel={() => setPendingExistingDbPath(null)}
          onSubmit={handleAddExistingProfile}
        />
      )}
      {newTransactionOpen && (
        <NewTransactionDialog
          accounts={accounts}
          categories={categoryOptions}
          familyMembers={familyMembers}
          defaultAccountId={selectedAccountId}
          budgetActuals={report?.budget_actuals ?? []}
          onCancel={() => setNewTransactionOpen(false)}
          onSubmit={handleCreateManualTransaction}
        />
      )}
        </div>
      </div>
    </div>
  );
}

/** Forces a full re-fetch of every piece of app state after the data file
 * underneath it changes (relocate/restore) — remounting under a fresh `key`
 * re-runs every one of `App`'s mount-time effects from scratch, the same as
 * a real app restart would, without ever closing or reopening the native
 * window. A real restart (via `tauri-plugin-process`'s `relaunch()`) was
 * tried first and dropped: on Windows it occasionally raced the outgoing
 * WebView2 instance's teardown against the new one's startup, leaving the
 * relaunched window stuck on a native "can't reach this page" error. */
function PennyWorthApp() {
  const [reloadKey, setReloadKey] = useState(0);
  const [initialStatus, setInitialStatus] = useState("");

  return (
    <App
      key={reloadKey}
      initialStatus={initialStatus}
      onDataFileChanged={(message) => {
        setInitialStatus(message);
        setReloadKey((k) => k + 1);
      }}
    />
  );
}

export default PennyWorthApp;
