# R&W Accountants Extractor

Windows desktop application for extracting supplier invoices, fuel receipts, and bank statement transactions into Excel workbooks. The Electron app and OCR processing run locally on each workstation; each username has a separate workspace.

## Project layout

- `extractor/` contains the Electron application, parser, supplier profiles, workbook export, and Windows OCR helpers.
- `scripts/` contains the network launcher and package builder.
- `tests/` contains parser, supplier-profile, launcher, and workspace tests.
- `dist/vendor/` contains the SheetJS workbook library and its third-party license notice.

Invoice samples, customer documents, generated releases, local Electron runtimes, and workspace data are intentionally excluded from this repository.

## Tests

Use Node.js 22 and run:

```powershell
node --test tests/extractor.test.cjs tests/network-launcher.test.cjs tests/workspaces.test.cjs
```

Supplier scan tests require the corresponding local sample PDFs and are skipped when samples are not present. Dairy Fresh remains under development; its current continuation-page test is known to fail and is intentionally not changed as part of unrelated work.

## Build the network package

The package builder expects the pinned Electron runtime at `.tools/electron/` (including `electron.exe` and a `version` file). With that runtime in place, run:

```powershell
npm run package:network
```

The generated `release/Extractor-Network/` folder is a deployment artifact and should be copied to the company network location after testing. It is not committed to this source repository.