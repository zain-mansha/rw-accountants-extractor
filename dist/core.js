/* Ledger engine: all monetary values are integer pence. No browser dependencies. */
(function (root) {
  'use strict';
  const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
  const uid = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const sum = values => values.reduce((a, b) => a + b, 0);
  const money = value => {
    if (typeof value === 'number') { assert(Number.isFinite(value), 'Enter a valid amount.'); return Math.round(value * 100); }
    let s = String(value ?? '').trim();
    if (!s || s === '-') return 0;
    const negative = /^\(.*\)$/.test(s) || /\sDR$/i.test(s);
    s = s.replace(/[£$€ ,]/g, '').replace(/^\(|\)$/g, '').replace(/(?:CR|DR)$/i, '').trim();
    assert(/^[+-]?\d+(\.\d{1,2})?$/.test(s), `Invalid amount: ${value}`);
    const n = Number(s); assert(Number.isSafeInteger(Math.round(n * 100)), 'Amount is too large.');
    return Math.round(n * 100) * (negative ? -1 : 1);
  };
  function date(value, format = 'DMY', excel1904 = false) {
    if (value instanceof Date && !isNaN(value)) return `${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,'0')}-${String(value.getUTCDate()).padStart(2,'0')}`;
    if (typeof value === 'number') {
      assert(value > 0 && value < 150000, 'Invalid Excel date.');
      return date(new Date(Date.UTC(excel1904 ? 1904 : 1899, excel1904 ? 0 : 11, excel1904 ? 1 : 30) + Math.floor(value) * 86400000));
    }
    let s = String(value ?? '').trim();
    if(/^\d{6}$|^\d{8}$/.test(s))s=`${s.slice(0,2)}/${s.slice(2,4)}/${s.slice(4)}`;
    let y, m, d, match;
    if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/))) [, y, m, d] = match;
    else if ((match = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
      y = match[3]; [d, m] = format === 'MDY' ? [match[2], match[1]] : [match[1], match[2]];
      if (y.length === 2) y = Number(y) < 70 ? `20${y}` : `19${y}`;
    } else if ((match = s.match(/^(\d{1,2})[ \-]([A-Za-z]{3,9})[ ,\-]+(\d{4})$/))) {
      d = match[1]; m = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].slice(0,3).toLowerCase()) + 1; y = match[3];
    } else throw new Error(`Invalid date: ${s || '(blank)'}`);
    const test = new Date(Date.UTC(Number(y), Number(m)-1, Number(d)));
    assert(test.getUTCFullYear() === Number(y) && test.getUTCMonth()+1 === Number(m) && test.getUTCDate() === Number(d) && Number(y) >= 1900, `Invalid date: ${s}`);
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function chart() {
    const accounts=[
      ['bank','Business bank','asset',null,'bank'], ['cash','Cash in hand','asset',null,'cash'],
      ['receivables','Customer debtors','asset'], ['vehicle','Vehicle & equipment','asset'], ['transfer','Transfer clearing','asset'],
      ['payables','Supplier creditors','liability'], ['loan','Vehicle finance & loans','liability'],
      ['capital','Owner capital','equity'], ['drawings','Owner drawings / private use','equity'],
      ['suspense','Uncategorised','equity'],
      ['income','Income','income'], ['fares','Taxi fares','income','income'], ['platform','App / platform fares','income','income'], ['tips','Tips','income','income'],
      ['expenses','Expenses','expense'], ['fuel','Fuel','expense','expenses'], ['repairs','Repair & maintenance','expense','expenses'],
      ['cleaning','Cleaning','expense','expenses'], ['insurance','Vehicle insurance','expense','expenses'], ['licence','Licences & permits','expense','expenses'],
      ['commission','Platform commissions','expense','expenses'], ['phone','Phone & data','expense','expenses'], ['fees','Bank & card fees','expense','expenses'],
      ['accountancy','Accountancy fees','expense','expenses'], ['depreciation','Depreciation','expense','expenses']
    ].map(([id,name,type,parent=null,kind=null])=>({id,name,type,parent,kind}));
    ensureCategories({accounts});return accounts;
  }
  const VAT_CODES={
    'standard-output':{label:'Standard rate sales (20%)',rate:20,direction:'output'},
    'reduced-output':{label:'Reduced rate sales (5%)',rate:5,direction:'output'},
    'zero-output':{label:'Zero-rated sales (0%)',rate:0,direction:'output'},
    'standard-input':{label:'Standard rate purchases (20%)',rate:20,direction:'input'},
    'reduced-input':{label:'Reduced rate purchases (5%)',rate:5,direction:'input'},
    'zero-input':{label:'Zero-rated purchases (0%)',rate:0,direction:'input'},
    'exempt':{label:'Exempt',rate:0,direction:'none'},
    'out-of-scope':{label:'Outside the scope of VAT',rate:0,direction:'none'},
    'blocked-input':{label:'Input VAT blocked',rate:0,direction:'none'}
  };
  const DEFAULT_VAT={registered:false,number:'',scheme:'standard',basis:'cash',period:'quarterly',startDate:'',flatRatePercent:null};
  function ensureVat(p){
    if(!p.vat||typeof p.vat!=='object'||Array.isArray(p.vat))p.vat={};
    p.vat={...DEFAULT_VAT,...p.vat};
    if(!Array.isArray(p.vatReturns))p.vatReturns=[];
    return p.vat;
  }
  function newProfile(name, start='2026-04-06', end='2027-04-05', extra={}) {
    assert(name.trim(), 'Enter a driver or business name.'); date(start); date(end); assert(start <= end, 'Year end must follow its start.');
    const p={id:uid(),name:name.trim(),vehicle:'',email:'',basis:'cash',demo:false,vat:{...DEFAULT_VAT},vatReturns:[],...extra,accounts:chart(),years:[{id:uid(),start,end,locked:false}],transactions:[],invoices:[],contacts:[],journals:[],audit:[],reconciliations:[],rules:[],mileage:[]};ensureVat(p);ensureReportSections(p);return p;
  }
  const account = (p, id) => p.accounts.find(a=>a.id===id);
  function ensureCategories(p) {
    let changed=false;
    const add=a=>{if(!account(p,a.id)){p.accounts.push({parent:null,kind:null,...a});changed=true;}};
    add({id:'capital-group',name:'Capital account',type:'equity'});
    add({id:'cost-sales',name:'Cost of sales',type:'expense'});
    for(const [id,name] of [['capital','Capital introduced'],['drawings','Drawings']]){
      const a=account(p,id);if(a&&a.parent!=='capital-group'){a.parent='capital-group';changed=true;}
      if(a&&['Owner capital','Owner drawings / private use'].includes(a.name)){a.name=name;changed=true;}
    }
    const suppliers=account(p,'payables');if(suppliers?.name==='Supplier creditors'){suppliers.name='Suppliers';changed=true;}
    add({id:'supplier-fuel',name:'Fuel',type:'liability',parent:'payables',expenseCategoryId:'fuel'});
    add({id:'supplier-car-wash',name:'Car wash',type:'liability',parent:'payables',expenseCategoryId:'cleaning'});
    for(const a of p.accounts.filter(a=>a.id!=='payables'&&isSupplierAccount(p,a.id)&&!a.expenseCategoryId)){
      let expense=p.accounts.find(e=>e.type==='expense'&&e.name.toLowerCase()===a.name.toLowerCase());
      if(!expense){expense={id:uid(),name:a.name,type:'expense',parent:'expenses',kind:null};p.accounts.push(expense);}
      a.expenseCategoryId=expense.id;changed=true;
    }
    return changed;
  }
  function isSupplierAccount(p,id) {
    const seen=new Set();let a=account(p,id);
    while(a&&!seen.has(a.id)){if(a.id==='payables')return true;seen.add(a.id);a=account(p,a.parent);}
    return false;
  }
  function invoiceControl(p,inv) {return inv.kind==='purchase'?(inv.supplierAccountId||'payables'):'receivables';}
  function transactionAllocations(p,id){return (p.invoiceAllocations||[]).filter(a=>a.transactionId===id);}
  function uncoveredPayment(p,t,asOf='9999-12-31'){if(t.invoiceId)return 0;return Math.max(0,Math.abs(t.amount)-sum(transactionAllocations(p,t.id).filter(a=>a.date<=asOf).map(a=>a.amount)));}
  function requiresReceipt(p,t,asOf='9999-12-31') {return isSupplierAccount(p,t.categoryId)&&uncoveredPayment(p,t,asOf)>0;}
  function pendingSupplierPayments(p,asOf='9999-12-31'){return p.transactions.filter(t=>t.amount<0&&t.date<=asOf&&requiresReceipt(p,t,asOf)).map(t=>({...t,remaining:uncoveredPayment(p,t,asOf)}));}
  function supplierProofGroups(p,asOf='9999-12-31'){
    const groups=new Map();for(const t of pendingSupplierPayments(p,asOf)){let g=groups.get(t.categoryId);if(!g){g={categoryId:t.categoryId,name:account(p,t.categoryId)?.name,transactions:[],remaining:0};groups.set(t.categoryId,g);}g.transactions.push(t);g.remaining+=t.remaining;}
    return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  function validateInvoiceAllocations(p,records=p.invoiceAllocations||[]){
    const transactionTotals=new Map(),invoiceTotals=new Map(),ids=new Set();
    for(const a of records){
      assert(a&&typeof a.id==='string'&&!ids.has(a.id),'Duplicate or invalid invoice allocation.');ids.add(a.id);
      const t=p.transactions.find(t=>t.id===a.transactionId),inv=p.invoices.find(i=>i.id===a.invoiceId);
      assert(t&&inv&&inv.kind==='purchase','Invoice allocation refers to a missing payment or purchase invoice.');
      assert(!t.invoiceId&&t.amount<0&&isSupplierAccount(p,t.categoryId)&&t.categoryId===invoiceControl(p,inv),'Allocate supplier payments to an invoice in the same supplier subaccount.');
      assert(Number.isSafeInteger(a.amount)&&a.amount>0,'Allocation amounts must be positive pence.');
      assert(a.date===(t.date>inv.date?t.date:inv.date),'Invalid invoice allocation date.');
      transactionTotals.set(t.id,(transactionTotals.get(t.id)||0)+a.amount);invoiceTotals.set(inv.id,(invoiceTotals.get(inv.id)||0)+a.amount);
    }
    for(const [id,total] of transactionTotals)assert(total<=Math.abs(p.transactions.find(t=>t.id===id).amount),'Allocations exceed a payment amount.');
    for(const [id,total] of invoiceTotals){const inv=p.invoices.find(i=>i.id===id),legacy=sum(p.transactions.filter(t=>t.invoiceId===id).map(t=>Math.abs(t.amount)));assert(total+legacy<=inv.amount,'Allocations exceed the invoice total.');}
    return records;
  }
  function allocateSupplierPayments(p,invoiceId,items){
    const inv=p.invoices.find(i=>i.id===invoiceId);assert(inv?.kind==='purchase','Select a purchase invoice.');assert(Array.isArray(items)&&items.length,'Choose at least one payment to match.');
    const records=[...(p.invoiceAllocations||[])],seen=new Set();
    for(const item of items){const t=p.transactions.find(t=>t.id===item.transactionId);assert(t&&!seen.has(t.id),'Select each payment only once.');seen.add(t.id);editable(p,t.date);const effective=t.date>inv.date?t.date:inv.date;editable(p,effective);records.push({id:uid(),transactionId:t.id,invoiceId:inv.id,amount:item.amount,date:effective,createdAt:new Date().toISOString()});}
    validateInvoiceAllocations(p,records);p.invoiceAllocations=records;audit(p,'Supplier payments matched',`${items.length} payments · ${inv.reference} · ${sum(items.map(a=>a.amount))} pence`);return records.slice(-items.length);
  }
  function removeInvoiceAllocation(p,id){const a=(p.invoiceAllocations||[]).find(a=>a.id===id);assert(a,'Allocation not found.');const t=p.transactions.find(t=>t.id===a.transactionId);editable(p,t.date);editable(p,a.date);p.invoiceAllocations=p.invoiceAllocations.filter(a=>a.id!==id);audit(p,'Invoice allocation removed',`${a.amount} pence`);}
  function coveringSupplierInvoice(p,input){
    const copy=structuredClone(p);let contact=copy.contacts.find(c=>c.type==='supplier'&&c.name.toLowerCase()===String(input.supplier||'').trim().toLowerCase());
    assert(String(input.supplier||'').trim(),'Enter the supplier or statement issuer.');if(!contact){contact={id:uid(),name:input.supplier.trim(),type:'supplier',email:''};copy.contacts.push(contact);}
    let reference=String(input.reference||'').trim();if(!reference){let n=copy.supplierInvoiceSequence||0;do{reference=`SUP-${String(++n).padStart(6,'0')}`;}while(copy.invoices.some(i=>i.reference===reference));copy.supplierInvoiceSequence=n;}
    const invoiceCategory=account(copy,input.categoryId)?.expenseCategoryId?input.categoryId:(input.expenseCategoryId||'fuel');
    const inv=addInvoice(copy,{kind:'purchase',date:input.date,due:input.date,reference,description:input.description?.trim()||`Supplier statement · ${account(copy,input.categoryId)?.name}`,contactId:contact.id,categoryId:invoiceCategory,supplierAccountId:input.categoryId,amount:input.amount,businessPercent:input.businessPercent??100});
    allocateSupplierPayments(copy,inv.id,input.allocations);Object.assign(p,copy);memoryCache.delete(p);return inv;
  }
  function addSubcategory(p,parentId,name,options={}) {
    const parent=account(p,parentId);assert(parent&&!parent.kind&&!parent.parent,'Choose a top-level category.');
    name=String(name||'').trim();assert(name,'Enter a subcategory name.');assert(name.length<=100,'Subcategory names must be 100 characters or fewer.');
    assert(!p.accounts.some(a=>a.parent===parentId&&a.name.toLowerCase()===name.toLowerCase()),'That subcategory already exists.');
    const supplier=isSupplierAccount(p,parentId);let expenseCategoryId=options.expenseCategoryId;
    if(supplier){
      if(expenseCategoryId)assert(account(p,expenseCategoryId)?.type==='expense','Choose a linked expense category.');
      else expenseCategoryId=p.accounts.find(a=>a.type==='expense'&&a.name.toLowerCase()===name.toLowerCase())?.id;
      if(!expenseCategoryId){const expense={id:uid(),name,type:'expense',parent:'expenses',kind:null};p.accounts.push(expense);expenseCategoryId=expense.id;}
    }
    const child={id:uid(),name,type:parent.type,parent:parentId,kind:null,...(supplier?{expenseCategoryId}:{} )};
    p.accounts.push(child);audit(p,'Subcategory added',`${parent.name}: ${name}`);return child;
  }
  const yearAt = (p,d) => p.years.find(y=>d>=y.start && d<=y.end);
  function editable(p,d) { date(d); const y=yearAt(p,d); assert(y, 'Date is outside your financial years. Add that year first.'); assert(!y.locked, 'This financial year is locked. Unlock it in Settings to make changes.'); }
  function audit(p,action,detail) { p.audit.push({id:uid(),at:new Date().toISOString(),action,detail}); }
  function invalidateReconciliations(p,d,ids) { p.reconciliations.filter(r=>r.date>=d && ids.includes(r.accountId)).forEach(r=>r.valid=false); }
  const memoryCache=new WeakMap();
  function merchantKey(description) {
    let words=String(description||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    words=words.replace(/^(?:(?:debit card|card payment|payment to|contactless|visa|mastercard|pos|purchase)\s+)+/,'');
    const tokens=words.split(/\s+/).filter(w=>w && !/\d/.test(w));
    if(tokens[0]==='shell' && !tokens.includes('energy'))return 'shell';
    if(tokens[0]==='bp')return 'bp';
    return tokens.join(' ');
  }
  const memoryDirection=amount=>amount<0?'payment':'receipt';
  const memoryId=(accountId,direction,key)=>JSON.stringify([accountId,direction,key]);
  function rememberedCategory(p,t) {
    const inv=p.invoices.find(i=>i.id===t.invoiceId),categoryId=inv?.supplierAccountId||inv?.categoryId||t.categoryId;
    const a=account(p,categoryId);
    if(!a || a.kind || ['suspense','transfer','payables','receivables'].includes(categoryId))return null;
    return {categoryId,businessPercent:inv?.businessPercent??t.businessPercent,vatCode:inv?.vatCode||t.vatCode||'out-of-scope',contactId:inv?.contactId||t.contactId||''};
  }
  function rememberEntry(p,t) {
    if(t.memoryApplied || t.transferId)return;
    const choice=rememberedCategory(p,t),key=merchantKey(t.description);
    if(!choice || !key || !account(p,t.accountId)?.kind)return;
    const direction=memoryDirection(t.amount),id=memoryId(t.accountId,direction,key);
    p.entryMemory ||= [];
    const record={id,accountId:t.accountId,direction,key,description:t.description,...choice,at:new Date().toISOString()};
    const old=p.entryMemory.findIndex(m=>m.id===id);
    if(old<0)p.entryMemory.push(record);else p.entryMemory[old]=record;
    memoryCache.delete(p);
  }
  function entryMemoryIndex(p) {
    const stamp=[p.transactions.length,p.invoices.length,p.audit.length,p.entryMemory?.length||0].join('|');
    const cached=memoryCache.get(p);if(cached?.stamp===stamp)return cached.index;
    const index=new Map();
    for(const t of p.transactions) {
      if(t.transferId || t.memoryApplied)continue;
      const choice=rememberedCategory(p,t),key=merchantKey(t.description);if(!choice || !key)continue;
      const direction=memoryDirection(t.amount),id=memoryId(t.accountId,direction,key),existing=index.get(id);
      const variant=JSON.stringify([choice.categoryId,choice.businessPercent,choice.vatCode]);
      if(existing){existing.variants.add(variant);existing.count++;existing.description=t.description;if(choice.contactId)existing.contactId=choice.contactId;}
      else index.set(id,{id,key,accountId:t.accountId,direction,description:t.description,...choice,count:1,variants:new Set([variant]),explicit:false});
    }
    for(const record of p.entryMemory||[]) {
      if(!account(p,record.accountId)?.kind || !account(p,record.categoryId) || ['suspense','transfer','payables','receivables'].includes(record.categoryId))continue;
      const old=index.get(record.id);index.set(record.id,{...record,count:old?.count||1,variants:new Set(),explicit:true});
    }
    memoryCache.set(p,{stamp,index});return index;
  }
  function findEntryMemory(p,accountId,description,direction='payment',index=entryMemoryIndex(p)) {
    const found=index.get(memoryId(accountId,direction,merchantKey(description)));
    return found && (found.explicit || found.variants.size===1)?found:null;
  }
  function entrySuggestions(p,accountId,direction,prefix='') {
    const text=String(prefix).trim().toLowerCase();
    return [...entryMemoryIndex(p).values()].filter(m=>m.accountId===accountId&&m.direction===direction&&(!text||m.description.toLowerCase().startsWith(text)||m.key.startsWith(text))).sort((a,b)=>b.count-a.count||a.description.localeCompare(b.description)).slice(0,8);
  }
  function categorySuggestions(p,accountId,direction,prefix='',type=null) {
    const usage=new Map();for(const m of entryMemoryIndex(p).values())if(m.accountId===accountId&&m.direction===direction&&(m.explicit||m.variants.size===1))usage.set(m.categoryId,(usage.get(m.categoryId)||0)+m.count);
    const text=String(prefix).trim().toLowerCase();
    return p.accounts.filter(a=>!a.kind&&a.id!=='transfer'&&(!type||a.type===type)&&(!text||a.name.toLowerCase().startsWith(text)||(account(p,a.parent)?.name||'').toLowerCase().startsWith(text))).sort((a,b)=>(usage.get(b.id)||0)-(usage.get(a.id)||0)||a.name.localeCompare(b.name));
  }
  function canCategorise(p,t) { return !t.invoiceId&&!transactionAllocations(p,t.id).length&&!t.transferId&&!t.reconciled&&!!yearAt(p,t.date)&&!yearAt(p,t.date).locked; }
  function autoCategorisationPlan(p,rows=p.transactions) {
    const index=entryMemoryIndex(p),matches=[],unmatched=[];
    for(const t of rows) {
      if(t.categoryId!=='suspense'||!canCategorise(p,t))continue;
      const memory=findEntryMemory(p,t.accountId,t.description,memoryDirection(t.amount),index);
      if(memory)matches.push({id:t.id,description:t.description,date:t.date,accountId:t.accountId,categoryId:memory.categoryId,businessPercent:memory.businessPercent,vatCode:memory.vatCode||'out-of-scope',contactId:memory.contactId||''});
      else unmatched.push(t.id);
    }
    return {matches,unmatched};
  }
  function applyAutoCategorisation(p,plan) {
    const ids=new Set(plan.matches.map(m=>m.id));
    const current=autoCategorisationPlan(p,p.transactions.filter(t=>ids.has(t.id)));
    assert(current.matches.length===plan.matches.length,'Matching records changed. Review the suggestions again.');
    current.matches.forEach(m=>updateTransaction(p,m.id,{categoryId:m.categoryId,businessPercent:m.businessPercent,vatCode:m.vatCode||'out-of-scope',contactId:m.contactId,memoryApplied:true}));
    audit(p,'Remembered categories applied',`${current.matches.length} transactions`);return current.matches.length;
  }
  function receiptMatches(p,input) {
    const key=merchantKey(input.supplier);
    const d=date(input.date),supplierCategory=isSupplierAccount(p,input.categoryId)?input.categoryId:null;
    return p.transactions.filter(t=>t.accountId===input.accountId&&t.date===d&&t.amount===-input.amount&&canCategorise(p,t)&&(t.categoryId==='suspense'||account(p,t.categoryId)?.type==='expense'||isSupplierAccount(p,t.categoryId))&&merchantKey(t.description)===key&&(!supplierCategory||!isSupplierAccount(p,t.categoryId)||t.categoryId===supplierCategory||t.categoryId==='payables'));
  }
  function addQuickReceipt(p,input) {
    input={...input,date:date(input.date)};
    editable(p,input.date);assert(input.supplier?.trim(),'Enter a supplier name.');
    assert(account(p,input.accountId)?.kind,'Choose a bank or cash account.');
    assert(['match','new','unpaid'].includes(input.paymentMode),'Choose how to handle the payment.');
    const selected=account(p,input.categoryId),supplierAccountId=isSupplierAccount(p,input.categoryId)?input.categoryId:null;
    const expenseCategoryId=supplierAccountId?selected.expenseCategoryId:input.categoryId;
    assert(account(p,expenseCategoryId)?.type==='expense','Choose an expense subcategory or a supplier subcategory linked to an expense.');
    assert(Number.isSafeInteger(input.amount)&&input.amount>0,'Receipt total must be greater than zero.');
    assert(Number.isFinite(input.businessPercent)&&input.businessPercent>=0&&input.businessPercent<=100,'Business use must be between 0 and 100%.');
    const candidates=input.paymentMode==='match'?receiptMatches(p,input):[];
    if(input.transactionId)assert(candidates.some(t=>t.id===input.transactionId),'That transaction is no longer available for matching.');
    // Validate a copy first: a failed receipt cannot leave an orphan supplier, invoice, or payment.
    const copy=structuredClone(p),name=input.supplier.trim();
    let contact=copy.contacts.find(c=>c.type==='supplier'&&c.name.toLowerCase()===name.toLowerCase());
    if(!contact){contact={id:uid(),name,type:'supplier',email:''};copy.contacts.push(contact);audit(copy,'Contact added',name);}
    let counter=copy.receiptSequence||0,reference=input.reference?.trim();
    if(!reference){do{reference=`R-${String(++counter).padStart(6,'0')}`;}while(copy.invoices.some(i=>i.reference.toLowerCase()===reference.toLowerCase()));copy.receiptSequence=counter;}
    const matched=input.transactionId?candidates.find(t=>t.id===input.transactionId):candidates.length===1?candidates[0]:null;
    const control=supplierAccountId||(matched&&isSupplierAccount(copy,matched.categoryId)&&matched.categoryId!=='payables'?matched.categoryId:null);
    const inv=addInvoice(copy,{kind:'purchase',date:input.date,due:input.date,reference,description:input.description?.trim()||`${name} · ${selected.name}`,contactId:contact.id,categoryId:expenseCategoryId,supplierAccountId:control||undefined,amount:input.amount,businessPercent:input.businessPercent,vatCode:input.vatCode||'out-of-scope',vat:Number.isSafeInteger(input.vat)?input.vat:0,entryAccountId:input.accountId});
    let payment;
    if(matched)payment=updateTransaction(copy,matched.id,{categoryId:invoiceControl(copy,inv),contactId:contact.id,invoiceId:inv.id});
    else if(input.paymentMode==='new')payment=addTransaction(copy,{date:input.date,description:inv.description,accountId:input.accountId,categoryId:invoiceControl(copy,inv),contactId:contact.id,invoiceId:inv.id,amount:-input.amount,source:'manual receipt'});
    rememberEntry(copy,{accountId:input.accountId,description:name,amount:-input.amount,categoryId:control||input.categoryId,businessPercent:input.businessPercent,contactId:contact.id});
    Object.assign(p,copy);memoryCache.delete(p);
    return {invoice:inv,payment,matchCount:candidates.length,status:payment?'paid':input.paymentMode==='unpaid'?'unpaid':candidates.length>1?'ambiguous':'unmatched'};
  }
  function invoiceBalance(p, inv, asOf='9999-12-31') {
    return inv.amount - sum(p.transactions.filter(t=>t.invoiceId===inv.id && t.date<=asOf).map(t=>Math.abs(t.amount))) - sum((p.invoiceAllocations||[]).filter(a=>a.invoiceId===inv.id&&a.date<=asOf).map(a=>a.amount));
  }
  function validateTransaction(p,t,ignoreId=null,existing=[]) {
    editable(p,t.date); assert(t.description?.trim(), 'Enter transaction details.');
    assert(Number.isSafeInteger(t.amount) && t.amount!==0, 'Amount must be a non-zero number of pence.');
    assert(account(p,t.accountId)?.kind, 'Select a bank or cash account.');
    assert(account(p,t.categoryId), 'Select a category.'); assert(t.categoryId!==t.accountId, 'An account cannot transfer to itself.');
    assert(Number.isFinite(t.businessPercent) && t.businessPercent>=0 && t.businessPercent<=100, 'Business use must be between 0 and 100%.');
    assert(VAT_CODES[t.vatCode||'out-of-scope'],'Choose a valid VAT code.');
    if (t.contactId) assert(p.contacts.some(c=>c.id===t.contactId), 'Contact was not found.');
    if (t.invoiceId) {
      const inv=p.invoices.find(i=>i.id===t.invoiceId); assert(inv, 'Invoice was not found.');
      assert(t.date >= inv.date, 'A linked payment cannot predate its invoice. Record an advance separately.');
      assert(inv.kind==='purchase' ? t.amount<0 : t.amount>0, 'Payment direction does not match this invoice.');
      assert(t.contactId===inv.contactId, 'Payment contact must match the invoice contact.');
      assert(t.categoryId===invoiceControl(p,inv), 'Invoice payments must use the appropriate supplier/debtor account.');
      const paid=sum([...p.transactions.filter(x=>x.id!==ignoreId),...existing].filter(x=>x.invoiceId===inv.id).map(x=>Math.abs(x.amount)));
      const allocated=sum((p.invoiceAllocations||[]).filter(a=>a.invoiceId===inv.id).map(a=>a.amount));
      assert(paid+allocated+Math.abs(t.amount)<=inv.amount, 'Payment exceeds the invoice outstanding balance.');
    }
  }
  function addTransaction(p,input) {
    const t={id:uid(),businessPercent:100,contactId:'',invoiceId:'',reconciled:false,source:'manual',vatCode:'out-of-scope',...input};
    t.date=date(t.date);
    validateTransaction(p,t); p.transactions.push(t); invalidateReconciliations(p,t.date,[t.accountId,t.categoryId]); rememberEntry(p,t); audit(p,'Transaction added',t.description); return t;
  }
  function updateTransaction(p,id,changes) {
    const old=p.transactions.find(t=>t.id===id); assert(old,'Transaction not found.'); editable(p,old.date);
    assert(!transactionAllocations(p,id).length,'Remove this payment’s invoice allocations before editing it.');
    assert(!old.reconciled,'Unreconcile this transaction before editing it.');
    assert(!old.transferId,'Transfers must be removed and entered again to preserve both sides.');
    const t={...old,memoryApplied:false,...changes,id};t.date=date(t.date); validateTransaction(p,t,id); invalidateReconciliations(p,old.date,[old.accountId,old.categoryId]); Object.assign(old,t); invalidateReconciliations(p,t.date,[t.accountId,t.categoryId]); rememberEntry(p,t); audit(p,'Transaction updated',t.description); return old;
  }
  function removeTransaction(p,id) {
    const t=p.transactions.find(t=>t.id===id); assert(t,'Transaction not found.'); editable(p,t.date); assert(!t.reconciled,'Unreconcile this transaction before removing it.');
    assert(!transactionAllocations(p,id).length,'Remove invoice allocations before removing the payment.');
    const group=t.transferId?p.transactions.filter(x=>x.transferId===t.transferId):[t];
    group.forEach(x=>{editable(p,x.date);assert(!x.reconciled,'Unreconcile both sides of the transfer before removing it.');});
    group.forEach(x=>invalidateReconciliations(p,x.date,[x.accountId,x.categoryId])); p.transactions=p.transactions.filter(x=>!group.some(g=>g.id===x.id)); audit(p,'Transaction removed',t.description);
  }
  function addInvoice(p,input) {
    const inv={id:uid(),businessPercent:100,vatCode:'out-of-scope',...input};
    if(input.vatCode===undefined && Number.isSafeInteger(input.vat) && input.vat>0)inv.vatCode=input.kind==='sale'?'standard-output':'standard-input';
    inv.date=date(inv.date);inv.due=date(inv.due);editable(p,inv.date);assert(inv.due>=inv.date,'Due date must be on or after invoice date.');
    if(inv.kind==='purchase'&&isSupplierAccount(p,inv.categoryId)){inv.supplierAccountId=inv.categoryId;inv.categoryId=account(p,inv.categoryId).expenseCategoryId;}
    if(inv.supplierAccountId)assert(inv.kind==='purchase'&&isSupplierAccount(p,inv.supplierAccountId),'Choose a supplier account for a purchase invoice.');
    assert(['purchase','sale'].includes(inv.kind),'Choose purchase or sales invoice.');
    assert(Number.isSafeInteger(inv.amount) && inv.amount>0,'Invoice total must be greater than zero.');
    assert(VAT_CODES[inv.vatCode||'out-of-scope'],'Choose a valid VAT code.');
    assert(inv.description?.trim() && inv.reference?.trim(),'Enter a reference and description.');
    assert(p.contacts.some(c=>c.id===inv.contactId && c.type===(inv.kind==='purchase'?'supplier':'customer')),'Select a matching supplier or customer.');
    assert(account(p,inv.categoryId)?.type===(inv.kind==='purchase'?'expense':'income'),'Choose an expense for a bill or income for a sales invoice.');
    assert(Number.isFinite(inv.businessPercent) && inv.businessPercent>=0 && inv.businessPercent<=100,'Business use must be between 0 and 100%.');
    assert(!p.invoices.some(i=>i.kind===inv.kind && i.contactId===inv.contactId && i.reference.toLowerCase()===inv.reference.toLowerCase()),'That contact already has an invoice with this reference.');
    p.invoices.push(inv); audit(p,'Invoice added',inv.reference); return inv;
  }
  function addJournal(p,input) {
    editable(p,input.date); assert(input.description?.trim(),'Enter journal details.');
    assert(input.lines.length>=2,'A journal needs at least two lines.');
    input.lines.forEach(l=>{assert(account(p,l.accountId),'Unknown journal account.'); assert(Number.isSafeInteger(l.amount),'Journal amounts must be integer pence.');});
    assert(sum(input.lines.map(l=>l.amount))===0,'Journal debits and credits must balance.');
    const j={...input,id:uid()}; p.journals.push(j); invalidateReconciliations(p,j.date,j.lines.map(l=>l.accountId)); audit(p,'Journal posted',j.description); return j;
  }
  function addYear(p,start,end) {
    date(start); date(end); assert(start<=end,'Year end must follow the start.');
    assert(!p.years.some(y=>start<=y.end && end>=y.start),'Financial years cannot overlap.');
    const y={id:uid(),start,end,locked:false}; p.years.push(y); p.years.sort((a,b)=>a.start.localeCompare(b.start)); audit(p,'Financial year added',`${start} to ${end}`); return y;
  }
  function ensureFinancialPeriod(p,value){
    const d=date(value);let found=yearAt(p,d);if(found)return found;
    const sorted=()=>p.years.slice().sort((a,b)=>a.start.localeCompare(b.start)),shift=(s,years)=>{const dt=new Date(s+'T12:00:00Z');dt.setUTCFullYear(dt.getUTCFullYear()+years);return dt.toISOString().slice(0,10);},day=(s,delta)=>new Date(new Date(s+'T12:00:00Z').getTime()+delta*86400000).toISOString().slice(0,10);
    let bounds=sorted();assert(bounds.length,'Create a financial year first.');assert(Math.abs(Number(d.slice(0,4))-Number(bounds[0].start.slice(0,4)))<=20,'Check the date: it is more than 20 years from the first financial year.');
    while(d<bounds[0].start){addYear(p,shift(bounds[0].start,-1),day(bounds[0].start,-1));bounds=sorted();}
    while(d>bounds[bounds.length-1].end){const start=day(bounds[bounds.length-1].end,1);addYear(p,start,day(shift(start,1),-1));bounds=sorted();}
    found=yearAt(p,d);assert(found,'This date falls in a gap between financial years. Configure that period in Settings.');return found;
  }
  function periodOf(y,d){return d<y.start?'previous':d>y.end?'next':'current';}
  function ensureReportSections(p){if(p.reportSections)return false;p.reportSections=[{id:'income',name:'Income',type:'income',rootId:'income'},{id:'cost-sales',name:'Cost of sales',type:'expense',rootId:'cost-sales'},{id:'expenses',name:'Expenses',type:'expense',rootId:'expenses'},{id:'assets',name:'Assets',type:'asset',rootId:'vehicle'},{id:'suppliers',name:'Suppliers',type:'liability',rootId:'payables'},{id:'liabilities',name:'Other liabilities',type:'liability',rootId:'loan'},{id:'capital',name:'Capital account',type:'equity',rootId:'capital-group'}];return true;}
  function reportSectionFor(p,a){const explicit=p.reportSections?.find(s=>s.id===a.reportSectionId&&s.type===a.type);if(explicit)return explicit.id;let root=a;while(root.parent)root=account(p,root.parent);return a.type==='income'?'income':a.type==='expense'?(root.id==='cost-sales'?'cost-sales':'expenses'):a.type==='asset'?'assets':a.type==='liability'?(isSupplierAccount(p,a.id)?'suppliers':'liabilities'):'capital';}
  function addReportSection(p,name,type,accountIds=[]){
    ensureReportSections(p);name=String(name||'').trim();assert(name&&name.length<=100,'Enter a section name up to 100 characters.');assert(TYPES.includes(type),'Choose a section type.');assert(!p.reportSections.some(s=>s.name.toLowerCase()===name.toLowerCase()),'That section already exists.');
    accountIds.forEach(id=>assert(account(p,id)?.type===type,'Section categories must have the same account type.'));
    const id=uid(),rootId=uid(),section={id,name,type,rootId};p.accounts.push({id:rootId,name,type,parent:null,kind:null,reportSectionId:id});p.reportSections.push(section);accountIds.forEach(id=>account(p,id).reportSectionId=section.id);audit(p,'Accounts section added',name);return section;
  }
  function accountsSummary(p,y){
    ensureReportSections(p);const result=profit(p,y),b=balances(p,'0000-01-01',y.end),amounts=new Map([...result.income,...result.expenses].map(a=>[a.id,a.amount]));
    const sections=p.reportSections.map(s=>({...s,rows:p.accounts.filter(a=>a.id!=='suspense'&&a.id!=='transfer'&&reportSectionFor(p,a)===s.id).map(a=>({...a,amount:['income','expense'].includes(a.type)?amounts.get(a.id)||0:b[a.id]*(a.type==='asset'?1:-1)}))}));
    const pending=pendingSupplierPayments(p,y.end);sections.forEach(s=>{if(s.id==='suppliers')s.rows.forEach(a=>a.amount+=sum(pending.filter(t=>t.categoryId===a.id).map(t=>t.remaining)));s.total=sum(s.rows.map(a=>a.amount));});const costSales=sum(sections.filter(s=>s.id==='cost-sales').map(s=>s.total)),uncategorised=p.transactions.filter(t=>t.date>=y.start&&t.date<=y.end&&t.categoryId==='suspense').length;return {sections,revenue:result.revenue,costSales,grossProfit:result.revenue-costSales,expenses:result.costs-costSales,profit:result.profit,pendingAmount:sum(pending.map(t=>t.remaining)),pendingCount:pending.length,uncategorised,ready:pending.length===0&&uncategorised===0};
  }
  function entries(p) {
    const list=[];
    const push=(source,d,description,lines)=>{ assert(sum(lines.map(l=>l.amount))===0,'Unbalanced posting.'); list.push({source,date:d,description,lines}); };
    for (const inv of p.invoices) {
      const control=invoiceControl(p,inv);
      if (inv.kind==='purchase') {
        const business=Math.round(inv.amount*inv.businessPercent/100);
        push(inv.id,inv.date,inv.description,[{accountId:inv.categoryId,amount:business},{accountId:'drawings',amount:inv.amount-business},{accountId:control,amount:-inv.amount}]);
      } else push(inv.id,inv.date,inv.description,[{accountId:control,amount:inv.amount},{accountId:inv.categoryId,amount:-inv.amount}]);
    }
    for (const t of p.transactions) {
      const lines=[{accountId:t.accountId,amount:t.amount}];
      if (!t.invoiceId && account(p,t.categoryId)?.type==='expense') {
        const business=Math.round(-t.amount*t.businessPercent/100);
        lines.push({accountId:t.categoryId,amount:business},{accountId:'drawings',amount:-t.amount-business});
      } else lines.push({accountId:t.categoryId,amount:-t.amount});
      push(t.id,t.date,t.description,lines);
    }
    for (const j of p.journals) push(j.id,j.date,j.description,j.lines);
    return list.sort((a,b)=>a.date.localeCompare(b.date));
  }
  function balances(p,from='0000-01-01',to='9999-12-31') {
    const result=Object.fromEntries(p.accounts.map(a=>[a.id,0]));
    entries(p).filter(e=>e.date>=from && e.date<=to).forEach(e=>e.lines.forEach(l=>result[l.accountId]=(result[l.accountId]||0)+l.amount));
    return result;
  }
  function profit(p,y,basis=p.basis) {
    let b;
    if (basis==='accrual') b=balances(p,y.start,y.end);
    else {
      b=Object.fromEntries(p.accounts.map(a=>[a.id,0]));
      const paidByInvoice={},invoiceMap=new Map(p.invoices.map(i=>[i.id,i])),allocations=new Map();for(const a of p.invoiceAllocations||[]){const list=allocations.get(a.transactionId)||[];list.push(a);allocations.set(a.transactionId,list);}
      for (const t of p.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date))) {
        const inv=invoiceMap.get(t.invoiceId);
        const parts=inv?[{invoice:inv,amount:Math.abs(t.amount)}]:(allocations.get(t.id)||[]).map(a=>({invoice:invoiceMap.get(a.invoiceId),amount:a.amount}));
        if(parts.length){for(const part of parts){const doc=part.invoice,before=paidByInvoice[doc.id]||0;paidByInvoice[doc.id]=before+part.amount;if(t.date<y.start||t.date>y.end)continue;if(doc.kind==='sale')b[doc.categoryId]-=part.amount;else b[doc.categoryId]+=Math.round(paidByInvoice[doc.id]*doc.businessPercent/100)-Math.round(before*doc.businessPercent/100);}continue;}
        const category=inv?.categoryId || t.categoryId;
        const a=account(p,category);
        const before=inv?(paidByInvoice[inv.id]||0):0;
        if(inv)paidByInvoice[inv.id]=before+Math.abs(t.amount);
        if(t.date<y.start || t.date>y.end)continue;
        if (a?.type==='income') b[category]-=t.amount;
        if (a?.type==='expense') {
          if(inv)b[category]+=Math.round(paidByInvoice[inv.id]*inv.businessPercent/100)-Math.round(before*inv.businessPercent/100);
          else b[category]+=Math.round(-t.amount*t.businessPercent/100);
        }
      }
    }
    const income=p.accounts.filter(a=>a.type==='income').map(a=>({...a,amount:-b[a.id]}));
    const expenses=p.accounts.filter(a=>a.type==='expense').map(a=>({...a,amount:b[a.id]}));
    const revenue=sum(income.map(a=>a.amount)), costs=sum(expenses.map(a=>a.amount));
    return {income,expenses,revenue,costs,profit:revenue-costs,basis};
  }
  function balanceSheet(p,y) {
    const b=balances(p,'0000-01-01',y.end);
    const list=type=>p.accounts.filter(a=>a.type===type).map(a=>({...a,amount:b[a.id]*(type==='asset'?1:-1)}));
    const assets=list('asset'),liabilities=list('liability'),equity=list('equity');
    const retained=-sum(p.accounts.filter(a=>['income','expense'].includes(a.type)).map(a=>b[a.id]));
    const proof=pendingSupplierPayments(p,y.end),pendingProof=sum(proof.map(t=>t.remaining));
    if(pendingProof){assets.push({id:'unverified-supplier-payments',name:'Supplier payments awaiting invoices',type:'asset',parent:null,amount:pendingProof,unverified:true});liabilities.forEach(a=>{if(isSupplierAccount(p,a.id))a.amount+=sum(proof.filter(t=>t.categoryId===a.id).map(t=>t.remaining));});}
    const totalAssets=sum(assets.map(a=>a.amount)),totalLiabilities=sum(liabilities.map(a=>a.amount)),totalEquity=sum(equity.map(a=>a.amount))+retained;
    return {assets,liabilities,equity,retained,totalAssets,totalLiabilities,totalEquity,difference:totalAssets-totalLiabilities-totalEquity,pendingProof,pendingCount:proof.length,ready:proof.length===0};
  }
  function importRows(p,rows,map,options) {
    assert(Number.isInteger(map.date) && Number.isInteger(map.description),'Map a date and details column.');
    const signed=Number.isInteger(map.amount);
    assert(signed || Number.isInteger(map.receipt) || Number.isInteger(map.payment),'Map an amount column or receipt/payment columns.');
    const selected=Object.values(map).filter(Number.isInteger); assert(new Set(selected).size===selected.length,'Each column can only have one label.');
    assert(!(signed && (Number.isInteger(map.receipt)||Number.isInteger(map.payment))),'Use either signed amounts or separate receipt/payment columns.');
    const candidates=[],issues=[],duplicates=[],working=options.routePeriods?structuredClone(p):p;
    const key=t=>`${t.accountId}|${t.date}|${t.description.trim().toLowerCase()}|${t.amount}`;
    const seen=new Set(p.transactions.map(key));
    rows.forEach((row,index)=>{
      if (row.every(c=>c==null||String(c).trim()==='')) return;
      try {
        const d=date(row[map.date],options.dateFormat,options.excel1904);
        if(options.routePeriods)ensureFinancialPeriod(working,d);
        let amount;
        if (signed) amount=money(row[map.amount])*(options.reverse?-1:1);
        else {
          const receipt=Number.isInteger(map.receipt)?money(row[map.receipt]):0;
          const payment=Number.isInteger(map.payment)?money(row[map.payment]):0;
          assert(receipt>=0 && payment>=0,'Receipt/payment columns must contain positive amounts.');
          assert(!(receipt && payment),'A row cannot contain both a receipt and payment.'); amount=receipt-payment;
        }
        const description=String(row[map.description]??'').trim();
        const rule=p.rules.find(r=>description.toLowerCase().includes(r.contains.toLowerCase()) && (r.direction==='any' || (r.direction==='receipt'?amount>0:amount<0)));
        const t={id:uid(),date:d,description,amount,accountId:options.accountId,categoryId:rule?.categoryId||'suspense',businessPercent:rule?.businessPercent??100,contactId:'',invoiceId:'',reconciled:false,source:options.filename||'import',row:index+(options.rowOffset||2)};
        validateTransaction(working,t,null,candidates);
        const k=key(t);
        if (seen.has(k)) duplicates.push(t); else {seen.add(k); candidates.push(t);}
      } catch (err) { issues.push({row:index+(options.rowOffset||2),message:err.message}); }
    });
    return {candidates,issues,duplicates,periods:options.routePeriods?working.years.filter(y=>!p.years.some(old=>old.id===y.id)&&candidates.some(t=>t.date>=y.start&&t.date<=y.end)):[]};
  }
  function commitImport(p,preview) {
    assert(preview.candidates.length>0,'No valid new transactions to import.');
    const copy=structuredClone(p);for(const period of preview.periods||[])if(!copy.years.some(y=>y.start===period.start&&y.end===period.end))addYear(copy,period.start,period.end);
    const checked=[]; preview.candidates.forEach(t=>{validateTransaction(copy,t,null,checked); checked.push(t);});p.years=copy.years;
    p.transactions.push(...checked);checked.forEach(t=>invalidateReconciliations(p,t.date,[t.accountId,t.categoryId])); audit(p,'Statement imported',`${checked.length} transactions`); return checked.length;
  }
  function csv(rows) {
    return '\uFEFF'+rows.map(row=>row.map(value=>{
      let s=String(value??''); if (/^[=+@\-\t\r]/.test(s) && typeof value!=='number') s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    }).join(',')).join('\r\n');
  }
  function vatCodes(){return Object.entries(VAT_CODES).map(([code,value])=>({code,...value}));}
  function vatSettings(p){return {...ensureVat(p)};}
  function setVatSettings(p,input={}){
    const current=ensureVat(p),next={...current,...input};
    assert(next.scheme==='standard','Standard VAT is the supported scheme in this draft.');
    assert(['cash','accrual'].includes(next.basis),'Choose a VAT accounting basis.');
    assert(['monthly','quarterly','annual'].includes(next.period),'Choose a VAT return frequency.');
    next.number=String(next.number||'').replace(/\s+/g,'').toUpperCase();
    if(next.registered)assert(/^(GB)?\d{9}$/.test(next.number),'Enter a valid UK VAT registration number.');
    if(next.flatRatePercent!==null&&next.flatRatePercent!==''&&(!Number.isFinite(Number(next.flatRatePercent))||Number(next.flatRatePercent)<0||Number(next.flatRatePercent)>100))assert(false,'Enter a valid flat-rate percentage.');
    if(next.startDate)next.startDate=date(next.startDate);
    p.vat={...next,flatRatePercent:next.flatRatePercent===''||next.flatRatePercent===null?null:Number(next.flatRatePercent)};
    audit(p,'VAT settings updated',next.registered?`Registered · ${next.number}`:'Not VAT registered');
    return p.vat;
  }
  function vatPeriod(input){
    const source=input||{};
    const start=source.start||source.from;
    const end=source.end||source.to;
    assert(start&&end,'Choose a VAT return start and end date.');
    const period={start:date(start),end:date(end)};
    assert(period.start<=period.end,'VAT return end date must follow its start.');
    return period;
  }
  function vatDocumentLine(p,doc,gross,codeOverride){
    const code=codeOverride||doc.vatCode||((doc.kind==='sale')?'standard-output':'standard-input');
    const rule=VAT_CODES[code]||VAT_CODES['out-of-scope'];
    if(rule.direction==='none')return null;
    let vat=Number.isSafeInteger(doc.vat)&&doc.vat>0?Math.min(doc.vat,gross):Math.round(gross*rule.rate/(100+rule.rate));
    if(rule.rate===0)vat=0;
    return {code,rule,gross,vat,net:gross-vat,direction:rule.direction,categoryId:doc.categoryId,description:doc.description||doc.reference||''};
  }
  function vatReturn(p,range){
    const settings=ensureVat(p),period=vatPeriod(range),lines=[];
    if(settings.basis==='accrual'){
      p.invoices.filter(inv=>inv.date>=period.start&&inv.date<=period.end).forEach(inv=>{
        const line=vatDocumentLine(p,inv,inv.amount);if(line)lines.push({...line,date:inv.date,source:'invoice',sourceId:inv.id});
      });
      p.transactions.filter(t=>!t.invoiceId&&t.date>=period.start&&t.date<=period.end).forEach(t=>{
        const line=vatDocumentLine(p,{...t,kind:t.amount>0?'sale':'purchase',vat:undefined},Math.abs(t.amount));if(line)lines.push({...line,date:t.date,source:'transaction',sourceId:t.id});
      });
    }else{
      p.transactions.filter(t=>t.date>=period.start&&t.date<=period.end).forEach(t=>{
        const inv=t.invoiceId?p.invoices.find(i=>i.id===t.invoiceId):null;
        const gross=Math.abs(t.amount);
        const doc=inv?{...inv,kind:inv.kind,vat:inv.vat,vatCode:inv.vatCode}:({...t,kind:t.amount>0?'sale':'purchase',vat:undefined});
        const line=vatDocumentLine(p,doc,gross,inv?.vatCode||t.vatCode);
        if(line)lines.push({...line,date:t.date,source:'transaction',sourceId:t.id});
      });
    }
    const output=lines.filter(l=>l.direction==='output'),input=lines.filter(l=>l.direction==='input');
    const box1=sum(output.map(l=>l.vat)),box2=0,box3=box1+box2,box4=sum(input.map(l=>l.vat)),box5=box3-box4;
    const box6=sum(output.map(l=>l.net)),box7=sum(input.map(l=>l.net)),box8=0,box9=0;
    const byCode={};lines.forEach(l=>{const item=byCode[l.code]||{code:l.code,label:VAT_CODES[l.code]?.label||l.code,count:0,gross:0,net:0,vat:0};item.count++;item.gross+=l.gross;item.net+=l.net;item.vat+=l.vat;byCode[l.code]=item;});
    return {id:uid(),period,registered:!!settings.registered,vatNumber:settings.number||'',scheme:settings.scheme,basis:settings.basis,lines,breakdown:Object.values(byCode),box1,box2,box3,box4,box5,box6,box7,box8,box9,totalDue:box5,createdAt:new Date().toISOString()};
  }
  function saveVatReturn(p,result){
    ensureVat(p);assert(result&&result.period&&Number.isSafeInteger(result.box5),'Invalid VAT return.');
    const existing=p.vatReturns.find(r=>r.period.start===result.period.start&&r.period.end===result.period.end&&r.status==='draft');
    const submitted=p.vatReturns.find(r=>r.period.start===result.period.start&&r.period.end===result.period.end&&r.status==='submitted');
    assert(!submitted,'This VAT period has already been submitted and is locked.');
    const snapshot=structuredClone({...result,id:existing?.id||uid(),version:(existing?.version||0)+1,status:'draft',createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),submittedAt:null});
    if(existing)p.vatReturns[p.vatReturns.indexOf(existing)]=snapshot;else p.vatReturns.push(snapshot);
    audit(p,existing?'VAT return draft updated':'VAT return saved',`${result.period.start} to ${result.period.end}`);return snapshot;
  }
  function voidVatReturn(p,id){
    ensureVat(p);const item=p.vatReturns.find(r=>r.id===id);assert(item,'VAT return not found.');assert(item.status==='draft','Only draft VAT returns can be voided.');item.status='void';audit(p,'VAT return voided',`${item.period.start} to ${item.period.end}`);return item;
  }
  function markVatReturnSubmitted(p,id,hmrc={}){
    ensureVat(p);const item=p.vatReturns.find(r=>r.id===id);assert(item,'VAT return not found.');assert(item.status==='draft','Only a saved draft VAT return can be submitted.');item.status='submitted';item.submittedAt=new Date().toISOString();item.hmrc={periodKey:String(hmrc.periodKey||''),processingDate:hmrc.processingDate||'',receiptId:hmrc.receiptId||''};audit(p,'VAT return submitted',`${item.period.start} to ${item.period.end}${item.hmrc.periodKey?` · ${item.hmrc.periodKey}`:''}`);return item;
  }
  function demoProfile() {
    const p=newProfile('Alex Morgan','2026-04-06','2027-04-05',{demo:true,vehicle:'Toyota Prius · LM24 TAX',email:'alex@example.com'});
    p.contacts=[{id:'shell',name:'Shell Fuel',type:'supplier',email:''},{id:'garage',name:'City Auto Services',type:'supplier',email:''},{id:'corporate',name:'Northside Travel',type:'customer',email:''}];
    addJournal(p,{date:'2026-04-06',description:'Opening balances',lines:[{accountId:'bank',amount:185000},{accountId:'cash',amount:15000},{accountId:'vehicle',amount:1450000},{accountId:'loan',amount:-950000},{accountId:'capital',amount:-700000}]});
    const rows=[
      ['2026-04-10','Uber weekly payout','bank','platform',78540],['2026-04-18','Weekend cash fares','cash','fares',24600],['2026-04-20','Shell · fuel','bank','fuel',-6820],
      ['2026-05-08','Bolt weekly payout','bank','platform',91230],['2026-05-16','Cash fares & airport run','cash','fares',31800],['2026-05-18','Full valet · Clean Car','bank','cleaning',-3500],
      ['2026-06-05','Uber weekly payout','bank','platform',104680],['2026-06-18','Cash fares','cash','fares',27500],['2026-06-20','Admiral vehicle insurance','bank','insurance',-12800],
      ['2026-07-03','Bolt weekly payout','bank','platform',115420],['2026-07-12','Shell · fuel','bank','fuel',-7420],['2026-07-18','Cash fares','cash','fares',36400],
      ['2026-08-07','Uber weekly payout','bank','platform',123650],['2026-08-16','Cash fares','cash','fares',42500],['2026-08-18','EE · mobile data','bank','phone',-2800],
      ['2026-09-04','Bolt weekly payout','bank','platform',134200],['2026-09-12','Cash fares','cash','fares',38900],['2026-09-16','TfL driver licence','bank','licence',-31000],
      ['2026-10-02','Uber weekly payout','bank','platform',126780],['2026-10-04','Weekend cash fares','cash','fares',32700],['2026-10-06','Owner withdrawal','bank','drawings',-60000],
      ['2026-10-07','BP CONNECT LONDON','bank','suspense',-7245],['2026-10-08','Car wash','cash','cleaning',-1800]
    ];
    rows.forEach(([date,description,accountId,categoryId,amount])=>addTransaction(p,{date,description,accountId,categoryId,amount,businessPercent:categoryId==='phone'?80:100}));
    p.vat={...p.vat,registered:true,number:'972535988',scheme:'standard',basis:'cash',period:'quarterly'};
    p.transactions.forEach(t=>{if(['platform','fares'].includes(t.categoryId))t.vatCode='standard-output';if(['fuel','cleaning','insurance','phone','repairs','licence'].includes(t.categoryId))t.vatCode='standard-input';});
    const fuel=addInvoice(p,{kind:'purchase',date:'2026-10-01',due:'2026-10-15',reference:'SH-1042',description:'Fuel receipt · 42 litres',contactId:'shell',categoryId:'fuel',amount:6540,vat:654,vatCode:'standard-input'});
    addTransaction(p,{date:'2026-10-02',description:'Shell fuel · receipt SH-1042',accountId:'bank',categoryId:'payables',amount:-6540,contactId:'shell',invoiceId:fuel.id});
    addInvoice(p,{kind:'purchase',date:'2026-10-05',due:'2026-10-19',reference:'CA-2081',description:'Brake pads & vehicle service',contactId:'garage',categoryId:'repairs',amount:28500,vat:2850,vatCode:'standard-input'});
    addInvoice(p,{kind:'sale',date:'2026-10-06',due:'2026-10-20',reference:'INV-001',description:'Corporate airport transfers',contactId:'corporate',categoryId:'fares',amount:42000,vat:7000,vatCode:'standard-output'});
    p.rules=[{id:uid(),contains:'shell',direction:'payment',categoryId:'fuel',businessPercent:100}]; p.audit=[]; return p;
  }
  function validateState(s) {
    assert(s && s.version===1 && Array.isArray(s.profiles) && s.profiles.length,'This is not a supported bookkeeping backup.');
    const ids=new Set();
    for (const p of s.profiles) {
      assert(typeof p.id==='string' && !ids.has(p.id),'Invalid or duplicate profile.'); ids.add(p.id);
      assert(typeof p.name==='string' && p.name.trim(),'Invalid profile name.');
      for(const key of ['accounts','years','transactions','invoices','journals','contacts','audit','rules','mileage','reconciliations']) assert(Array.isArray(p[key]),`Missing ${key} in backup.`);
      assert(['cash','accrual'].includes(p.basis),'Invalid accounting basis.');
      if(p.vat!==undefined){assert(p.vat&&typeof p.vat==='object'&&!Array.isArray(p.vat),'Invalid VAT settings.');if(p.vat.registered)assert(/^(GB)?\d{9}$/.test(String(p.vat.number||'').replace(/\s+/g,'').toUpperCase()),'Invalid VAT registration number.');}
      if(p.vatReturns!==undefined){assert(Array.isArray(p.vatReturns),'Invalid VAT return history.');p.vatReturns.forEach(r=>{assert(r&&typeof r.id==='string'&&r.period&&typeof r.period.start==='string'&&typeof r.period.end==='string','Invalid VAT return snapshot.');assert(['draft','submitted','void'].includes(r.status),'Invalid VAT return status.');});}
      const accountIds=new Set(); p.accounts.forEach(a=>{assert(typeof a.id==='string' && !accountIds.has(a.id) && TYPES.includes(a.type) && typeof a.name==='string','Invalid account in backup.');accountIds.add(a.id);});
      for (const id of ['bank','cash','capital','drawings','suspense','payables','receivables']) assert(accountIds.has(id),'Required system account is missing.');
      p.accounts.forEach(a=>{assert(!a.parent || accountIds.has(a.parent),'Unknown category parent.');let current=a;const seen=new Set();while(current?.parent){assert(!seen.has(current.id),'Circular category hierarchy.');seen.add(current.id);current=account(p,current.parent);}});
      p.accounts.forEach(a=>{if(a.expenseCategoryId)assert(isSupplierAccount(p,a.id)&&account(p,a.expenseCategoryId)?.type==='expense','Invalid supplier-to-expense category link.');});
      if(p.entryMemory!==undefined){assert(Array.isArray(p.entryMemory),'Invalid entry memory in backup.');p.entryMemory.forEach(m=>{assert(m&&typeof m.key==='string'&&m.key&&['receipt','payment'].includes(m.direction)&&m.id===memoryId(m.accountId,m.direction,m.key),'Invalid remembered merchant.');assert(account(p,m.accountId)?.kind&&account(p,m.categoryId)&&typeof m.description==='string','Invalid remembered account or category.');assert(Number.isFinite(m.businessPercent)&&m.businessPercent>=0&&m.businessPercent<=100,'Invalid remembered business use.');assert(!m.vatCode||VAT_CODES[m.vatCode],'Invalid remembered VAT code.');assert(!m.contactId||p.contacts.some(c=>c.id===m.contactId),'Unknown remembered contact.');});}
      if(p.entryDefaults!==undefined)assert(p.entryDefaults&&typeof p.entryDefaults==='object'&&!Array.isArray(p.entryDefaults),'Invalid entry defaults in backup.');
      if(p.invoiceAllocations!==undefined){assert(Array.isArray(p.invoiceAllocations),'Invalid invoice allocations in backup.');validateInvoiceAllocations(p);}
      if(p.reportSections!==undefined){assert(Array.isArray(p.reportSections)&&p.reportSections.length,'Invalid accounts sections in backup.');const sections=new Set();p.reportSections.forEach(s=>{assert(s&&typeof s.id==='string'&&!sections.has(s.id)&&typeof s.name==='string'&&TYPES.includes(s.type),'Invalid or duplicate accounts section.');sections.add(s.id);assert(!s.rootId||account(p,s.rootId)?.type===s.type,'Invalid section category.');});p.accounts.forEach(a=>{if(a.reportSectionId)assert(p.reportSections.some(s=>s.id===a.reportSectionId&&s.type===a.type),'Invalid section assignment.');});}
      assert(p.years.length>0,'A profile must have a financial year.'); p.years.forEach((y,i)=>{date(y.start);date(y.end);assert(y.start<=y.end && typeof y.locked==='boolean','Invalid financial year.');assert(!p.years.some((z,j)=>j!==i && y.start<=z.end && y.end>=z.start),'Overlapping financial years.');});
      const copy=structuredClone(p); copy.years.forEach(y=>y.locked=false);copy.transactions=[];copy.invoices=[];
      for(const inv of p.invoices){addInvoice(copy,inv);}
      for(const t of p.transactions){validateTransaction(copy,t);assert(!copy.transactions.some(x=>x.id===t.id),'Duplicate transaction.');copy.transactions.push(t);}
      p.journals.forEach(j=>addJournal(copy,j)); entries(p);
    }
    return s;
  }
  const api={TYPES,VAT_CODES,vatCodes,vatSettings,setVatSettings,vatReturn,saveVatReturn,voidVatReturn,markVatReturnSubmitted,uid,sum,money,date,chart,newProfile,account,yearAt,editable,audit,invoiceBalance,validateTransaction,addTransaction,updateTransaction,removeTransaction,addInvoice,addJournal,addYear,entries,balances,profit,balanceSheet,importRows,commitImport,csv,demoProfile,validateState,merchantKey,rememberEntry,entryMemoryIndex,findEntryMemory,entrySuggestions,categorySuggestions,canCategorise,autoCategorisationPlan,applyAutoCategorisation,receiptMatches,addQuickReceipt,ensureCategories,isSupplierAccount,invoiceControl,requiresReceipt,addSubcategory,transactionAllocations,uncoveredPayment,pendingSupplierPayments,supplierProofGroups,validateInvoiceAllocations,allocateSupplierPayments,removeInvoiceAllocation,coveringSupplierInvoice,ensureFinancialPeriod,periodOf,ensureReportSections,reportSectionFor,addReportSection,accountsSummary};
  root.Bookkeeping=api; if(typeof module!=='undefined' && module.exports)module.exports=api;
})(globalThis);
