// Seeds a throwaway test database with fixture data, using the app's own
// compiled binary once (headless — no WebDriver) to create the schema,
// then writing fixture rows directly via Python's sqlite3 module (the same
// direct-sqlite technique used all session to verify the user's real data).
// Avoids needing to drive native file-picker dialogs (CSV import) just to
// get test data into the ledger.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_EXE = path.resolve("target/debug/pennyworth.exe");

export function freshTestDbDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pennyworth-e2e-"));
}

// Launches the app briefly (non-WebDriver) against `dbDir` so init_schema
// runs and creates pennyworth.db, then kills it.
async function createSchema(dbDir) {
  const proc = spawn(APP_EXE, [], { env: { ...process.env, PENNYWORTH_DB_DIR: dbDir }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1500));
  proc.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
}

// Runs a python snippet against the db, with `dbPath` available as `DB_PATH`.
function runSqlite(dbPath, pySnippet) {
  const script = `
import sqlite3
con = sqlite3.connect(r"${dbPath}")
cur = con.cursor()
${pySnippet}
con.commit()
con.close()
`;
  execFileSync("python", ["-c", script], { stdio: "inherit" });
}

/**
 * Generic fixture helper: creates a fresh test DB dir (schema only), then
 * runs the given python sqlite3 snippet against it (available as `cur`/
 * `con`). Returns the dbDir. Use this for any feature-specific fixture
 * instead of writing a new one-off createSchema+runSqlite pair.
 *
 * Note: `createSchema` briefly runs the real app (to trigger init_schema),
 * which also runs its normal startup fetches — for the *current* calendar
 * month specifically, that already touches `budget_periods` (and
 * materializes an empty budget for it). If your snippet inserts into
 * `budget_periods` for the current month, use `INSERT OR IGNORE`.
 */
export async function seedFixture(pySnippet) {
  const dbDir = freshTestDbDir();
  await createSchema(dbDir);
  runSqlite(path.join(dbDir, "pennyworth.db"), pySnippet);
  return dbDir;
}

/**
 * Seeds a fresh test DB dir with:
 * - a "Checking" account (checking, starting balance 1000)
 * - a "Car Loan" account (loan, starting balance 10000)
 * - one transaction in Checking: "Loan Payment", -500.00, dated 2026-08-20
 * Returns the dbDir.
 */
export async function seedDebtPaymentFixture() {
  const dbDir = freshTestDbDir();
  await createSchema(dbDir);
  const dbPath = path.join(dbDir, "pennyworth.db");
  runSqlite(
    dbPath,
    `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Car Loan', 'loan', '10000.00')")
loan_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-20", "Loan Payment", "-500.00", "Transfer", f"{checking_id}|2026-08-20|loan payment|-500.00"),
)
`,
  );
  return dbDir;
}
