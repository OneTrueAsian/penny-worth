import { useState } from "react";
import type { Backup } from "./types";

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
      <p className="account-name-detail" style={{ userSelect: "text" }}>
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

export function SettingsView({
  dataFileLocation,
  onRelocateDataFile,
  backups,
  onCreateBackupNow,
  onRestoreBackup,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string) => void;
}) {
  return (
    <div className="reports-view">
      <SettingsSection dataFileLocation={dataFileLocation} onRelocateDataFile={onRelocateDataFile} />
      <BackupsSection backups={backups} onCreateBackupNow={onCreateBackupNow} onRestoreBackup={onRestoreBackup} />
    </div>
  );
}
