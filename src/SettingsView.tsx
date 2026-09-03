import { FormEvent, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Backup, LivePriceProviderId, LivePriceSettings, Profile } from "./types";
import { useAutoCancelDelete } from "./useAutoCancelDelete";

const LIVE_PRICE_PROVIDERS: Record<
  LivePriceProviderId,
  { label: string; signupUrl: string; keyPlaceholder: string; blurb: string; usageNote: string }
> = {
  alpha_vantage: {
    label: "Alpha Vantage",
    signupUrl: "https://www.alphavantage.co/support/#api-key",
    keyPlaceholder: "Alpha Vantage API key",
    blurb:
      "Alpha Vantage's free tier is limited to 25 requests/day — plenty for a small portfolio checked a few times a day, tight for a large one refreshed constantly.",
    usageNote: "using your Alpha Vantage API key",
  },
  finnhub: {
    label: "Finnhub",
    signupUrl: "https://finnhub.io/register",
    keyPlaceholder: "Finnhub API key",
    blurb:
      "Finnhub's free tier allows 60 requests/minute — comfortably more than this app needs at once, so there's no daily cap to track.",
    usageNote: "using your Finnhub API key",
  },
  twelve_data: {
    label: "Twelve Data",
    signupUrl: "https://twelvedata.com/register",
    keyPlaceholder: "Twelve Data API key",
    blurb: "Twelve Data's free tier is limited to 800 requests/day — plenty for a large portfolio checked often.",
    usageNote: "using your Twelve Data API key",
  },
};

function SettingsSection({
  dataFileLocation,
  onRelocateDataFile,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Data file</span>
      </div>
      <p className="modal-message-secondary">Data file location</p>
      <p className="path-box" style={{ userSelect: "text" }}>
        {dataFileLocation ?? "Loading…"}
      </p>
      <button type="button" className="modal-secondary" onClick={onRelocateDataFile}>
        Move data file…
      </button>
    </div>
  );
}

function BackupsSection({
  backups,
  onCreateBackupNow,
  onRestoreBackup,
}: {
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string) => void;
}) {
  const [confirmingRestoreFilename, setConfirmingRestoreFilename] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Backups</span>
        <button type="button" className="modal-secondary" onClick={onCreateBackupNow}>
          Back up now
        </button>
      </div>
      <p className="modal-message-secondary">
        Penny Worth backs up automatically once a day when you open it, keeping the most recent 15. Restoring backs
        up your current data first, then reloads it — no restart needed.
      </p>
      <table className="ledger">
        <thead>
          <tr>
            <th>Created</th>
            <th className="amount-col">Size</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={b.filename}>
              <td>{b.created_at}</td>
              <td className="amount-col">{(b.size_bytes / 1024).toFixed(0)} KB</td>
              <td className="actions-col">
                {confirmingRestoreFilename === b.filename ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingRestoreFilename(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onRestoreBackup(b.filename);
                        setConfirmingRestoreFilename(null);
                      }}
                    >
                      Restore
                    </button>
                  </span>
                ) : (
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingRestoreFilename(b.filename)}>
                    Restore
                  </button>
                )}
              </td>
            </tr>
          ))}
          {backups.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-state">
                No backups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LivePricesSection({
  settings,
  onSetApiKey,
  onRefreshNow,
}: {
  settings: LivePriceSettings | null;
  onSetApiKey: (provider: LivePriceProviderId, apiKey: string | null) => void;
  onRefreshNow: () => void;
}) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [pickerProvider, setPickerProvider] = useState<LivePriceProviderId>(settings?.provider ?? "alpha_vantage");

  // Keep the picker in sync with the last-saved provider whenever the
  // feature is off, so re-opening Settings pre-selects what was last used
  // rather than always resetting to Alpha Vantage.
  useEffect(() => {
    if (settings && !settings.enabled) setPickerProvider(settings.provider);
  }, [settings?.enabled, settings?.provider]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    onSetApiKey(pickerProvider, trimmed);
    setApiKeyInput("");
  }

  const used = settings?.requests_used_today ?? 0;
  const limit = settings?.requests_limit ?? null;
  const atLimit = limit != null && used >= limit;
  // "Approaching" starts 5 requests before the cutoff — early enough to be
  // a heads-up, not just a surprise the moment it's already too late.
  const approachingLimit = limit != null && !atLimit && used >= limit - 5;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Live stock prices</span>
      </div>
      {settings?.enabled ? (
        <>
          <p className="modal-message-secondary">
            Prices refresh automatically when the app opens, and every 2 hours while it stays open — one request
            per distinct symbol you hold, {LIVE_PRICE_PROVIDERS[settings.provider].usageNote}. New holdings can also
            auto-fill their starting price by symbol.
          </p>
          <p className="modal-message-secondary">
            Last refreshed: {settings.last_refreshed_at ?? "not yet — click Refresh now below"}
          </p>
          {limit != null ? (
            <p
              className={
                atLimit ? "live-price-usage live-price-usage-limit"
                : approachingLimit ? "live-price-usage live-price-usage-warning"
                : "live-price-usage"
              }
            >
              {atLimit
                ? `Daily limit reached (${used}/${limit}) — refreshes and autofill are paused until tomorrow.`
                : approachingLimit
                  ? `${used} of ${limit} requests used today — getting close to the daily limit.`
                  : `${used} of ${limit} requests used today.`}
            </p>
          ) : (
            <p className="modal-message-secondary">
              {used} request{used === 1 ? "" : "s"} used today — Finnhub's free tier allows 60 requests/minute, so
              there's no daily cap to track.
            </p>
          )}
          <div className="category-manage-actions">
            <button type="button" className="modal-secondary" onClick={onRefreshNow} disabled={atLimit}>
              Refresh now
            </button>
            <button type="button" className="modal-secondary" onClick={() => onSetApiKey(settings.provider, null)}>
              Disable
            </button>
          </div>
        </>
      ) : (
        <>
          <select
            className="row-edit-input"
            value={pickerProvider}
            onChange={(e) => setPickerProvider(e.target.value as LivePriceProviderId)}
          >
            {(Object.keys(LIVE_PRICE_PROVIDERS) as LivePriceProviderId[]).map((id) => (
              <option key={id} value={id}>
                {LIVE_PRICE_PROVIDERS[id].label}
              </option>
            ))}
          </select>
          <p className="modal-message-secondary">
            Off by default — holding prices stay fully manual, edited directly on the Investments tab. Add a free{" "}
            {LIVE_PRICE_PROVIDERS[pickerProvider].label} API key to auto-fill prices for new holdings and keep
            existing ones current.
          </p>
          <p className="modal-message-secondary">{LIVE_PRICE_PROVIDERS[pickerProvider].blurb}</p>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => openUrl(LIVE_PRICE_PROVIDERS[pickerProvider].signupUrl)}
          >
            Get a free API key →
          </button>
          <form className="category-create-form" onSubmit={handleSave}>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={LIVE_PRICE_PROVIDERS[pickerProvider].keyPlaceholder}
            />
            <button type="submit" disabled={!apiKeyInput.trim()}>
              Save
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function ProfilesSection({
  profiles,
  onCreateProfile,
  onUseExistingDataFile,
  onSwitchProfile,
  onRenameProfile,
  onDeleteProfile,
}: {
  profiles: Profile[];
  onCreateProfile: (name: string) => void;
  /** Opens the native file picker for an existing `.db` file brought over
   * from another machine — see `App.tsx`'s `handlePickExistingDataFile`.
   * Takes no arguments; the picked path flows back through a separate
   * dialog (`UseExistingDataFileDialog`) that asks for a name, same
   * division of labor as `onRelocateDataFile`. */
  onUseExistingDataFile: () => void;
  onSwitchProfile: (id: string) => void;
  onRenameProfile: (id: string, newName: string) => void;
  onDeleteProfile: (id: string) => void;
}) {
  const [newProfileName, setNewProfileName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    onCreateProfile(trimmed);
    setNewProfileName("");
  }

  function startEditing(p: Profile) {
    setConfirmingDeleteId(null);
    setEditingId(p.id);
    setDraftName(p.name);
  }

  function commitRename(id: string, oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRenameProfile(id, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Profiles</span>
      </div>
      <p className="modal-message-secondary">
        Each profile is a completely separate, independent data file — switching loads a different set of accounts,
        transactions, and everything else. Nothing is shared between profiles.
      </p>
      <table className="ledger">
        <thead>
          <tr>
            <th>Name</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>
                {editingId === p.id ? (
                  <input
                    autoFocus
                    className="row-edit-input"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(p.id, p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p.id, p.name);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    {p.name}
                    {p.is_active && <span className="account-col"> (current)</span>}
                  </>
                )}
              </td>
              <td className="actions-col">
                {confirmingDeleteId === p.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDeleteProfile(p.id)}>
                      Delete
                    </button>
                  </span>
                ) : (
                  <span className="row-delete-confirm">
                    {!p.is_active && (
                      <button type="button" className="modal-secondary" onClick={() => onSwitchProfile(p.id)}>
                        Switch
                      </button>
                    )}
                    <button type="button" className="modal-secondary" onClick={() => startEditing(p)}>
                      Rename
                    </button>
                    {!p.is_active && (
                      <button
                        type="button"
                        className="modal-secondary"
                        onClick={() => setConfirmingDeleteId(p.id)}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.target.value)}
          placeholder='New profile, e.g. "Alex"'
        />
        <button type="submit" disabled={!newProfileName.trim()}>
          New profile…
        </button>
        <button type="button" className="modal-secondary" onClick={onUseExistingDataFile}>
          Use existing file…
        </button>
      </form>
      <p className="modal-message-secondary">
        Moving to a new computer? "Use existing file…" points Penny Worth at a <code>pennyworth.db</code> you've
        already copied over, instead of starting empty.
      </p>
    </div>
  );
}

export function SettingsView({
  dataFileLocation,
  onRelocateDataFile,
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  profiles,
  onCreateProfile,
  onUseExistingDataFile,
  onSwitchProfile,
  onRenameProfile,
  onDeleteProfile,
  livePriceSettings,
  onSetLivePriceApiKey,
  onRefreshLivePrices,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string) => void;
  profiles: Profile[];
  onCreateProfile: (name: string) => void;
  onUseExistingDataFile: () => void;
  onSwitchProfile: (id: string) => void;
  onRenameProfile: (id: string, newName: string) => void;
  onDeleteProfile: (id: string) => void;
  livePriceSettings: LivePriceSettings | null;
  onSetLivePriceApiKey: (provider: LivePriceProviderId, apiKey: string | null) => void;
  onRefreshLivePrices: () => void;
}) {
  return (
    <div className="reports-view">
      <ProfilesSection
        profiles={profiles}
        onCreateProfile={onCreateProfile}
        onUseExistingDataFile={onUseExistingDataFile}
        onSwitchProfile={onSwitchProfile}
        onRenameProfile={onRenameProfile}
        onDeleteProfile={onDeleteProfile}
      />
      <SettingsSection dataFileLocation={dataFileLocation} onRelocateDataFile={onRelocateDataFile} />
      <BackupsSection backups={backups} onCreateBackupNow={onCreateBackupNow} onRestoreBackup={onRestoreBackup} />
      <LivePricesSection
        settings={livePriceSettings}
        onSetApiKey={onSetLivePriceApiKey}
        onRefreshNow={onRefreshLivePrices}
      />
    </div>
  );
}
