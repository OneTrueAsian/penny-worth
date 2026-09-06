import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose — that one is tailored for Tauri
// dev/build (fixed port, ignores src-tauri, etc.) and shouldn't also carry
// test-runner concerns. Pure-logic modules (no DOM, no Tauri APIs) are the
// intended targets here — anything that touches the real app needs the
// e2e/ WebDriver suite instead, since there's no DOM/Tauri IPC in this
// environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
