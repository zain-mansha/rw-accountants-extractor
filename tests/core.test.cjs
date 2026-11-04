const {test}=require('node:test');
const assert=require('node:assert/strict');
const B=require('../dist/core.js');
const fresh=()=>B.newProfile('Test driver');
const payment=(p,extras={})=>B.addTransaction(p,{date:'2026-10-01',description:'Fuel',accountId:'bank',categoryId:'fuel',amount:-10000,...extras});
const invoice=(p,extras={})=>{if(!p.contacts.length)p.contacts.push({id:'s1',name:'Fuel supplier',type:'supplier'});return B.addInvoice(p,{date:'2026-10-01',due:'2026-10-15',reference:'F001',description:'Fuel',kind:'purchase',categoryId:'fuel',contactId:'s1',amount:10000,...extras});};

test('amounts parse British currency, brackets, and debit markers to exact pence',()=>{
  assert.equal(B.money('£1,234.56'),123456);assert.equal(B.money('(£12.50)'),-1250);assert.equal(B.money('12.50 DR'),-1250);assert.equal(B.money(12.99),1299);
  assert.throws(()=>B.money('1.234'));assert.throws(()=>B.money('broken'));assert.throws(()=>B.money(Infinity));
});
test('dates validate UK/US order, leap years, and both Excel calendars',()=>{
  assert.equal(B.date('09/10/2026'),'2026-10-09');assert.equal(B.date('09/10/2026','MDY'),'2026-09-10');assert.equal(B.date('29/02/2024'),'2024-02-29');assert.equal(B.date('9 Oct 2026'),'2026-10-09');
  assert.equal(B.date(46118),'2026-04-06');assert.equal(B.date(44656,'DMY',true),'2026-04-06');assert.throws(()=>B.date('31/02/2026'));assert.throws(()=>B.date('02/29/2026','MDY'));
});
test('direct fuel payment creates exactly one expense and balanced double entry',()=>{
  const p=fresh();payment(p);assert.equal(B.profit(p,p.years[0]).costs,10000);assert.equal(B.profit(p,p.years[0],'accrual').costs,10000);assert.equal(B.balances(p).bank,-10000);assert.equal(B.balanceSheet(p,p.years[0]).difference,0);
});
test('private use splits an expense from owner drawings',()=>{
  const p=fresh();payment(p,{businessPercent:80});const b=B.balances(p);assert.equal(b.fuel,8000);assert.equal(b.drawings,2000);assert.equal(B.profit(p,p.years[0]).costs,8000);assert.equal(B.balanceSheet(p,p.years[0]).difference,0);
});
test('invoice plus matched payment never doubles the fuel expense',()=>{
  const p=fresh();const t=payment(p);const i=invoice(p);assert.equal(B.profit(p,p.years[0],'accrual').costs,20000);
  B.updateTransaction(p,t.id,{categoryId:'payables',contactId:i.contactId,invoiceId:i.id});assert.equal(B.invoiceBalance(p,i),0);assert.equal(B.balances(p).payables,0);assert.equal(B.profit(p,p.years[0],'accrual').costs,10000);assert.equal(B.profit(p,p.years[0]).costs,10000);
});
test('partial payments recognise only the paid business portion in cash basis',()=>{
  const p=fresh(),i=invoice(p,{businessPercent:80});payment(p,{amount:-4000,categoryId:'payables',contactId:'s1',invoiceId:i.id});
  assert.equal(B.invoiceBalance(p,i),6000);assert.equal(B.profit(p,p.years[0]).costs,3200);assert.equal(B.profit(p,p.years[0],'accrual').costs,8000);assert.equal(B.balances(p).payables,-6000);
});
test('partial payment rounding agrees with the full invoice down to a penny',()=>{
  const p=fresh(),i=invoice(p,{amount:3,businessPercent:50});for(let n=0;n<3;n++)payment(p,{amount:-1,categoryId:'payables',contactId:'s1',invoiceId:i.id});assert.equal(B.profit(p,p.years[0]).costs,2);assert.equal(B.profit(p,p.years[0],'accrual').costs,2);
});
test('overpayments, wrong signs, wrong contacts, and pre-invoice settlements fail',()=>{
  const p=fresh(),i=invoice(p);for(const changes of [{amount:-10001},{amount:1000},{contactId:'wrong'},{date:'2026-09-30'}])assert.throws(()=>payment(p,{categoryId:'payables',contactId:'s1',invoiceId:i.id,...changes}));assert.equal(p.transactions.length,0);
});
test('sales invoices and receipts clear debtors and count income once',()=>{
  const p=fresh();p.contacts.push({id:'customer',name:'Airport client',type:'customer'});const i=invoice(p,{kind:'sale',contactId:'customer',categoryId:'fares'});
  assert.equal(B.profit(p,p.years[0]).revenue,0);assert.equal(B.profit(p,p.years[0],'accrual').revenue,10000);
  payment(p,{description:'Customer receipt',amount:10000,categoryId:'receivables',contactId:'customer',invoiceId:i.id});assert.equal(B.balances(p).receivables,0);assert.equal(B.profit(p,p.years[0]).revenue,10000);assert.equal(B.profit(p,p.years[0],'accrual').revenue,10000);
});
test('new-year balances carry forward without creating duplicate journals',()=>{
  const p=fresh();B.addJournal(p,{date:'2026-04-06',description:'Opening bank and capital',lines:[{accountId:'bank',amount:50000},{accountId:'capital',amount:-50000}]});payment(p);const next=B.addYear(p,'2027-04-06','2028-04-05');
  assert.equal(B.balanceSheet(p,next).totalAssets,40000);assert.equal(B.profit(p,next).costs,0);assert.equal(p.journals.length,1);assert.equal(B.balanceSheet(p,next).difference,0);assert.throws(()=>B.addYear(p,'2027-04-05','2028-04-05'));
});
test('an old invoice settled in the next year is expensed in that cash year',()=>{
  const p=fresh(),i=invoice(p);const next=B.addYear(p,'2027-04-06','2028-04-05');p.years[0].locked=true;
  payment(p,{date:'2027-04-10',categoryId:'payables',contactId:'s1',invoiceId:i.id});assert.equal(B.profit(p,p.years[0]).costs,0);assert.equal(B.profit(p,next).costs,10000);assert.equal(B.profit(p,next,'accrual').costs,0);assert.equal(B.invoiceBalance(p,i,'2027-04-05'),10000);
});
test('locked years reject additions, edits, deletes, invoices, imports and journals',()=>{
  const p=fresh(),t=payment(p);p.years[0].locked=true;assert.throws(()=>payment(p));assert.throws(()=>B.updateTransaction(p,t.id,{categoryId:'cleaning'}));assert.throws(()=>B.removeTransaction(p,t.id));assert.throws(()=>invoice(p));assert.throws(()=>B.addJournal(p,{date:'2026-10-01',description:'X',lines:[{accountId:'bank',amount:1},{accountId:'capital',amount:-1}]}));
  const r=B.importRows(p,[['01/10/2026','Fuel',-10]],{date:0,description:1,amount:2},{accountId:'bank'});assert.equal(r.issues.length,1);
});
test('bank-to-cash transfers change balances without changing profit',()=>{
  const p=fresh(),transferId=B.uid();const a=payment(p,{amount:-20000,categoryId:'transfer',transferId});payment(p,{accountId:'cash',amount:20000,categoryId:'transfer',transferId});
  assert.equal(B.profit(p,p.years[0]).profit,0);assert.equal(B.balances(p).cash,20000);assert.equal(B.balances(p).transfer,0);assert.equal(B.balanceSheet(p,p.years[0]).difference,0);assert.throws(()=>B.updateTransaction(p,a.id,{amount:1}));B.removeTransaction(p,a.id);assert.equal(p.transactions.length,0);
});
test('reconciled transactions cannot be edited or removed',()=>{const p=fresh(),t=payment(p,{reconciled:true});assert.throws(()=>B.updateTransaction(p,t.id,{amount:-1}));assert.throws(()=>B.removeTransaction(p,t.id));});
test('backdated new postings invalidate existing reconciliation results',()=>{const p=fresh();p.reconciliations.push({accountId:'bank',date:'2026-10-08',valid:true});payment(p);assert.equal(p.reconciliations[0].valid,false);});
test('statement column mapping supports split amounts, invalid rows and duplicates',()=>{
  const p=fresh();const rows=[['09/10/2026','Uber','850.00',''],['10/10/2026','Shell','','64.50'],['10/10/2026','Shell','','64.50'],['31/02/2026','Invalid','','5'],['11/10/2026','Both','5','5']];
  const r=B.importRows(p,rows,{date:0,description:1,receipt:2,payment:3},{accountId:'bank'});assert.equal(r.candidates.length,2);assert.equal(r.duplicates.length,1);assert.equal(r.issues.length,2);assert.equal(r.candidates[0].amount,85000);assert.equal(r.candidates[1].amount,-6450);B.commitImport(p,r);
  const again=B.importRows(p,rows,{date:0,description:1,receipt:2,payment:3},{accountId:'bank'});assert.equal(again.candidates.length,0);assert.equal(again.duplicates.length,3);
});
test('signed import amounts can reverse polarity and import rules apply',()=>{
  const p=fresh();p.rules.push({contains:'shell',direction:'payment',categoryId:'fuel',businessPercent:80});const r=B.importRows(p,[['09/10/2026','SHELL LONDON',60]],{date:0,description:1,amount:2},{accountId:'bank',reverse:true});assert.equal(r.candidates[0].amount,-6000);assert.equal(r.candidates[0].categoryId,'fuel');assert.equal(r.candidates[0].businessPercent,80);
  assert.throws(()=>B.importRows(p,[],{date:0,description:0,amount:2},{accountId:'bank'}));assert.throws(()=>B.importRows(p,[],{date:0,description:1,amount:2,payment:3},{accountId:'bank'}));
});
test('journal imbalance fails and non-cash adjustments affect accrual profit only',()=>{
  const p=fresh();assert.throws(()=>B.addJournal(p,{date:'2026-10-01',description:'Bad',lines:[{accountId:'bank',amount:10},{accountId:'capital',amount:-9}]}));
  B.addJournal(p,{date:'2026-10-01',description:'Depreciation',lines:[{accountId:'depreciation',amount:50000},{accountId:'vehicle',amount:-50000}]});assert.equal(B.profit(p,p.years[0]).costs,0);assert.equal(B.profit(p,p.years[0],'accrual').costs,50000);assert.equal(B.balanceSheet(p,p.years[0]).difference,0);
});
test('CSV exports quote multiline details and neutralise spreadsheet formulas',()=>{const text=B.csv([['Details','Amount'],['=HYPERLINK("evil")',-12.5],['Line one\nLine two',1]]);assert.ok(text.includes('"\'=HYPERLINK(""evil"")"'));assert.ok(text.includes('"-12.5"'));assert.ok(text.includes('Line one\nLine two'));});
test('complete backups round-trip and reject missing accounts and malformed records',()=>{
  const p=B.demoProfile();const data=JSON.parse(JSON.stringify({version:1,profiles:[p]}));assert.deepEqual(B.validateState(data),data);
  const corrupt=structuredClone(data);corrupt.profiles[0].transactions[0].accountId='unknown';assert.throws(()=>B.validateState(corrupt));const malformed=structuredClone(data);malformed.profiles[0].accounts=[];assert.throws(()=>B.validateState(malformed));
});
test('driver profiles have isolated records and charts of accounts',()=>{const p=fresh(),other=fresh();payment(p);p.accounts[0].name='Changed';assert.equal(other.transactions.length,0);assert.equal(other.accounts[0].name,'Business bank');});
