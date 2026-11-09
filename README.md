# ClearCount

A local Windows bookkeeping application for taxi drivers. No account, internet connection, or hosted website is needed to use it.

## Open the application

Double-click **Start ClearCount.cmd**, or open **release/ClearCount/ClearCount.exe**. The entire `ClearCount` folder is the portable application; keep its supporting files together. The initial workspace contains clearly marked fictional demo records. Select **Create profile** to start empty books for a real driver.

For PDF preparation, double-click **Start Extractor.cmd**, or open **release/Extractor/Extractor.exe**. The complete `release/Extractor` folder is portable; copy it to another Windows laptop and keep the folder together. The companion is branded **R&W Accountants · Extractor**: add bank statement PDFs or invoice PDFs, review the editable extracted rows, and download an Excel workbook. The bank workbook can be imported from **Transactions → Import statement**. The invoice workbook can be imported from **Invoices & contacts → Import extracted invoices**.

Records are stored in the `data` folder beside `ClearCount.exe`. Back up from **Settings & backup → Download full backup**. A backup includes every driver and year, attachments, invoice payments, mileage, rules, and audit history. The backup is a readable JSON file; keep it secure. Exports are working papers, not a substitute for a full backup. Close the application before moving its folder. Your records are not encrypted or protected by a separate application password.

## Main workflows

- **Driver profiles:** Separate books, contacts, categories, and years for each taxi driver.
- **Excel / CSV imports:** Choose the worksheet and header row; map Date, Details, a signed Receipt/Payment amount, or separate Receipt and Payment columns. Ignore other columns. Choose UK or US date order and invert amount signs when necessary. Invalid dates, missing details, ambiguous split amounts, and possible duplicates are flagged before import. Select the target bank or cash account. Valid rows in earlier or later open periods are routed to their own financial periods and transaction tabs. A maximum of 10 MB / 50,000 rows per statement is supported; password-encrypted workbooks are not supported.
- **PDF extraction:** Extractor reads selectable text from bank statements and invoices on this computer. It produces an editable bank workbook with Date, Details, Receipt, Payment and Balance columns, or an invoice workbook with invoice number, date, supplier, subtotal, VAT and total. Rows are marked for review when the PDF layout is ambiguous. Scanned PDFs use the pinned, offline Tesseract OCR engine, English model, and PDF.js renderer shipped inside the application. The launcher verifies these files and their model checksum; it does not install or fall back to Windows OCR. Password-protected bank PDFs prompt for their statement password. After a successful OCR read, you can also save a new local readable PDF copy; the original encrypted file is left unchanged.
- **Invoice batch filing:** When every selected invoice has been extracted successfully, Extractor automatically saves a timestamped invoice workbook in Downloads and moves the source PDFs into a `Processed` folder beside their original files. If extraction or filing fails, the source PDFs are left in place.
- **Categories:** Use the taxi expense defaults or add your own top-level categories and subcategories, such as Expenses: Cleaning. Import rules can classify recurring statement details. Amounts use integer pence.
- **Bank & cash:** Keep multiple accounts, enter opening balances, transfer funds, and reconcile closing balances against statements or counted cash. Transfers have two linked entries and do not affect profit. Reconciled entries must be unreconciled before editing; backdated changes invalidate affected reconciliation results.
- **Invoices & receipts:** Add suppliers and customers; import extracted invoice workbooks or enter purchase bills, fuel receipts, and sales invoices. Imported VAT is retained with the invoice; the total is posted to the selected expense category. Attach a PDF or image up to 3 MB. Match an existing statement transaction or record a new full or partial payment. Invoice matching replaces the payment’s expense category with creditors/debtors, preventing duplicate expenses. Supplier payments entered under Suppliers remain in the **Awaiting invoices** queue until they are matched; one invoice can cover many payments, and several invoices can cover one payment. The contact account shows invoices and split allocations for each supplier or customer. To correct an invoice, unlink any payments, remove it, and enter the corrected invoice.
- **Business use:** Split expenses between business costs and owner drawings using a business-use percentage. Partial invoice payments allocate rounded business costs cumulatively so they add up exactly to the invoice’s business portion.
- **Reports:** The interactive Accounts overview groups income, cost of sales, expenses, assets, suppliers, liabilities, and capital by subcategory. Click a row to inspect its ledger and add a transaction or receipt, or add another report section. Cash-basis or accrual profit & loss, an accrual balance sheet, trial balance, general ledger, a nine-box VAT draft, and a year-end review remain available. A draft banner identifies supplier payments still awaiting proof. Export Excel accounts, including the overview, proof queue, and invoice allocations, plus Excel/CSV transactions, a VAT draft CSV, mileage CSV, and print reports or save as PDF.
- **Financial years:** Add non-overlapping years and switch between them. Open entries dated just before or after the selected year create the adjacent financial period automatically and appear in the Previous periods or Next periods tab. Balance-sheet balances carry forward from the complete ledger without duplicating opening entries. Lock a completed year to prevent changes, with explicit unlocking recorded in the audit history. An invoice from a locked prior year can be settled in an open later year.
- **Mileage & audit:** Record business journeys and preserve a history of changes.

## Fast manual entry

**Add transaction** opens a compact form. Choose the bank/cash account and receipt/payment direction once. Date and those settings carry into the next entry. Type the details, select a category, enter the amount, and press **Enter in the amount field** or **Ctrl+Enter** to save and continue. **Save & close** finishes the session. The amount and details clear after each save, and focus returns to details. More options holds business-use percentages and contacts; there is no attachment field in quick entry.

Entry forms have **Category** and **Subcategory** boxes side by side. Choose a category such as Expenses or Suppliers, then type **F** in Subcategory and press **Tab** or **Enter** to select Fuel. Previously used subcategories on this account appear first. You can also use arrow keys or click a suggestion. A recognised merchant fills both boxes, business-use percentage, and contact automatically. Manual overrides take priority. Memory is separate for each driver, bank/cash account, and receipt/payment direction; it is included in backups and survives reopening the application. Conflicting historical choices are left for review until you explicitly categorise that merchant again.

**New subcategory** (also Alt+N) opens an editor inside the current entry, preserving the date, details, and amount. For a supplier subcategory, choose the expense category to use when its receipt is entered, or let the app create a corresponding expense category.

The distinction between these categories is:

- **Expenses → Fuel/Cleaning/etc.:** records a business expense directly. No receipt or invoice is needed to settle its balance.
- **Capital account → Drawings/Capital introduced:** records an owner capital movement directly. No invoice is required, and it does not count as business income or expense.
- **Suppliers → Fuel/Car wash/etc.:** holds bank/cash payments awaiting a matching receipt or invoice. The receipt posts to its linked expense category and credits the same supplier subaccount, clearing the payment balance and recognising the cost once. Unmatched supplier payments are flagged as Awaiting receipt and excluded from profit until allocated.

Existing transaction amounts and classifications are preserved when the application adds these groups to an older chart. Supplier Fuel links to Expenses: Fuel; Supplier Car wash links to Expenses: Cleaning. Optional receipts matched to direct expense transactions still avoid double-counting.

**Quick receipt / Add receipt** needs the date, supplier name, category, and total. New suppliers are created automatically, descriptions are generated, and receipt references receive unique numbers. No image is required. Business use and a paper receipt reference are optional under the expandable section. Use Save & next to enter a pile of receipts in one session.

Receipt entry starts at **Date** and returns there after each Save & next. Quick-entry dates accept `111126`, `11112026`, or `11/11/2026`; pressing Tab formats the compact input as **11/11/2026**. Impossible dates are rejected, and stored dates remain unambiguous ISO dates. The previous valid date remains selected so you can overwrite it or Tab past it for another receipt on the same day.

Choose receipt payment handling once:

- **Match existing statement payment:** matches the same account, merchant, date, and amount. One match is linked automatically. Multiple matches require a choice. Without a match, the receipt remains unpaid for later matching; no extra bank payment is invented.
- **Record a new payment:** for manual receipts whose payment is not already recorded in the bank/cash ledger. This records and settles the receipt together.
- **Unpaid supplier bill:** records an outstanding invoice without a payment. Use the full Add invoice form if you need a separate due date or a sales invoice.

**Auto categorise** on Transactions previews all clear remembered matches in the current filters, across every page. It fills uncategorised entries only; transfers, linked invoice payments, reconciled transactions, and locked years are preserved. Categorising Shell or BP once teaches later merchant variants on that account. Manual corrections update the remembered choice. You can still add explicit import rules for other description patterns.

Statement import review also offers **Auto complete from memory**. It fills remembered categories, subcategories, business-use percentages, and contacts before you commit the import. Explicit import rules and categories already assigned in the preview are preserved.

Click a transaction column heading to sort by **date, name/details, account, category, amount, or status**; click again to reverse the order. For example, search Shell, choose **Select all matching**, then **Categorise** to update the whole group across pages. Individual checkboxes and Shift-click range selection are also available. Choose 25, 50, or 100 rows per page. Saving consecutive entries refreshes the main reports when the entry window closes, avoiding a dashboard rebuild for every receipt.

## VAT and accounting scope

The VAT return tab is the first VAT implementation. Set the VAT registration number, cash or accrual VAT basis, and return frequency in **Reports → VAT return → VAT settings**. Code transactions and invoices as standard, reduced, zero-rated, exempt, out-of-scope, or blocked input. ClearCount calculates the nine standard UK VAT boxes for the selected financial year, lets you save a versioned local draft, and exports the draft CSV. Existing invoices with an extracted VAT amount use that amount; gross-only entries use the selected VAT rate. Review the draft with the firm before filing.

The VAT tab also includes an HMRC connector. Register ClearCount as an application in the [HMRC Developer Hub](https://developer.service.hmrc.gov.uk/), add the redirect URI `http://localhost:8765/oauth/callback`, add the public IP address used by the computer running ClearCount in CIDR form (for example `80.7.93.158/32`), and subscribe the application to the VAT (MTD) API and the required test support APIs. Enter the sandbox client ID and secret through **Connect HMRC**, complete the Government Gateway journey in your browser, then use **Check HMRC VAT obligations**. Select the open obligation and confirm the declaration before submitting. ClearCount sends the nine-box values, PKCE OAuth tokens, and desktop fraud-prevention headers from Electron's main process. The desktop callback uses the fixed localhost port `8765`, so the same URI must be registered in HMRC.

Income Tax MTD is now connected to the same sandbox authorisation. Use **Set up Income Tax MTD** to enter a client's National Insurance number, discover the HMRC self-employment business, retrieve Income Tax obligations, review the cumulative turnover and expenses, and explicitly approve an update before it is sent. The connector currently covers the self-employment cumulative update and calculation trigger; annual adjustments, losses, end-of-period statements, final declarations, and agent relationship management remain the next build stages. HMRC requires testing every subscribed endpoint and compliant fraud-prevention data before production approval.

Profit reports are **bookkeeping profit before tax adjustments**, not a personal tax calculation or an HMRC submission. Making Tax Digital submission, capital allowances, and personal Income Tax / National Insurance calculations are not implemented. All entries are gross GBP amounts. Record gross platform fares and platform fees separately if the platform pays a net amount. Mileage is a working record; it is not automatically deducted in addition to fuel or other motor costs.

Cash-basis reports recognise direct receipts/payments and allocated invoice settlements in their payment year. They exclude unpaid invoices and non-cash journals. Uncategorised transactions and unallocated creditor/debtor payments are excluded from profit and flagged for review. Accrual reports recognise invoices when dated, direct expenses, and adjustment journals. The balance sheet and trial balance always use the accrual ledger; accumulated profit there may differ from a cash-basis profit report. Journals affecting bank/cash balances are best used for opening balances; record actual business cash movements as transactions so they appear in cash-basis profit reports. Loans and drawings are not expenses. Opening creditors/debtors represented only by a general journal have no individual contact allocation; use dated invoices and recorded settlement links for contact-level balances.

HMRC describes the distinction between cash-basis and traditional accounting in its [self-employed record-keeping guidance](https://www.gov.uk/self-employed-records/overview). Review the relevant treatment and tax adjustments before completing a driver’s tax return. Cash basis has been the default for eligible businesses from the 2024–25 tax year, but an individual driver’s correct reporting method must be selected. [HMRC cash-basis guidance](https://www.gov.uk/simpler-income-tax-cash-basis).

## Source and verification

`dist/` contains the interface, Excel library, and ledger engine. `extractor/main.cjs` wraps it in a isolated Electron desktop window using a private application protocol, with Node integration disabled in the interface and network requests blocked. Financial data stays on disk in the application’s data folder; the optional HMRC help link opens your normal browser.

The portable Node runtime at `.tools/node-v22.23.3-win-x64/node.exe` runs development commands without a global Node installation:

```powershell
& '.tools/node-v22.23.3-win-x64/node.exe' --test tests/core.test.cjs tests/fast-entry.test.cjs tests/supplier-categories.test.cjs
& '.tools/node-v22.23.3-win-x64/node.exe' scripts/package-desktop.mjs
& '.tools/node-v22.23.3-win-x64/node.exe' tests/desktop.test.mjs
```

Desktop tests run against the packaged application with a separate temporary data folder. They must never use your real `data` directory. The runtime is bundled for local use; there is no auto-updater. The executable is unsigned.





Extractor runs locally without activation. To make a transferable desktop package, run `npm run package:extractor`; for shared network use with separate username workspaces, run `npm run package:extractor:network` and follow [NETWORK-DEPLOYMENT.md](NETWORK-DEPLOYMENT.md).

