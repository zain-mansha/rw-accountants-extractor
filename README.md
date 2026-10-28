# R&W Accountants Extractor

Windows desktop application for extracting supplier invoices, fuel receipts, and bank statement transactions into Excel workbooks. This public repository contains the application source and its focused tests; it does not contain customer PDFs, generated workbooks, or local user data.

## Shared network deployment

Build the network package with Node.js 22 and the Electron runtime in `.tools/electron/`:

```powershell
npm run package:network
```

Copy the complete `release/Extractor-Network/` folder to the shared network location once. Keep the folder together and give users read access plus write access for the updater.

Launch `Start Extractor from Network.cmd` from that shared folder. The packaged `Extractor.exe` also opens the update bootstrap. Each launch checks the public GitHub commit feed for `main`; when it finds a new commit, it downloads the source archive and stages the new app under `.extractor-apps/<commit-sha>/resources/app` on the shared folder. A shared lock coordinates simultaneous first launches, and versioned folders let already-running sessions finish on the app version they started with. If GitHub is unavailable, the launcher uses the last complete app already on the share.

The app's JavaScript, interface, parser, and supplier profiles stay on the shared network. Each Windows account caches only the Electron runtime under `%LOCALAPPDATA%\Programs\ExtractorRuntime`, because Windows does not reliably launch Electron directly from every network share. User workspaces and temporary OCR files remain local to each Windows account.

After the first launch, users can use the desktop shortcut created by the launcher; it points back to the shared updater, so it checks for updates again on every start. Changes committed to `main` become available on the next launch. The repository is public, so its source can be viewed or downloaded without signing in to GitHub.

## Project layout

- `extractor/` contains the Electron application, parser, supplier profiles, Excel export, workspaces, and Windows OCR helpers.
- `scripts/` contains the network launcher and package builder.
- `tests/` contains parser, supplier-profile, launcher, and workspace tests.
- `dist/vendor/` contains the SheetJS workbook library and its third-party license notice.

## Tests

Run the focused suite with:

```powershell
node --test tests/extractor.test.cjs tests/network-launcher.test.cjs tests/workspaces.test.cjs
```

Supplier scan tests require corresponding local sample PDFs and are skipped when samples are not present. Dairy Fresh remains under development.

## Updating the shared app

Commit source changes to the `main` branch. The next launch on any workstation checks that branch and installs the latest complete source revision on the shared folder. The updater needs outbound HTTPS access to `github.com` and `codeload.github.com`, plus write access to the shared package folder.
