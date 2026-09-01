import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const DISMISSED_VERSION_KEY = "pennyworth-dismissed-update-version";
const REPO = "OneTrueAsian/penny-worth";

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** A small, dismissible banner that checks GitHub's latest release once on
 * launch and nudges the user if the installed app is behind — pure
 * notification, never downloads or installs anything itself (this app has
 * no auto-updater). Failures — offline, GitHub unreachable, rate-limited —
 * are silent; checking for an update is a nice-to-have and should never
 * interrupt using the app. Dismissing remembers that specific version (per
 * viewer, in localStorage) so it won't nag again until a *newer* one ships. */
export function UpdateBanner() {
  const [latest, setLatest] = useState<{ tag: string; version: string; url: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [current, res] = await Promise.all([
          getVersion(),
          fetch(`https://api.github.com/repos/${REPO}/releases/latest`),
        ]);
        if (!res.ok) return;
        const data = await res.json();
        const tag: string = data.tag_name ?? "";
        if (!tag || !isNewer(tag, current)) return;

        let dismissedVersion: string | null = null;
        try {
          dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
        } catch {
          // storage unavailable — just show the banner every launch, harmless
        }
        if (dismissedVersion === tag) return;

        setLatest({ tag, version: tag.replace(/^v/, ""), url: data.html_url ?? `https://github.com/${REPO}/releases` });
      } catch {
        // offline, rate-limited, or GitHub unreachable — silently skip
      }
    })();
  }, []);

  function dismiss() {
    if (latest) {
      try {
        localStorage.setItem(DISMISSED_VERSION_KEY, latest.tag);
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
    }
    setDismissed(true);
  }

  if (!latest || dismissed) return null;

  return (
    <div className="update-banner">
      <span>A new version of Penny Worth ({latest.version}) is available.</span>
      <span className="update-banner-actions">
        <button type="button" className="modal-secondary" onClick={() => openUrl(latest.url)}>
          View release
        </button>
        <button type="button" className="modal-secondary" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
