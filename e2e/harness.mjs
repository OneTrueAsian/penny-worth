// Minimal Tauri WebDriver E2E harness (no @wdio/cli project, just the
// `webdriverio` standalone client talking to `tauri-driver`, which in turn
// drives the real compiled app through the WebView2 native driver). Used to
// click-test UI that no automated frontend test suite otherwise covers.
//
// Prerequisites installed once for this machine (documented in
// e2e/README.md): `cargo install tauri-driver`, and a msedgedriver.exe
// matching the installed WebView2 Runtime version, both under
// C:\Users\<you>\.cargo\bin.
//
// Before running a spec: `npm run build && cargo build --workspace` so the
// binary under target/debug embeds the current frontend (tauri-driver
// launches the compiled .exe directly, not the vite dev server).

import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { remote } from "webdriverio";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const CARGO_BIN = "C:\\Users\\joeyf\\.cargo\\bin";
const TAURI_DRIVER = path.join(CARGO_BIN, "tauri-driver.exe");
const MSEDGEDRIVER = path.join(CARGO_BIN, "msedgedriver.exe");
const APP_EXE = path.resolve("target/debug/pennyworth.exe");
const PORT = 4445;
const NATIVE_PORT = 9516;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPort(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = async () => {
      const socket = new Socket();
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", async () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`tauri-driver never opened port ${port}`));
        else { await sleep(1000); tryConnect(); }
      });
      socket.connect(port, "127.0.0.1");
    };
    tryConnect();
  });
}

// Every E2E run gets its own throwaway SQLite file — never the user's real
// AppData database. Read by src-tauri/src/lib.rs via PENNYWORTH_DB_DIR.
function freshTestDbDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pennyworth-e2e-"));
  return dir;
}

export async function launchApp({ dbDir } = {}) {
  const testDbDir = dbDir ?? freshTestDbDir();

  const driverProcess = spawn(
    TAURI_DRIVER,
    ["--port", String(PORT), "--native-port", String(NATIVE_PORT), "--native-driver", MSEDGEDRIVER],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PENNYWORTH_DB_DIR: testDbDir } },
  );
  let driverLog = "";
  driverProcess.stdout.on("data", (d) => (driverLog += d.toString()));
  driverProcess.stderr.on("data", (d) => (driverLog += d.toString()));

  await waitForPort(PORT);
  await sleep(500);

  let browser;
  try {
    browser = await remote({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/",
      capabilities: {
        browserName: "wry",
        "tauri:options": { application: APP_EXE },
      },
      logLevel: "silent",
    });
    // WebView2 automation sessions start blank by design (like a browser
    // session starting at about:blank) — Tauri does not auto-navigate under
    // TAURI_WEBVIEW_AUTOMATION, so every test must do this once up front.
    await browser.url("http://tauri.localhost/index.html");
    try {
      await browser.$(".brand-word").waitForExist({ timeout: 15000 });
    } catch (waitErr) {
      const src = await browser.getPageSource().catch(() => "<getPageSource failed>");
      throw new Error(`App loaded but never rendered .brand-word. Page source:\n${src}\n\n${waitErr.stack || waitErr}`);
    }
    // Every fresh test DB (localStorage is per-webview-origin, not shared
    // with a real install) hits the first-launch welcome dialog, which
    // blocks clicks on everything behind its overlay — dismiss it here once
    // so no individual spec needs to know about it.
    const getStarted = await browser.$("button*=Just get started");
    if (await getStarted.isExisting()) {
      await getStarted.click();
    }
  } catch (e) {
    driverProcess.kill();
    throw new Error(`Failed to start session (tauri-driver log below):\n${driverLog}\n\n${e.stack || e}`);
  }

  return {
    browser,
    testDbDir,
    async close() {
      try { await browser.deleteSession(); } catch { /* app may already be gone */ }
      driverProcess.kill();
    },
  };
}
