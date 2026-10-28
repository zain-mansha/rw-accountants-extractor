# R&W Accountants Extractor on a shared network

Build the production package with `npm run package:network`, then copy `release/Extractor-Network` to the shared folder once. Keep the folder together and give staff read access plus write access for the updater. The repository `zain-mansha/rw-accountants-extractor` is public so the launcher can check `main` without GitHub sign-in.

Staff launch `Start Extractor from Network.cmd` from the shared folder, or use the desktop shortcut it creates. On every launch, the updater checks the public GitHub commit feed, downloads a changed source revision, and installs that revision under `.extractor-apps` on the shared folder. Versioned shared folders and an update lock let users start together without replacing files used by an active session. If GitHub is unavailable, the launcher uses the last complete shared application version.

The changing application code stays on the shared network. Windows may block Electron executables launched directly from a share, so each Windows account keeps one Electron runtime under `%LOCALAPPDATA%\Programs\ExtractorRuntime`; it does not receive a per-build application copy. Workspaces and temporary OCR data stay local to each account. Users can process PDFs from shared drives and save Excel files wherever they have access.

On first launch, each person creates a workspace using a username. Later, they can enter that username or choose it from the recent-workspace list. Workspaces remain on the computer and Windows account where they were created; usernames do not synchronize between computers. The username screen is a workspace selector, not a password-protected login.
