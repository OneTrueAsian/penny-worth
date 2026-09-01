//! Downloads the installer asset for a newer release so "Update now"
//! (`UpdateBanner.tsx`) can hand it straight to the OS's own installer
//! instead of making the user find and download it from GitHub by hand.
//! Deliberately **not** a full auto-updater — nothing here verifies a
//! signature or executes anything; the frontend calls `openPath` on the
//! downloaded file, which just runs the OS's normal installer UI (NSIS/MSI
//! wizard on Windows, mounting the .dmg on macOS), exactly as if the user
//! had downloaded and double-clicked it themselves — a real self-updater
//! (signed, silent, no installer UI) was considered and explicitly not
//! built, since it needs a dedicated signing keypair and CI changes on top
//! of what this app already has.
use std::path::PathBuf;

/// Strips path separators so a filename from an external source (a GitHub
/// release asset's own `name` field) can never be used to write outside the
/// intended temp directory.
fn sanitize_filename(name: &str) -> String {
    name.chars().filter(|c| !matches!(c, '/' | '\\' | ':')).collect()
}

/// Downloads `url` (a GitHub release asset's direct download URL) to a file
/// named `filename` under the OS temp directory, overwriting any leftover
/// file from a previous check. GitHub requires a `User-Agent` header on
/// asset requests or it responds with an error instead of the file.
pub async fn download_asset(client: &reqwest::Client, url: &str, filename: &str) -> Result<PathBuf, String> {
    let response = client
        .get(url)
        .header("User-Agent", "PennyWorth-Updater")
        .send()
        .await
        .map_err(|e| format!("Failed to download the update: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Failed to download the update: server returned {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("Failed to read the downloaded file: {e}"))?;
    let path = std::env::temp_dir().join(sanitize_filename(filename));
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to save the downloaded file: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_strips_path_separators() {
        assert_eq!(sanitize_filename("../../evil.exe"), "....evil.exe");
        assert_eq!(sanitize_filename("Penny.Worth_1.1.4_x64-setup.exe"), "Penny.Worth_1.1.4_x64-setup.exe");
        assert_eq!(sanitize_filename("C:\\Windows\\evil.exe"), "CWindowsevil.exe");
    }
}
