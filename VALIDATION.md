# Validation

Verified on Windows using Node.js 22.23.3 and the packaged Electron 44.7.0 application. Latest application version: 1.3.0.

- **74 ledger and extraction tests passed**: the 65 Fare Books ledger checks plus bank PDF rows, invoice number/date/supplier/VAT/total extraction, safe handling of image-only PDFs, large image streams, compressed PDF streams, Barclays-style OCR rows and date normalisation, ISO-date bank statements, and OCR invoices with ordinal dates.
- **72 desktop workflow checks passed** against the packaged executable with a temporary data directory: import, mapping, categorisation, invoices, receipt attachments, supplier/customer controls, reports, backups, restoration, year creation, bank/cash reconciliation, consecutive entry, keyboard shortcuts, category suggestions, sorting, selection and edits across pages, two category/subcategory boxes, inline subcategory creation with draft preservation, supplier categorisation memory, import-preview autocomplete, `111126` expanding on Tab, receipt focus returning to Date, supplier receipt settlement, awaiting-invoice matching across multiple payments, partial invoice coverage, interactive accounts overview entry, nine-sheet reporting exports, previous/next period tabs, and persistence after a full process restart.
- **4 Extractor desktop checks passed** against the packaged companion: local PDF loading, bank workbook output, invoice workbook output, VAT/total extraction, and workbook download handling.
- **No uncaught interface exceptions** were recorded during desktop testing.
- Screenshots of the overview, imports, compact layout, entry forms, merchant groups, category/subcategory fields, and date-first receipts were inspected and retained in `artifacts/`. Detailed desktop results are in `artifacts/desktop-test-result.json`.

Actual HMRC submissions, VAT calculations, personal tax, physical printers, and password-encrypted workbooks were not tested and are outside the implemented scope. PDF output uses the Windows print dialog. Application tests used fictional data and did not read or replace any real driver records.
