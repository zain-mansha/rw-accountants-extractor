import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'samples','extractor');
function pdf(text){
  const escaped=text.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const stream=Buffer.from(`BT\n/F1 10 Tf\n50 780 Td\n(${escaped}) Tj\nET\n`,'latin1');
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [1 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}endstream\nendobj\n5 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,'latin1');
}
const documents={
  'Sample-HSBC-statement.pdf':`HSBC CURRENT ACCOUNT\nDate Details Receipt Payment\n01/10/2026 Shell fuel 45.20 DR\n02/10/2026 Taxi fares 180.00 CR\n03/10/2026 BP fuel 52.10 DR\n04/10/2026 Customer transfer 220.00 CR\n05/10/2026 Insurance 89.99 DR`,
  'Sample-Lloyds-statement.pdf':`Lloyds Bank\nDate Description Debit Credit\n06/10/2026 Car wash 18.00 DEBIT\n07/10/2026 Card payment 64.30 DEBIT\n08/10/2026 Taxi income 315.00 CREDIT\n09/10/2026 Cash deposit 90.00 CREDIT\n10/10/2026 Phone bill 24.99 DEBIT`,
  'Sample-Monzo-statement.pdf':`Monzo current account\nDate Details Amount\n2026-10-11 Shell fuel 47.80 DR\n2026-10-12 Fare income 260.00 CR\n2026-10-13 Repair garage 125.00 DR\n2026-10-14 Fare income 198.50 CR\n2026-10-15 Parking 12.00 DR`,
  'Sample-Barclays-statement.pdf':`Barclays Bank Account\nYour transactions\n01/10/2026 Card Purchase Shell 41.20 DR\n02/10/2026 Received From Taxi Driver 240.00 CR\n03/10/2026 Card Purchase BP 55.00 DR\n04/10/2026 Bill Payment Insurance 76.40 DR\n05/10/2026 Received From Customer 190.00 CR`,
  'Sample-Fuel-invoice.pdf':`FUEL SUPPLIES LTD\nInvoice number: FUEL-1042\nInvoice date: 11/10/2026\nSupplier: Fuel Supplies Ltd\nSubtotal: 100.00\nVAT: 20.00\nTotal due: 120.00`,
  'Sample-Car-wash-invoice.pdf':`CITY CAR WASH\nInvoice No: CW-2088\nDate: 12/10/2026\nSupplier: City Car Wash\nSubtotal: 25.00\nVAT: 5.00\nTotal: 30.00`,
  'Sample-Repair-invoice.pdf':`TAXI MOTORS\nTax invoice number: TM-7719\nInvoice date: 13/10/2026\nSupplier: Taxi Motors\nNet amount: 250.00\nVAT amount: 50.00\nAmount due: 300.00`
};
await mkdir(out,{recursive:true});
for(const [name,text] of Object.entries(documents))await writeFile(path.join(out,name),pdf(text));
await writeFile(path.join(out,'README.txt'),`Synthetic test documents for Extractor. These are invented examples, not genuine bank or supplier documents.\n\nBank PDFs test HSBC, Lloyds, Monzo and Barclays-style date/details/amount layouts. Invoice PDFs test fuel, car wash and repair suppliers with VAT.\n\nUse Extractor -> Bank statements or Invoices, review the detected values, then download the Excel workbook.\n`,'utf8');
console.log(`Created ${Object.keys(documents).length} sample PDFs in ${out}`);
