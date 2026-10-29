# R&W Accountants Extractor on a shared network

Build the production package with `npm run package:network`, then copy `release/Extractor-Network` to the shared folder once. Keep the folder together and give staff read access plus write access for the updater. The repository `zain-mansha/rw-accountants-extractor` is public so the launcher can check `main` without GitHub sign-in.

Staff can start `Start Extractor from Network.cmd` once from the shared folder. It checks the public GitHub commit feed, updates the shared application files when needed, creates a per-user local application copy, and adds a desktop shortcut. The shortcut points to a small local bootstrap. On each launch, it compares the local build with the shared build. If they differ, it syncs from the shared folder; if they match, it checks GitHub, updates the shared build when needed, syncs the local copy, then opens Extractor. Running local copies stay open while another PC updates the shared files. Users do not need to launch the CMD file for normal use.

Each PC keeps its Electron runtime under `%LOCALAPPDATA%\Programs\ExtractorRuntime` and versioned application copies under `%LOCALAPPDATA%\Programs\Extractor\Applications`. The shared folder remains the update source. Workspaces and temporary OCR data stay local to each Windows account. Users can process PDFs from shared drives and save Excel files wherever they have access.

On first launch, each person creates a workspace using a username. Later, they can enter that username or choose it from the recent-workspace list. Workspaces remain on the computer and Windows account where they were created; usernames do not synchronize between computers. The username screen is a workspace selector, not a password-protected login.
