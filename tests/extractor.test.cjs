const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');const P=require('../extractor/parser.js');
const zlib=require('node:zlib');
const XLSX=require('../dist/vendor/xlsx.full.min.js');
const VT=require('../extractor/vt-export.js');
const VTImport=require('../extractor/vt-import.js');
test('PDF page links use absolute, Excel-safe file URLs',()=>{
  assert.equal(P.pdfFileUrl('C:\\Users\\Zain M\\Invoices\\fuel #1.pdf',46),'file:///C:/Users/Zain%20M/Invoices/fuel%20%231.pdf#page=46');
  assert.equal(P.pdfFileUrl('\\\\server\\share name\\invoice.pdf',3),'file://server/share%20name/invoice.pdf#page=3');
  assert.equal(P.pdfFileUrl('relative\\invoice.pdf',1),'');
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['PDF / page'],['Open PDF - page 46']]);
  sheet.A2.l={Target:P.pdfFileUrl('C:\\Users\\Zain M\\Invoices\\fuel #1.pdf',46),Tooltip:'Open source invoice'};
  XLSX.utils.book_append_sheet(workbook,sheet,'Invoices');
  const saved=XLSX.read(XLSX.write(workbook,{bookType:'xlsx',type:'buffer'}),{cellStyles:true});
  assert.equal(saved.Sheets.Invoices.A2.l.Target,'file:///C:/Users/Zain%20M/Invoices/fuel%20%231.pdf#page=46');
  assert.equal(saved.Sheets.Invoices.A2.l.Rel.TargetMode,'External');
});
function pdf(text){return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj\n`,'latin1');}
test('bank PDF text becomes dated receipt/payment rows',async()=>{const r=await P.parsePdf(pdf('(01/10/2026) Tj (Shell fuel) Tj (12.34) Tj (100.00) Tj (02/10/2026) Tj (Taxi fares) Tj (250.00) Tj'),'bank','statement.pdf');assert.equal(r.info.hasText,true);assert.equal(r.transactions.length,2);assert.equal(r.transactions[0].date,'2026-10-01');assert.equal(r.transactions[0].details.includes('Shell fuel'),true);assert.equal(r.transactions[0].receipt,12.34);assert.equal(r.transactions[0].review,true);});
test('bank CSV exports preserve quoted descriptions, directions, balances, and UK dates',()=>{
  const csv='Date,Description,Money In (GBP),Money Out (GBP),Balance (GBP)\r\n01/10/2026,"Fuel, station 14",,12.34,100.00\r\n02/10/2026,Taxi fares,250.00,,350.00\r\n';
  const rows=P.parseBankCsv(csv,'Barclays export.csv');
  assert.deepEqual(rows.map(row=>[row.date,row.details,row.receipt,row.payment,row.balance,row.source,row.confidence,row.review]),[
    ['2026-10-01','Fuel, station 14','',12.34,100,'Barclays export.csv','Bank CSV columns',false],
    ['2026-10-02','Taxi fares',250,'',350,'Barclays export.csv','Bank CSV columns',false]
  ]);
});
test('bank CSV import detects semicolon exports and signed amount columns',()=>{
  const csv='Account activity\nTransaction Date;Details;Type;Amount;Balance\n03/10/2026;Standing order;Debit;14.50;285.50\n04/10/2026;Refund;Credit;20.00;305.50';
  const rows=P.parseBankCsv(csv,'activity.csv');
  assert.deepEqual(rows.map(row=>[row.date,row.details,row.amount,row.receipt,row.payment,row.balance]),[
    ['2026-10-03','Standing order',-14.5,'',14.5,285.5],['2026-10-04','Refund',20,20,'',305.5]
  ]);
});
test('invoice PDF text extracts number, date, supplier, VAT and total',async()=>{const r=await P.parsePdf(pdf('(ACME MOTORS) Tj (Invoice number: AM-1042) Tj (Invoice date: 11/11/2026) Tj (Subtotal: £100.00) Tj (VAT: £20.00) Tj (Total due: £120.00) Tj'),'invoice','invoice.pdf');assert.equal(r.invoice.invoiceNumber,'1042');assert.equal(r.invoice.date,'2026-11-11');assert.equal(r.invoice.vat,20);assert.equal(r.invoice.total,120);assert.equal(r.invoice.subtotal,100);});
test('image-only PDF is reported without invented values',async()=>{const r=await P.parsePdf(pdf(''), 'invoice','scan.pdf');assert.equal(r.info.hasText,false);assert.equal(r.invoice.status,'REJECTED');assert.equal(r.invoice.total,'');});
test('invoice profiles identify supplier-specific and generic document formats',()=>{assert.equal(P.identifyInvoiceProfile('MARION TRADING LTD Invoice No 10445946').id,'marion-trading');assert.equal(P.identifyInvoiceProfile('MONOLITH (UK) LTD AUTO INVOICE - A 310642').id,'monolith');assert.equal(P.identifyInvoiceProfile('Peterborough Bazaar Limited Invoice No 0279659 VAT NO 104 2318 66').id,'peterborough-bazaar');assert.equal(P.identifyInvoiceProfile('Deens produce Ltd VAT number-354695660 Invoice No: 36163').id,'deens-produce');assert.equal(P.identifyInvoiceProfile('LIBERTY Frozen Foods MAP-210726-1').id,'liberty-frozen-foods');assert.equal(P.identifyInvoiceProfile('DAIRY FRESH LTD VAT Reg: GB1408634-22 Order Invoice').id,'dairy-fresh');assert.equal(P.identifyInvoiceProfile('SHAHD HALAL POULTRY LTD VAT No 159 5722 76').id,'shahid-halal-poultry');assert.equal(P.identifyInvoiceProfile('MASPO LTD Invoice number 123-AB/02/2026').id,'maspo');assert.equal(P.identifyInvoiceProfile('Polish Village Bread LTD DELIVERY 666715/MAG/2026').id,'polish-village-bread');assert.equal(P.identifyInvoiceProfile('DELIVERY 666715/MAG/2026 Issued baskets').id,'wz-delivery');assert.equal(P.identifyInvoiceProfile('Bestway Wholesale Invoice No. 262484240').id,'bestway');assert.equal(P.identifyInvoiceProfile('EAGLEFOODS Invoice To: Customer Invoice No 143871').id,'eagle-foods');assert.equal(P.identifyInvoiceProfile('Acme Motors Invoice 1042').id,'generic');assert.ok(P.compatibleCompanies.some(company=>company.id==='eagle-foods'&&company.name==='Eagle Foods Ltd'&&company.category==='Invoices'));assert.deepEqual(P.invoiceProfiles.map(profile=>profile.id),['freshways','bestway','eagle-foods','shahid-halal-poultry','marion-trading','monolith','peterborough-bazaar','deens-produce','liberty-frozen-foods','dairy-fresh','maspo','polish-village-bread','wz-delivery','generic']);});
test('Eagle Foods uses invoice pages only and statement rows only confirm existing invoice pages',()=>{
  const line=(page,text,x,y,width=String(text).length*9)=>({page,text,x,y,width,height:20,confidence:1});
  const invoice=[line(1,'EAGLEFOODS',80,20,150),line(1,'Invoice To:',80,80),line(1,'Account No',80,120),line(1,'CMKL',250,120),line(1,'Invoice No',500,120),line(1,'143871',700,120),line(1,'Order Date',1000,120),line(1,'31-AUG-26',1240,120),line(1,'Total Credit',1650,800),line(1,'1880.40',1800,850),line(1,'New Invoice Total',1650,900),line(1,'5,927.42',1800,950)];
  const statement=[line(2,'Eagle Foods Ltd',80,20),line(2,'Statement of Account',900,80),line(2,'Customer:',200,160),line(2,'CMKL - CHILLI MASTER (KINGS LYNN)',430,160),line(2,'Document Date',200,400),line(2,'Document Type',420,400),line(2,'Document No',650,400),line(2,'Net',900,400),line(2,'VAT',1100,400),line(2,'Total',1300,400),line(2,'Balance',1500,400),line(2,'Due Date',1700,400),line(2,'Days Old',1900,400),line(2,'Amount Due',2100,400),line(2,'31-AUG-26',200,440),line(2,'Sales Invoice',420,440),line(2,'143871',650,440),line(2,'1,827.89',900,440),line(2,'52.51',1100,440),line(2,'1,880.40',1300,440),line(2,'1,880.40',1500,440),line(2,'07-SEP-26',1700,440),line(2,'7',1900,440),line(2,'1,880.40',2100,440)];
  const parse=lines=>P.parseInvoiceBatch(lines.map(item=>item.text).join('\n'),'Eagle Foods.pdf',lines);
  const [confirmed]=parse([...invoice,...statement]);
  assert.deepEqual([confirmed.invoiceNumber,confirmed.originalInvoiceNumber,confirmed.date,confirmed.accountCode,confirmed.supplier,confirmed.total,confirmed.vat,confirmed.status,confirmed.sourcePages],['3871','143871','2026-08-31','CMKL','Eagle Foods Ltd',1880.4,52.51,'ACCEPTED',[1]]);
  assert.deepEqual(parse(statement),[],'a statement summary must never create an invoice row');
  assert.deepEqual(P.parseInvoiceBatch(statement.map(item=>item.text).join(' '),'statement-only.pdf'),[],'text-only statement pages must also be skipped');
  assert.deepEqual(parse([line(3,'Eagle Foods Ltd terms and conditions',80,20),line(3,'Interpretation and definitions',80,80)]),[],'terms pages are not invoices');
  const shifted=invoice.map(item=>({...item,x:item.x*1.8+350,y:item.y*1.6+120,width:item.width*1.8,height:item.height*1.6})),shiftedStatement=statement.map(item=>({...item,x:item.x*1.8+350,y:item.y*1.6+120,width:item.width*1.8,height:item.height*1.6})),[shiftedRow]=parse([...shifted,...shiftedStatement]);
  assert.deepEqual([shiftedRow.invoiceNumber,shiftedRow.date,shiftedRow.total,shiftedRow.vat,shiftedRow.status],['3871','2026-08-31',1880.4,52.51,'ACCEPTED'],'text anchors and header-relative columns must tolerate changed scale and location');
  const footerOnly=invoice.filter(item=>!['Total Credit','1880.40'].includes(item.text)),[unconfirmed]=parse(footerOnly);
  assert.equal(unconfirmed.total,'','New Invoice Total can include the previous account balance and is not used as the invoice total');
});
test('Eagle Foods explicit invoice summary handles zero VAT and duplicate invoice pages once',()=>{
  const line=(page,text,x,y,width=String(text).length*9)=>({page,text,x,y,width,height:20,confidence:1}),make=page=>[
    line(page,'Eagle Foods Ltd',80,20),line(page,'Invoice To:',80,70),line(page,'Account No:',100,120),line(page,'CMKL',300,120),line(page,'Invoice No:',100,180),line(page,'141787',300,180),line(page,'Invoice Date:',900,180),line(page,'02-AUG-26',1120,180),line(page,'Net Total',1200,800),line(page,'37.16',1400,840),line(page,'VAT Total',1500,800),line(page,'0.00',1680,840),line(page,'Invoice Total',1800,800),line(page,'37.16',2000,840)
  ],pages=[...make(1),...make(2)],rows=P.parseInvoiceBatch(pages.map(item=>item.text).join('\n'),'Eagle Foods modern.pdf',pages);
  assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].accountCode,rows[0].total,rows[0].vat,rows[0].status,rows[0].sourcePages],['1787','2026-08-02','CMKL',37.16,0,'ACCEPTED',[1,2]]);
});
test('Bestway takes VAT and total due from its Invoice Summary and groups continuation pages once',()=>{
  const line=(page,text,x,y,width=90)=>({page,text,x,y,width,height:20,confidence:1});
  const make=(page,number,date,total,sequence)=>[
    line(page,'BESTWAY WHOLESALE',80,30,220),line(page,'Invoice No.',1300,73,112),line(page,number,1600,69,216),
    line(page,'Date I Time',1299,121,90),line(page,`${date} 12:42:33`,1585,121,140),line(page,'Total:',1298,161,70),line(page,total,1660,158,120),
    ...(sequence?[line(page,sequence,1680,199,70)]:[])
  ];
  const lines=[
    ...make(1,'262484240','18-07-2026','E341.67','1 of 2'),
    ...make(2,'262484240','18-07-2026','E341.67',''),
    line(2,'VAT',770,410),line(2,'E999.99',880,410),line(2,'Invoice Summary',1500,345,130),
    line(2,'Total value (Ex VAT)',1416,458,180),line(2,'E294.81',1788,458),line(2,'VAT',1445,496),line(2,'E46.86',1813,496),line(2,'Total due (Inc VAT)',1416,534,180),line(2,'E341.67',1776,534),
    ...make(3,'263150978','03-08-2026','El,100.87','1 of 2'),
    ...make(4,'2631 0978','03-08-2026','El ,100.87','20f2'),
    line(4,'Invoice Summary',1526,900,130),line(4,'VAT',1445,1052),line(4,'E141.35',1826,1052),line(4,'Total due (Inc VAT)',1416,1089,180),line(4,'El ,100.87',1777,1089)
  ];
  const rows=P.parseInvoiceBatch(lines.map(item=>item.text).join('\n'),'Bestway.pdf',lines);
  assert.deepEqual(rows.map(row=>[row.invoiceNumber,row.originalInvoiceNumber,row.date,row.supplier,row.vat,row.total,row.status,row.page,row.profileId]),[
    ['4240','262484240','2026-07-18','Bestway Wholesale',46.86,341.67,'ACCEPTED',1,'bestway'],
    ['0978','263150978','2026-08-03','Bestway Wholesale',141.35,1100.87,'ACCEPTED',3,'bestway']
  ]);
  const missingSummary=[...make(5,'264989961','14-09-2026','E263.28','1 of 1'),line(5,'Invoice Summary',1500,900,130),line(5,'Total due (Inc VAT)',1416,1089,180),line(5,'E263.28',1777,1089)],[rejected]=P.parseInvoiceBatch(missingSummary.map(item=>item.text).join('\n'),'Bestway.pdf',missingSummary);
  assert.deepEqual([rejected.vat,rejected.total,rejected.status,rejected.retryOcr],['',263.28,'REJECTED',true],'a missing printed VAT amount must not be inferred or accepted');
  assert.ok(P.compatibleCompanies.some(company=>company.id==='bestway'&&company.name==='Bestway Wholesale'&&company.category==='Invoices'));
});
test('Bestway follows invoice labels when the printed layout is shifted on the page',()=>{
  const line=(text,x,y,width=100)=>({page:9,text,x,y,width,height:20,confidence:1});
  const lines=[
    line('BESTWAY WHOLESALE',40,20,220),line('1 of 1',640,24,60),
    line('Invoice No.',115,690,90),line('262480616',270,690,100),
    line('Date I Time',115,742,90),line('26-10-2026 12:42:33',270,742,150),
    line('VAT',82,340),line('E999.99',180,340),
    line('Invoice Summary',75,910,130),line('VAT',82,1470),line('E18.22',260,1470),
    line('Total due (Inc VAT)',82,1530,150),line('E217.64',260,1530)
  ];
  const [row]=P.parseInvoiceBatch(lines.map(item=>item.text).join('\n'),'Bestway-shifted.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.originalInvoiceNumber,row.date,row.vat,row.total,row.status,row.page],['0616','262480616','2026-10-26',18.22,217.64,'ACCEPTED',9]);
});
test('Bestway retry preserves a first-pass amount when unreadable and rejects conflicting OCR amounts',()=>{
  const firstPass={profileId:'bestway',invoiceNumber:'4240',originalInvoiceNumber:'262484240',date:'2026-07-18',supplier:'Bestway Wholesale',vat:46.86,total:341.67};
  const unreadable=P.mergeInvoiceRetryCandidate(firstPass,{profileId:'bestway',invoiceNumber:'',date:'',vat:'',total:'',accepted:false});
  assert.deepEqual([unreadable.vat,unreadable.total,unreadable.ocrConflictReason],[46.86,341.67,undefined],'blank 5x OCR fields must not erase verified first-pass amounts');
  assert.equal(P.invoiceRetryAccepted(unreadable,{accepted:false},true),true,'complete retained Bestway data should not remain rejected just because retry OCR omitted a field');
  const disagreed=P.mergeInvoiceRetryCandidate(firstPass,{profileId:'bestway',vat:2174.78,total:341.67,accepted:true});
  assert.deepEqual([disagreed.vat,disagreed.total,disagreed.ocrAmountConflicts.vat.firstPass,disagreed.ocrAmountConflicts.vat.retry],[46.86,341.67,46.86,2174.78]);
  assert.match(disagreed.ocrConflictReason,/OCR passes disagree on VAT/,'a conflicting high-resolution amount must be flagged for human confirmation');
  assert.equal(P.invoiceRetryAccepted(disagreed,{accepted:true},false),false,'a conflicting amount must never be accepted automatically');
  assert.equal(P.invoiceRetryAccepted({profileId:'generic'},{accepted:false},true),false,'other profiles keep their previous retry acceptance rule');
  const generic=P.mergeInvoiceRetryCandidate({profileId:'generic',vat:20,total:120},{profileId:'generic',vat:19.99,total:120,accepted:true});
  assert.equal(generic.vat,19.99,'the Bestway comparison rule must not change other supplier profiles');
});
test('Bestway OCR sample returns each distinct invoice once using its printed Invoice Summary',{skip:process.env.CLEARCOUNT_RUN_BESTWAY_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Bestway.pdf'))},()=>{
  const fixture=path.resolve(__dirname,'../samples/extractor/Invoices/Bestway.pdf'),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',fixture,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:100*1024*1024}),pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines),expected=[
    [1,'4240','2026-07-18',46.86,341.67],[3,'9505','2026-07-14',174.78,1437.34],[6,'8698','2026-08-14',86.56,629.01],[8,'0978','2026-08-03',141.35,1100.87],
    [10,'7943','2026-08-31',148.35,1535.36],[13,'3637','2026-08-17',128.58,1188.31],[16,'4974','2026-09-21',135.43,1163.64],[18,'9961','2026-09-14',40.11,263.28]
  ];
  assert.equal(pages.length,18);assert.equal(rows.length,expected.length,'continuation pages should not become duplicate invoices');
  assert.deepEqual(rows.map(row=>[row.page,row.invoiceNumber,row.date,row.vat,row.total]),expected);
  assert.ok(rows.every(row=>row.profileId==='bestway'&&row.supplier==='Bestway Wholesale'&&row.status==='ACCEPTED'&&!row.retryOcr));
  assert.equal(new Set(rows.map(row=>row.originalInvoiceNumber)).size,rows.length);
});
test('Liberty Frozen Foods reads its invoice current total, preserves MAP reference, and rejects handwritten total conflicts',()=>{
  const make=(page,invoiceTotal,bill=invoiceTotal,net=bill)=>[
    {page,text:'LIBERTY Frozen Foods Ltd',x:90,y:80},{page,text:'Order Date 20-JUL-26',x:500,y:700},{page,text:'MAP-210726-1',x:260,y:750},
    {page,text:'Net Value',x:1730,y:1900},{page,text:String(net),x:1750,y:1944},
    {page,text:'Invoice Total',x:1660,y:2000},{page,text:String(invoiceTotal),x:1750,y:2045},
    {page,text:'Balance BF',x:1390,y:2140},{page,text:'603.00',x:1750,y:2142},
    {page,text:'This Bill',x:1390,y:2200},{page,text:String(bill),x:1750,y:2194},{page,text:'Amount Due',x:1390,y:2260},{page,text:'603.00',x:1750,y:2258}
  ];
  const lines=[...make(1,'215.50'),...make(3,'215.50'),{page:2,text:'E.P.A. FOODS LTD Invoice Page 1 Total 287.26',x:80,y:100},{page:4,text:'Handwritten note only',x:90,y:80}],rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'liberty.pdf',lines);
  assert.equal(rows.length,1,'EPA documents, notes and duplicate invoice pages must not create extra entries');
  assert.deepEqual([rows[0].invoiceNumber,rows[0].originalInvoiceNumber,rows[0].date,rows[0].supplier,rows[0].vat,rows[0].total,rows[0].status,rows[0].page,rows[0].profileId],['MAP-210726-1','MAP-210726-1','2026-07-20','Liberty Frozen Foods Ltd',0,215.5,'ACCEPTED',1,'liberty-frozen-foods']);
  assert.ok(P.compatibleCompanies.some(company=>company.id==='liberty-frozen-foods'&&company.name==='Liberty Frozen Foods'));
  const shifted=make(7,'215.50').map(line=>({...line,x:line.x+450,y:line.y+1500})),[shiftedRow]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'liberty.pdf',shifted);
  assert.deepEqual([shiftedRow.date,shiftedRow.total,shiftedRow.status],['2026-07-20',215.5,'ACCEPTED']);
  const changed=make(5,'215.50','225.50','215.50'),[rejected]=P.parseInvoiceBatch(changed.map(line=>line.text).join('\n'),'liberty.pdf',changed);
  assert.deepEqual([rejected.total,rejected.status,rejected.retryOcr],['','REJECTED',true]);assert.match(rejected.rejectedReason,/handwritten amendment/i);
  const clipped=make(6,'166.7','166.7','166.7'),[unreadable]=P.parseInvoiceBatch(clipped.map(line=>line.text).join('\n'),'liberty.pdf',clipped);
  assert.deepEqual([unreadable.total,unreadable.status,unreadable.retryOcr],['','REJECTED',true]);
  const desktopOcr=make(10,'166.7','166.7','166.7').map(line=>({...line,text:line.text==='LIBERTY Frozen Foods Ltd'?'IBERTY Frozen Foods Ltd':line.text==='MAP-210726-1'?'MAP-250826-1':line.text==='Order Date 20-JUL-26'?'Order Date 24-AUG-26':line.text}));
  desktopOcr.push({page:10,text:'Invoice No.',x:200,y:600},{page:10,text:'Case Price 20.00',x:1500,y:1700},{page:10,text:'£20.00',x:40,y:2600},{page:10,text:'VAT Registration No. 383 5525 77 Company Registration No. 13440899',x:300,y:1900});
  const [desktopRow]=P.parseInvoiceBatch(desktopOcr.map(line=>line.text).join('\n'),'random-file.pdf',desktopOcr);
  assert.deepEqual([desktopRow.profileId,desktopRow.invoiceNumber,desktopRow.date,desktopRow.total,desktopRow.status,desktopRow.retryOcr],['liberty-frozen-foods','MAP-250826-1','2026-08-24','','REJECTED',true],'OCR-damaged Liberty headers must use the supplier parser, never the generic parser that can mistake a line-item price for the invoice total');
  const registrationOnly=desktopOcr.map(line=>({...line,text:line.text==='IBERTY Frozen Foods Ltd'?'Supplier':line.text})),[registeredRow]=P.parseInvoiceBatch(registrationOnly.map(line=>line.text).join('\n'),'renamed.pdf',registrationOnly);
  assert.deepEqual([registeredRow.profileId,registeredRow.total,registeredRow.status],['liberty-frozen-foods','','REJECTED'],'the unique supplier registration identifiers plus MAP reference must still select the Liberty profile when the name is unreadable');
  const fiveX=desktopOcr.map(line=>({...line,text:line.text==='MAP-250826-1'?'MAP-25082+1':line.text})),[fiveXRow]=P.parseInvoiceBatch(fiveX.map(line=>line.text).join('\n'),'renamed.pdf',fiveX);
  assert.deepEqual([fiveXRow.profileId,fiveXRow.invoiceNumber,fiveXRow.date,fiveXRow.total,fiveXRow.status],['liberty-frozen-foods','','2026-08-24','','REJECTED'],'when 5x OCR damages the invoice reference as well, retain a rejected invoice row and do not let the generic parser post a product price');
  const retried=P.mergeInvoiceRetryCandidate({profileId:'generic',total:20,accepted:false},{profileId:'liberty-frozen-foods',total:'',accepted:false});
  assert.deepEqual([retried.total,retried.accepted],['',false],'an unreadable 5x Liberty total must clear an unsafe generic first-pass amount');
  const mixed=[...make(1,'215.50'),{page:2,text:'E.P.A. FOODS LTD Invoice 42748 Total 287.26',x:80,y:100},{page:3,text:'Deens produce Ltd',x:65,y:328},{page:3,text:'Invoice No:',x:1399,y:409},{page:3,text:'36163',x:1788,y:410},{page:3,text:'Date:',x:1479,y:454},{page:3,text:'30/07/2026',x:1711,y:453},{page:3,text:'Subtotal',x:1367,y:1800},{page:3,text:'132.00',x:1765,y:1801},{page:3,text:'Total',x:1416,y:1845},{page:3,text:'132.00',x:1765,y:1846},{page:3,text:'Balance Due',x:1227,y:2008},{page:3,text:'132.00',x:1765,y:2009}],mixedRows=P.parseInvoiceBatch(mixed.map(line=>line.text).join('\n'),'mixed-suppliers.pdf',mixed);
  assert.deepEqual(mixedRows.map(row=>[row.profileId,row.supplier,row.invoiceNumber,row.total]),[['liberty-frozen-foods','Liberty Frozen Foods Ltd','MAP-210726-1',215.5],['deens-produce','Deens Produce Ltd','6163',132]]);
});
test('Dairy Fresh remains listed as under development while another supplier is added',()=>{const company=P.compatibleCompanies.find(item=>item.id==='dairy-fresh');assert.equal(company?.status,'Under development');});
test('Freshways reads the invoice header and printed invoice footer, ignoring Nijjar terms and account balances',()=>{
  const make=(page,number,date,total,{vat='EO.OO',vatLabel=true,balance='690.69'}={})=>[
    {page,text:'INVOICE',x:150,y:324},{page,text:'Invoice No:',x:1580,y:518},{page,text:number,x:1739,y:518},
    {page,text:'Invoice Date:',x:1560,y:617},{page,text:date,x:1741,y:617},
    {page,text:'Invoice:',x:1670,y:1905},{page,text:'E337.20',x:1815,y:1908},
    ...(vatLabel?[{page,text:'VAT:',x:1700,y:1962}]:[]),{page,text:vat,x:1845,y:1965},
    {page,text:'Invoice Total:',x:1610,y:2026},{page,text:total,x:1818,y:2028},
    {page,text:'Balance B/Forward:',x:1536,y:2082},{page,text:'E353.49',x:1819,y:2086},
    {page,text:'Total Balance Owed:',x:1504,y:2157},{page,text:balance,x:1819,y:2157},
    {page,text:'Freshways is the trading name of Nijjar Dairies Ltd VAT No: 629-1934-20',x:402,y:2318},
    {page,text:'Unless otherwise agreed in writing, all sales are subject to the Nijjar Dairies Limited standard terms',x:273,y:2209}
  ];
  const lines=[...make(1,'A8898206','18 Jul 2026','E337.20',{vatLabel:false,balance:'E690.69'}),...make(2,'A9076798','12 Sep 2026','E334.30',{vat:'E0.00',balance:'E334.30'})],rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'renamed-supplier.pdf',lines);
  assert.deepEqual(rows.map(row=>[row.page,row.invoiceNumber,row.originalInvoiceNumber,row.date,row.supplier,row.vat,row.total,row.status,row.profileId]),[
    [1,'8206','A8898206','2026-07-18','Freshways',0,337.20,'ACCEPTED','freshways'],
    [2,'6798','A9076798','2026-09-12','Freshways',0,334.30,'ACCEPTED','freshways']
  ]);
  const misleadingVat=[...make(4,'A9902030','20 Sep 2026','E385.01',{vat:'EO.OO',balance:'E20.00'}),{page:4,text:'VAT: 20.00',x:1650,y:820},{page:4,text:'20.00',x:268,y:1965}], [misleadingRow]=P.parseInvoiceBatch(misleadingVat.map(line=>line.text).join('\n'),'renamed-supplier.pdf',misleadingVat);
  assert.deepEqual([misleadingRow.invoiceNumber,misleadingRow.vat,misleadingRow.total,misleadingRow.status],['2030',0,385.01,'ACCEPTED'],'VAT must come from the invoice footer, not a VAT table/rate or account balance');
  for(const [rawVat,expectedVat] of [['20.00',0],['£0.00',0],['E20.00',20]]){const glyphLines=make(6,'A9902032','22 Sep 2026','E385.01',{vat:rawVat}),[glyphRow]=P.parseInvoiceBatch(glyphLines.map(line=>line.text).join('\n'),'renamed-supplier.pdf',glyphLines);assert.equal(glyphRow.vat,expectedVat,`Freshways must ignore the first VAT character as the pound glyph (${rawVat})`);}
  const retryDisagreement=P.mergeInvoiceRetryCandidate(misleadingRow,{...misleadingRow,vat:20,accepted:true});
  assert.deepEqual([retryDisagreement.vat,retryDisagreement.ocrAmountConflicts?.vat?.retry,P.invoiceRetryAccepted(retryDisagreement,{accepted:true},true)],[0,20,false],'a differing 5x Freshways VAT reading must not overwrite a confirmed footer value or remain accepted');
  const missingFooterAnchor=make(5,'A9902031','21 Sep 2026','E385.01',{vatLabel:false}).filter(line=>line.text!=='Invoice:');missingFooterAnchor.push({page:5,text:'VAT',x:1829,y:820},{page:5,text:'20.00',x:268,y:2684});
  const [unanchoredRow]=P.parseInvoiceBatch(missingFooterAnchor.map(line=>line.text).join('\n'),'renamed-supplier.pdf',missingFooterAnchor);
  assert.deepEqual([unanchoredRow.vat,unanchoredRow.status],['','REJECTED'],'if footer anchors are missing, do not promote a VAT heading or the unrelated bottom-left 20.00 to the invoice VAT');
  const shifted=make(3,'A9901234','18 Jul 2026','E337.20').map(line=>({...line,x:line.x+450,y:line.y+1500})),[shiftedRow]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'renamed-supplier.pdf',shifted);
  assert.deepEqual([shiftedRow.invoiceNumber,shiftedRow.date,shiftedRow.vat,shiftedRow.total,shiftedRow.status],['1234','2026-07-18',0,337.20,'ACCEPTED']);
  assert.ok(P.compatibleCompanies.some(company=>company.id==='freshways'&&company.name==='Freshways'&&company.category==='Invoices'));
});
test('Freshways OCR sample extracts all 11 invoices once from their invoice pages',{skip:process.env.CLEARCOUNT_RUN_FRESHWAYS_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Freshways.pdf'))},()=>{
  const fixture=path.resolve(__dirname,'../samples/extractor/Invoices/Freshways.pdf'),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',fixture,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:100*1024*1024}),pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines),expected=[
    ['8206','2026-07-18',337.20],['6798','2026-09-12',334.30],['4924','2026-07-11',353.49],['1130','2026-07-04',328.31],['2552','2026-08-01',313.20],['0563','2026-07-25',313.08],['1017','2026-08-29',308.35],['9266','2026-08-22',331.96],['7263','2026-08-15',273.85],['3608','2026-09-05',382.35],['9948','2026-09-19',385.01]
  ];
  assert.equal(pages.length,11);assert.equal(rows.length,expected.length,'each distinct Freshways invoice should appear exactly once');
  assert.deepEqual(rows.map(row=>[row.invoiceNumber,row.date,row.total]),expected);
  assert.ok(rows.every(row=>row.profileId==='freshways'&&row.supplier==='Freshways'&&row.vat===0&&row.status==='ACCEPTED'&&!row.retryOcr));
  const pageSeven=rows.find(row=>row.invoiceNumber==='1017');assert.deepEqual([pageSeven?.page,pageSeven?.total,pageSeven?.vat,pageSeven?.status],[7,308.35,0,'ACCEPTED']);
  assert.equal(new Set(rows.map(row=>row.invoiceNumber)).size,rows.length);
});
test('Liberty Frozen Foods PDF extracts only its unique invoices, skips EPA paperwork and rejects its clipped total',{skip:process.env.CLEARCOUNT_RUN_LIBERTY_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/libertyfoods.co..pdf'))},()=>{
  const fixture=path.resolve(__dirname,'../samples/extractor/Invoices/libertyfoods.co..pdf'),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',fixture,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:60*1024*1024}),pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines),expected=[
    [1,'MAP-210726-1','2026-07-20',215.50],[2,'MAP-070726-1','2026-07-06',332.38],[3,'MAP-140726-1','2026-07-14',387.50],
    [5,'MAP-040826-1','2026-08-03',366.23],[6,'MAP-280726-1','2026-07-27',249.25],[7,'MAP-010926-1','2026-08-31',427.25],
    [10,'MAP-250826-1','2026-08-24',''],[11,'MAP-180826-1','2026-08-17',210],[13,'MAP-080926-1','2026-09-07',232.50],
    [15,'MAP-180926-1','2026-09-18',188.26],[16,'MAP-220926-1','2026-09-21',141.10]
  ];
  assert.equal(pages.length,16);assert.equal(rows.length,expected.length,'the EPA page, blank page, handwritten note and duplicate scans must not become invoices');
  assert.deepEqual(rows.map(row=>[row.page,row.invoiceNumber,row.date,row.total]),expected);
  assert.ok(rows.every(row=>row.profileId==='liberty-frozen-foods'&&row.supplier==='Liberty Frozen Foods Ltd'&&row.vat===0));
  assert.equal(rows.filter(row=>row.status==='ACCEPTED').length,10);assert.equal(rows.filter(row=>row.status==='REJECTED').length,1);
  assert.deepEqual([rows[6].status,rows[6].retryOcr],['REJECTED',true]);
  assert.equal(new Set(rows.map(row=>row.invoiceNumber)).size,rows.length);
});
test('Shahid Halal profile reads the upper document date and TOTAL while ignoring account balances',()=>{
  const make=(page,date,total,balance='1,361.06',grand='2,557.24')=>[
    {page,text:'SHAHID HALAL POULTRY LTD',x:72,y:60},{page,text:'VAT No. 159 5722 76',x:598,y:2676},
    {page,text:date,x:215,y:345},{page,text:'DATE',x:484,y:421},{page,text:date,x:454,y:469},
    {page,text:'TOTAL:',x:1191,y:2467},{page,text:total,x:1381,y:2467},
    {page,text:'BALANCE:',x:1172,y:2509},{page,text:balance,x:1381,y:2509},
    {page,text:'G TOTAL:',x:1179,y:2552},{page,text:grand,x:1381,y:2552}
  ];
  const lines=[...make(1,'06/09/2026','El,629.95'),...make(2,'13/09/2026','1,361.06','1,629.95','2,991.01')],rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'renamed.pdf',lines);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>[row.page,row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.status,row.retryOcr,row.profileId]),[
    [1,'0609','2026-09-06','Shahid Halal Poultry Ltd',0,1629.95,'ACCEPTED',false,'shahid-halal-poultry'],
    [2,'1309','2026-09-13','Shahid Halal Poultry Ltd',0,1361.06,'ACCEPTED',false,'shahid-halal-poultry']
  ]);
  assert.equal(rows[0].rejectedReason,'');
  assert.equal(rows[1].rejectedReason,'');
  const shifted=make(1,'06/09/2026','1,629.95').map(line=>({...line,x:line.x-1000,y:line.y+1350})),[shiftedRow]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'renamed.pdf',shifted);
  assert.deepEqual([shiftedRow.date,shiftedRow.total,shiftedRow.vat,shiftedRow.status],['2026-09-06',1629.95,0,'ACCEPTED']);
  assert.ok(P.compatibleCompanies.some(company=>company.id==='shahid-halal-poultry'&&company.name==='Shahid Halal Poultry'&&company.category==='Invoices'));
});
test('Shahid Halal date references gain DDMM sequence suffixes only for repeated dates and stay distinct in deduplication',()=>{
  const make=(page,total)=>[
    {page,text:'SHAHID HALAL POULTRY LTD',x:72,y:60},{page,text:'05/07/2026',x:215,y:345},
    {page,text:'TOTAL:',x:1191,y:2467},{page,text:total,x:1381,y:2467}
  ];
  const lines=[...make(1,'1,000.00'),...make(2,'2,000.00')],rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'shahid.pdf',lines).map(row=>({...row,sourcePath:'C:\\Invoices\\shahid.pdf'}));
  assert.deepEqual(rows.map(row=>row.invoiceNumber),['050701','050702']);
  const result=P.deduplicateInvoiceRows([...rows,{...rows[0]}]);
  assert.equal(result.rows.length,2);assert.equal(result.duplicates,1);
});
test('Shahid Halal ambiguous leading currency glyph waits for a 5x total-cell reread',()=>{
  const make=(amount)=>[
    {page:3,text:'SHAHID HALAL POULTRY LTD',x:72,y:60},{page:3,text:'20/09/2026',x:232,y:345},
    {page:3,text:'TOTAL:',x:1240,y:2469.6},{page:3,text:amount,x:1431,y:2469.6},{page:3,text:'BALANCE:',x:1226,y:2515},
    {page:3,text:'1,361.06',x:1430,y:2515},{page:3,text:'G TOTAL:',x:1234,y:2558},{page:3,text:'2,557.24',x:1430,y:2558}
  ];
  const firstLines=make('21,196.18'),[first]=P.parseInvoiceBatch(firstLines.map(line=>line.text).join('\n'),'scan.pdf',firstLines);
  assert.deepEqual([first.total,first.vat,first.status,first.retryOcr],['',0,'REJECTED',true]);
  const highLines=make('1,196.18'),[verified]=P.parseInvoiceBatch(highLines.map(line=>line.text).join('\n'),'scan.pdf',highLines);
  assert.deepEqual([verified.total,verified.vat,verified.status,verified.retryOcr],[1196.18,0,'ACCEPTED',false]);
});
test('Shahid Halal scanned sample extracts each printed invoice total and date, retrying only ambiguous totals',{skip:process.env.CLEARCOUNT_RUN_SHAHID_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Shahid Halal Poultry.pdf'))},()=>{
  const helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1'),fixture=path.resolve(__dirname,'../samples/extractor/Invoices/Shahid Halal Poultry.pdf');
  const scan=(scale,pages='')=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',fixture,'-Scale',String(scale),...(pages?['-PageList',pages]:[])],{encoding:'utf8',windowsHide:true,maxBuffer:40*1024*1024});
  const parse=raw=>{const pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]);return {pages,lines,rows:P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines)};};
  const first=parse(scan(2.5)),expected=[
    ['2026-09-06',1629.95],['2026-09-13',1361.06],['2026-09-20',1196.18],['2026-07-19',1182.94],
    ['2026-06-28',1470.72],['2026-07-05',2185.32],['2026-07-12',1777.02],['2026-07-26',1289.12],
    ['2026-07-05',1210.97],['2026-08-09',1100.96],['2026-08-16',1333.44],['2026-08-23',1197.84],['2026-08-30',1125.34]
  ];
  assert.equal(first.pages.length,13);assert.equal(first.rows.length,expected.length);
  assert.deepEqual(first.rows.map(row=>row.page),Array.from({length:13},(_,index)=>index+1));
  const retryPages=first.rows.filter(row=>row.retryOcr).map(row=>row.page);
  assert.deepEqual(retryPages,[3,13],'only totals with the OCR-added leading 2 should need a focused retry');
  const retried=parse(scan(5,retryPages.join(',')));
  for(const row of first.rows.filter(item=>item.retryOcr)){const verified=retried.rows.find(item=>item.page===row.page);assert.ok(verified,`page ${row.page} should be reread`);row.total=verified.total;row.retryOcr=verified.retryOcr;row.status=verified.status;row.accepted=verified.accepted;row.rejected=verified.rejected;row.rejectedReason=verified.rejectedReason;}
  const expectedReferences=['0609','1309','2009','1907','2806','050701','1207','2607','050702','0908','1608','2308','3008'];
  assert.deepEqual(first.rows.map((row,index)=>[row.date,row.total,row.vat,row.supplier,row.invoiceNumber,row.status,row.retryOcr]),expected.map(([date,total],index)=>[date,total,0,'Shahid Halal Poultry Ltd',expectedReferences[index],'ACCEPTED',false]));
  assert.equal(new Set(first.rows.map(row=>row.page)).size,13);
  assert.ok(first.rows.every(row=>row.rejectedReason===''));
});
test('Peterborough Bazaar profile reads only printed footer VAT and final total and deduplicates repeated pages',()=>{
  const make=(page,number,date,total,vat,{vatMissing=false}={})=>[
    {page,text:'Peterborough Bazaar Limited',x:50,y:40},{page,text:'Email: info@pbazaar.co.uk',x:50,y:200},{page,text:'INVOICE',x:900,y:70},
    {page,text:'Invoice No',x:1420,y:280},{page,text:`• ${number}`,x:1660,y:282},{page,text:'Date',x:1420,y:320},{page,text:`• ${date}`,x:1660,y:322},
    {page,text:'Current Balance : 999.99',x:1420,y:440},{page,text:'Total: 311 pcs',x:1420,y:2300},
    {page,text:'Sub Total',x:1420,y:2380},{page,text:'100.00',x:1760,y:2382},
    {page,text:'VAT Total',x:1420,y:2430},...(!vatMissing?[{page,text:String(vat),x:1760,y:2432}]:[]),
    {page,text:'Discount Total',x:1420,y:2480},{page,text:'0.00',x:1760,y:2482},
    {page,text:'Total',x:1420,y:2560},{page,text:String(total),x:1760,y:2562}
  ];
  const first=make(1,'0279659','28/09/2026','173.80','23.37'),duplicate=make(2,'0279659','28/09/2026','173.80','23.37'),damagedDecimal=make(3,'0269883','06/07/2026','292 • 64','23.22'),missingVat=make(4,'0272493','27/07/2026','256.45','14.74',{vatMissing:true}),lines=[...first,...duplicate,...damagedDecimal,...missingVat],rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'renamed.pdf',lines);
  assert.equal(rows.length,3,'the repeated invoice page must not become another row');
  assert.deepEqual(rows.map(row=>[row.page,row.originalInvoiceNumber,row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.status,row.retryOcr,row.layoutId]),[
    [1,'0279659','9659','2026-09-28','Peterborough Bazaar Limited',23.37,173.8,'ACCEPTED',false,'peterborough-bazaar-footer-summary'],
    [3,'0269883','9883','2026-07-06','Peterborough Bazaar Limited',23.22,292.64,'ACCEPTED',false,'peterborough-bazaar-footer-summary'],
    [4,'0272493','2493','2026-07-27','Peterborough Bazaar Limited','',256.45,'REJECTED',true,'peterborough-bazaar-footer-summary']
  ]);
  const shifted=make(5,'0278116','16/08/2026','218.40','19.76').map(line=>({...line,x:Number(line.x)-1300,y:Number(line.y)+1000})),[shiftedRow]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'shifted-peterborough.pdf',shifted);
  assert.deepEqual([shiftedRow.invoiceNumber,shiftedRow.date,shiftedRow.vat,shiftedRow.total,shiftedRow.status],['8116','2026-08-16',19.76,218.4,'ACCEPTED'],'printed labels must remain usable when OCR coordinates shift');
  assert.ok(P.compatibleCompanies.some(company=>company.id==='peterborough-bazaar'&&company.name==='Peterborough Bazaar'&&company.category==='Invoices'));
});
test('Deens Produce profile reads labelled total and date, keeps four invoice digits, and always records zero VAT',()=>{
  const make=(page,number,date,total,options={})=>{
    const subtotal=options.subtotal??total,lines=[
      {page,text:'Deens produce Ltd',x:65,y:328},{page,text:'VAT number-354695660',x:62,y:540},
      {page,text:'Invoice No:',x:1399,y:409},{page,text:number,x:1788,y:410},{page,text:'Date:',x:1479,y:454},{page,text:date,x:1711,y:453},
      {page,text:'Amount',x:1749,y:895},{page,text:'510.50*',x:1760,y:976},
      {page,text:'Subtotal',x:1367,y:1800},{page,text:String(subtotal),x:1765,y:1801},
      {page,text:'Total',x:1416,y:1845},{page,text:String(total),x:1765,y:1846},
      {page,text:'Paid',x:1428,y:1932},{page,text:'$0.00',x:1765,y:1933},
      {page,text:'Balance Due',x:1227,y:2008},{page,text:options.balance??String(total),x:1765,y:2009}
    ];
    if(options.note!==false)lines.push({page,text:'*Indicates non-taxable item',x:65,y:1700});
    return lines;
  };
  const page2=make(2,'35765','06/07/2026','5104.00',{subtotal:'S104.oo',balance:'C104.oo'}),[row]=P.parseInvoiceBatch(page2.map(line=>line.text).join('\n'),'renamed.pdf',page2);
  assert.deepEqual([row.originalInvoiceNumber,row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.status,row.profileId,row.layoutId],['35765','5765','2026-07-06','Deens Produce Ltd',0,104,'ACCEPTED','deens-produce','deens-produce-footer-total']);
  const shifted=make(8,'37816','16/08/2026','218.40').map(line=>({...line,x:Number(line.x)-1300,y:Number(line.y)+1400})),[shiftedRow]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'shifted-deens.pdf',shifted);
  assert.deepEqual([shiftedRow.invoiceNumber,shiftedRow.date,shiftedRow.vat,shiftedRow.total,shiftedRow.status],['7816','2026-08-16',0,218.4,'ACCEPTED'],'label and row relationships must survive shifted coordinates');
  const split=[...make(4,'36981','17/09/2026','$207.50',{note:false}),{page:5,text:'Deens produce Ltd',x:65,y:328},{page:5,text:'*Indicates non-taxable item',x:65,y:1700},{page:5,text:'Subtotal',x:1367,y:1800},{page:5,text:'207.50',x:1765,y:1801},{page:5,text:'Total',x:1416,y:1845},{page:5,text:'207.50',x:1765,y:1846},{page:5,text:'Balance Due',x:1227,y:2008},{page:5,text:'207.50',x:1765,y:2009}],rows=P.parseInvoiceBatch(split.map(line=>line.text).join('\n'),'split.pdf',split);
  assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].total,rows[0].vat,rows[0].page,rows[0].status],['6981','2026-09-17',207.5,0,4,'ACCEPTED']);
  const noVatNote=make(6,'37054','22/09/2026','64.25',{note:false}),[zeroVat]=P.parseInvoiceBatch(noVatNote.map(line=>line.text).join('\n'),'renamed.pdf',noVatNote);
  assert.deepEqual([zeroVat.vat,zeroVat.total,zeroVat.status,zeroVat.retryOcr],[0,64.25,'ACCEPTED',false]);
  const ambiguous=make(7,'37159','28/09/2026','5104.00',{subtotal:'112.50',balance:'112.50'}),[uncertain]=P.parseInvoiceBatch(ambiguous.map(line=>line.text).join('\n'),'renamed.pdf',ambiguous);
  assert.deepEqual([uncertain.total,uncertain.status],['','REJECTED']);
  assert.ok(P.compatibleCompanies.some(company=>company.name==='Deens Produce'&&company.category==='Invoices'));
});
test('Dairy Fresh profile groups continuation pages and reads printed VAT and final totals without calculation',()=>{
  const expected=[
    {pages:[1,2],number:'2026232583',date:'2026-07-06',vat:61.11,total:626.01},
    {pages:[3,14,15],number:'2026244249',date:'2026-08-31',vat:63.96,total:1025.83},
    {pages:[4,5,6],number:'2026245766',date:'2026-09-07',vat:47.15,total:753.05},
    {pages:[7,8,9],number:'2026247153',date:'2026-09-14',vat:23.96,total:469.73},
    {pages:[11,12],number:'2026248682',date:'2026-09-21',vat:45.23,total:567.79},
    {pages:[16,17],number:'2026242859',date:'2026-08-24',vat:31.46,total:378.78},
    {pages:[18,19,20,22,24],number:'2026241335',date:'2026-08-17',vat:133.70,total:1579.36},
    {pages:[26,27,28],number:'2026233999',date:'2026-07-13',vat:90.32,total:876.62},
    {pages:[30,32],number:'2026235415',date:'2026-07-20',vat:62.59,total:606.26}
  ];
  const lines=[];
  for(const invoice of expected){
    invoice.pages.forEach((page,index)=>{
      const damagedNumber=invoice.number==='2026245766'&&page===5?'2026845766':invoice.number==='2026248682'&&page===12?'202624682':invoice.number;
      const pageDate=invoice.number==='2026247153'&&page===9?'14/06/2026':invoice.date.split('-').reverse().join('/');
      lines.push({page,text:'Order Invoice',x:100,y:70},{page,text:'Order No:',x:100,y:255},{page,text:damagedNumber,x:390,y:260},{page,text:'Order Date:',x:100,y:355},{page,text:pageDate,x:390,y:360});
      if(index===0)lines.push({page,text:'Dairy Fresh Ltd VAT Reg: GB1408634-22',x:1600,y:250});
      if(index===invoice.pages.length-1){
        lines.push({page,text:`Total VAT Amt`,x:1490,y:2200},{page,text:invoice.vat.toFixed(2),x:1800,y:2201},{page,text:'Invoice Disc',x:1490,y:2260},{page,text:'Net Amt',x:1550,y:2320},{page,text:'Total',x:1600,y:2500},{page,text:invoice.total.toFixed(2),x:1800,y:2501},{page,text:`Page ${index+1} of ${invoice.pages.length}`,x:80,y:2670});
      }
    });
  }
  lines.push({page:10,text:'TOTAL CUSTOMER BALANCE SUMMARY',x:500,y:40},{page:10,text:'Total 5,854.94',x:1500,y:180});
  lines.push({page:40,text:'Order Invoice',x:100,y:70},{page:40,text:'Order No:',x:100,y:255},{page:40,text:'2099001234',x:390,y:260},{page:40,text:'Order Date:',x:100,y:355},{page:40,text:'07/09/2026',x:390,y:360},{page:40,text:'Other Wholesaler Ltd',x:1600,y:250});
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'Dairy Fresh.pdf',lines);
  assert.equal(rows.length,expected.length,'summary pages and unrelated order invoices must not become Dairy Fresh rows');
  assert.deepEqual(rows.map(row=>({page:row.page,pages:row.sourcePages,footer:row.footerPage,original:row.originalInvoiceNumber,number:row.invoiceNumber,date:row.date,vat:row.vat,total:row.total,status:row.status,profile:row.profileId})),expected.map(invoice=>({page:invoice.pages[0],pages:invoice.pages,footer:invoice.pages.at(-1),original:invoice.number,number:invoice.number.slice(-4),date:invoice.date,vat:invoice.vat,total:invoice.total,status:'ACCEPTED',profile:'dairy-fresh'})));
  assert.equal(new Set(rows.map(row=>row.invoiceNumber)).size,expected.length,'each printed order reference must produce one row');
  const shiftedLines=lines.map(line=>({...line,x:line.x+350,y:line.y+1250})),shiftedRows=P.parseInvoiceBatch(shiftedLines.map(line=>line.text).join('\n'),'Dairy Fresh.pdf',shiftedLines);
  assert.deepEqual(shiftedRows.map(row=>[row.originalInvoiceNumber,row.date,row.vat,row.total,row.status]),expected.map(invoice=>[invoice.number,invoice.date,invoice.vat,invoice.total,'ACCEPTED']));
  assert.ok(rows.every(row=>row.subtotal===''));
  assert.ok(P.compatibleCompanies.some(company=>company.name==='Dairy Fresh'&&company.category==='Invoices'));

  // The retry may contain only the final-page footer: preserve the original
  // header OCR so a damaged high-resolution continuation page still joins the
  // right order, while taking VAT and total only from the focused retry.
  const footerPages=new Set(expected.map(invoice=>invoice.pages.at(-1)));
  const firstPass=lines.filter(line=>!footerPages.has(line.page)||Number(line.y)<=2000||Number(line.x)<1400);
  const retryFooter=lines.filter(line=>footerPages.has(line.page)&&Number(line.y)>2000&&Number(line.x)>=1400&&(['Total VAT Amt','Invoice Disc','Net Amt','Total'].includes(line.text)||/^\s*\d+\.\d{2}\s*$/.test(line.text))).map(line=>({...line,dairyVariant:0}));
  const retryLines=[...firstPass,...retryFooter],retried=P.parseInvoiceBatch(retryLines.map(line=>line.text).join('\n'),'Dairy Fresh.pdf',retryLines);
  assert.deepEqual(retried.map(row=>[row.originalInvoiceNumber,row.invoiceNumber,row.date,row.vat,row.total,row.status]),expected.map(invoice=>[invoice.number,invoice.number.slice(-4),invoice.date,invoice.vat,invoice.total,'ACCEPTED']));
});
test('Dairy Fresh scanned sample identifies each invoice and never accepts an unverified footer value',{skip:process.env.CLEARCOUNT_RUN_DAIRY_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Dairy Fresh/Dairy Fresh.pdf'))},()=>{
  const helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1'),fixture=path.resolve(__dirname,'../samples/extractor/Invoices/Dairy Fresh/Dairy Fresh.pdf');
  const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',fixture,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:80*1024*1024});
  const pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines),expected=[
    ['2026232583','2026-07-06',[1,2],61.11,626.01],['2026244249','2026-08-31',[3,14,15],63.96,1025.83],
    ['2026245766','2026-09-07',[4,5,6],47.15,753.05],['2026247153','2026-09-14',[7,8,9],23.96,469.73],
    ['2026248682','2026-09-21',[11,12],45.23,567.79],['2026242859','2026-08-24',[16,17],31.46,378.78],
    ['2026241335','2026-08-17',[18,19,20,22,24],133.70,1579.36],['2026233999','2026-07-13',[26,27,28],90.32,876.62],
    ['2026235415','2026-07-20',[30,32],62.59,606.26]
  ];
  assert.equal(pages.length,32);assert.equal(rows.length,expected.length,'blank balance summaries must not be exported as invoices');
  assert.deepEqual(rows.map(row=>[row.originalInvoiceNumber,row.invoiceNumber,row.date,row.sourcePages]),expected.map(([number,date,pages])=>[number,number.slice(-4),date,pages]));
  for(const [index,row] of rows.entries()){
    const [, , ,vat,total]=expected[index];
    if(row.vat!=='')assert.equal(Number(row.vat),vat,'invoice '+row.invoiceNumber+' must match its printed VAT');
    if(row.total!=='')assert.equal(Number(row.total),total,'invoice '+row.invoiceNumber+' must match its printed total');
    if(row.status==='ACCEPTED')assert.deepEqual([Number(row.vat),Number(row.total)],[vat,total]);
    else assert.equal(row.retryOcr,true,'an unconfirmed scanned footer must remain queued for the focused 5x retry');
  }
});
test('fuel receipt profiles use printed totals, reject implausible OCR and list compatible suppliers by category',()=>{
  const bp=[
    {page:1,text:'Little Hampton London Road Yaxley VAT: 663 139 630',x:80,y:230},
    {page:1,text:'UNLEADED Pump',x:80,y:405},
    {page:1,text:'Total:',x:30,y:507},
    {page:1,text:'£30.00',x:462,y:508},
    {page:1,text:'Date/Time 15.06.2025 22:32',x:34,y:1095}
  ];
  const row=P.parseReceiptBatch('', 'renamed-file.pdf',bp)[0];
  assert.deepEqual([row.supplier,row.date,row.total,row.status,row.page],['BP','2025-06-15',30,'ACCEPTED',1]);
  const eg=[
    {page:2,text:'EG ON THE MijVb Limited',x:140,y:219},
    {page:2,text:'Petrol Station VAT 473949343',x:200,y:415},
    {page:2,text:'26 May 2025',x:205,y:532},
    {page:2,text:'Pump 4 15.76 1.0269/L',x:78,y:845},
    {page:2,text:'Total',x:20,y:922},
    {page:2,text:'Totals',x:16,y:1270},
    {page:2,text:'20',x:574,y:1270}
  ];
  const egRow=P.parseReceiptBatch('', 'batch.pdf',eg)[0];
  assert.deepEqual([egRow.supplier,egRow.date,egRow.total,egRow.status],['EG On The Move','2025-05-26',20,'ACCEPTED']);
  const mfg=[
    {page:3,text:'Motor Fuel Limited MFG',x:180,y:190},
    {page:3,text:'Sun 14 Dec 2025',x:184,y:402},
    {page:3,text:'SALE',x:324,y:613},
    {page:3,text:'Unleaded',x:70,y:682},
    {page:3,text:'20.00',x:550,y:686},
    {page:3,text:'Pump9: 15.05 1.329/L',x:126,y:719},
    {page:3,text:'Total',x:70,y:788},
    {page:3,text:'20 coo',x:550,y:791},
    {page:3,text:'Totals',x:68,y:1105},
    {page:3,text:'20.00',x:562,y:1108}
  ];
  const mfgRow=P.parseReceiptBatch('', 'batch.pdf',mfg)[0];
  assert.deepEqual([mfgRow.supplier,mfgRow.date,mfgRow.total,mfgRow.status],['MFG','2025-12-14',20,'ACCEPTED']);
  const tescoSale=[
    {page:4,text:'TESCO Esso',x:275,y:192},
    {page:4,text:'SALE',x:266,y:695},
    {page:4,text:'20 - OO',x:484,y:664},
    {page:4,text:'MASTERCARD SALE',x:100,y:695},
    {page:4,text:'Date 09/12/2025 16:50',x:100,y:1762}
  ];
  const tescoRow=P.parseReceiptBatch('', 'batch.pdf',tescoSale)[0];
  assert.deepEqual([tescoRow.supplier,tescoRow.date,tescoRow.total,tescoRow.status],['Tesco','2025-12-09',20,'ACCEPTED']);
  const esso=P.parseReceiptBatch('', 'renamed-esso.pdf',[
    {page:6,text:'ESSO PETROLEUM COMPANY LTD VAT No. 239088635',x:160,y:1066},
    {page:6,text:'UNLEADED PUMP',x:67,y:536},
    {page:6,text:'TOTAL',x:54,y:661},
    {page:6,text:'£30.02',x:558,y:691},
    {page:6,text:'10/02/26 11:09',x:86,y:1540}
  ])[0];
  assert.deepEqual([esso.supplier,esso.date,esso.total,esso.status],['Esso','2026-02-10',30.02,'ACCEPTED']);
  const fadedUnknown=[
    {page:5,text:"'El",x:312,y:168},
    {page:5,text:'v /.\\T: rz18 001',x:246,y:248},
    {page:5,text:'T c.it •l :',x:78,y:444},
    {page:5,text:'? ! . 01',x:474,y:680}
  ];
  const unknown=P.parseReceiptBatch('', 'faded.pdf',fadedUnknown)[0];
  assert.deepEqual([unknown.supplier,unknown.date,unknown.total,unknown.status,unknown.page],['Unidentified forecourt','','','REJECTED',5]);
  const bad=[...bp.filter(line=>line.text!=='£30.00'),{page:1,text:'932.96',x:462,y:508}];
  const rejected=P.parseReceiptBatch('', 'renamed-file.pdf',bad)[0];
  assert.equal(rejected.status,'REJECTED');
  assert.ok(P.compatibleCompanies.some(company=>company.name==='BP'&&company.category==='Fuel receipts'));
  assert.ok(P.compatibleCompanies.some(company=>company.name==='Marion Trading'&&company.category==='Invoices'));
  assert.ok(!P.compatibleCompanies.some(company=>company.name==='Mitretec Auto Parts'));
  assert.ok(!P.receiptProfiles.some(profile=>profile.id==='mitretec-auto-parts'));
});
test('MFG receipt totals stay printed while split fuel and shop goods use the separate printed subtotals',()=>{
  const page24=[
    {page:24,text:'MFG Woodston Service Station',x:174,y:157},{page:24,text:'Fri 09 Jan 2026 20:14:41',x:202,y:402},
    {page:24,text:'Unleaded',x:88,y:682},{page:24,text:'Bonds Dairy Toffee',x:88,y:752},
    {page:24,text:'Toi.a I',x:88,y:821},{page:24,text:'31.26',x:616,y:822},
    {page:24,text:'Motor Fuel',x:88,y:995},{page:24,text:'Ltd',x:244,y:996},
    {page:24,text:'Totals',x:88,y:1136},{page:24,text:'30.01',x:582,y:1137},
    {page:24,text:'Sagaa Retail Ltd',x:88,y:1207},{page:24,text:'Totals',x:88,y:1344},{page:24,text:'I .25',x:599,y:1346}
  ];
  const row24=P.parseReceiptBatch('', 'fuel.pdf',page24)[0];
  assert.deepEqual([row24.date,row24.total,row24.fuelAmount,row24.drawingsAmount,row24.status],['2026-01-09',31.26,30.01,1.25,'ACCEPTED']);
  const page25=[
    {page:25,text:'MFG Woodston Service Station',x:168,y:145},{page:25,text:'Fri 16 Jan 2026',x:196,y:390},
    {page:25,text:'Regular Cappuccino + Syrup',x:80,y:668},{page:25,text:'Unleaded',x:80,y:704},
    {page:25,text:'Total',x:80,y:809},{page:25,text:'33.41',x:560,y:812},
    {page:25,text:'Motor Fuel',x:80,y:985},{page:25,text:'Totals',x:80,y:1123},{page:25,text:'30.01',x:573,y:1126},
    {page:25,text:'Sagaa Ret:ail Ltd',x:79,y:1195},{page:25,text:'Tctals',x:78,y:1335},{page:25,text:'3.40',x:586,y:1338}
  ];
  const row25=P.parseReceiptBatch('', 'fuel.pdf',page25)[0];
  assert.deepEqual([row25.total,row25.fuelAmount,row25.drawingsAmount,row25.status],[33.41,30.01,3.4,'ACCEPTED']);
  const taxiMfg=P.parseReceiptBatch('', 'fuel.pdf',[
    {page:26,text:'MFG Woodston Service Station',x:168,y:145},{page:26,text:'Fri 23 Jan 2026',x:196,y:390},
    {page:26,text:'TAXI DRIVER',x:80,y:650},{page:26,text:'Unleaded',x:80,y:704},{page:26,text:'Total',x:80,y:809},{page:26,text:'33.41',x:560,y:812},
    {page:26,text:'Motor Fuel Ltd',x:80,y:985},{page:26,text:'Totals',x:80,y:1123},{page:26,text:'30.01',x:573,y:1126},
    {page:26,text:'Sagaa Retail Ltd',x:79,y:1195},{page:26,text:'Totals',x:78,y:1335},{page:26,text:'3.40',x:586,y:1338}
  ])[0];
  assert.deepEqual([taxiMfg.total,taxiMfg.fuelAmount,taxiMfg.drawingsAmount,taxiMfg.status],[33.41,33.41,'','ACCEPTED']);
});
test('MFG OCR cannot mistake VAT-summary net totals for the receipt total and preserves split gross values',()=>{
  const page16=[
    {page:16,text:'MFG Woodston Service Station',x:166,y:148},{page:16,text:'Thu 12 Feb 2026',x:194,y:392},
    {page:16,text:'SALE',x:335,y:605},{page:16,text:'Un I eaded',x:80,y:674},{page:16,text:'Pump5: 23. IL .299/L',x:136,y:710},
    {page:16,text:'Tota 1',x:80,y:779},{page:16,text:'E30,Ol',x:560,y:780},{page:16,text:'MAST ERCARD',x:80,y:850},
    {page:16,text:'Motor Fuel Ltd',x:80,y:954},{page:16,text:'Ex. VAT',x:250,y:1024},{page:16,text:'25.01',x:264,y:1058},
    {page:16,text:'VAT',x:419,y:1024},{page:16,text:'5„oo',x:405,y:1058},{page:16,text:'lnc,VAT',x:548,y:1024},
    {page:16,text:'30.01',x:576,y:1059},{page:16,text:'Tota Is',x:80,y:1094},{page:16,text:'25.01',x:264,y:1094},
    {page:16,text:'5„oo',x:405,y:1094},{page:16,text:'30.01',x:576,y:1094}
  ];
  const row16=P.parseReceiptBatch('', 'Fuel Receipts 1.pdf',page16)[0];
  assert.deepEqual([row16.date,row16.total,row16.fuelAmount,row16.drawingsAmount,row16.status],['2026-02-12',30.01,30.01,'','ACCEPTED']);

  const page25=[
    {page:25,text:'MFG Woodston Service Station',x:168,y:145},{page:25,text:'Fri 16 Jan 2026',x:196,y:390},
    {page:25,text:'Regular Cappuccino + Syrup',x:80,y:668},{page:25,text:'Unleaded',x:80,y:704},
    {page:25,text:'Total',x:80,y:809},{page:25,text:'E33,41',x:560,y:812},{page:25,text:'Total',x:110,y:818},{page:25,text:'E33.41',x:765,y:822},
    {page:25,text:'Motor Fuel Ltd',x:80,y:985},{page:25,text:'Totals',x:80,y:1123},{page:25,text:'25.01',x:262,y:1124},
    {page:25,text:'30.01',x:573,y:1126},{page:25,text:'Sagaa Ret:ail Ltd',x:79,y:1195},
    {page:25,text:'Tctals',x:78,y:1335},{page:25,text:'3.40',x:586,y:1338}
  ];
  const row25=P.parseReceiptBatch('', 'Fuel Receipts 1.pdf',page25)[0];
  assert.deepEqual([row25.total,row25.fuelAmount,row25.drawingsAmount,row25.status],[33.41,30.01,3.4,'ACCEPTED']);

  const page26=[
    {page:26,text:'MFG Woodston Service Station',x:159,y:150},{page:26,text:'Wed 18 Jun 2025',x:187,y:392},
    {page:26,text:'Unleaded',x:76,y:637},{page:26,text:'Cadbury Double Decker',x:76,y:707},
    {page:26,text:'Total',x:77,y:777},{page:26,text:'E21 , 49',x:555,y:777},{page:26,text:'Total',x:104,y:794},{page:26,text:'E21 .49',x:754,y:794},
    {page:26,text:'Motor Fuel I',x:76,y:952},{page:26,text:'VAT Rate',x:76,y:1022},{page:26,text:'Inc. VAT',x:543,y:1022},
    {page:26,text:'20.00',x:570,y:1056},{page:26,text:'Totals',x:75,y:1090},{page:26,text:'20 coo',x:570,y:1091},
    {page:26,text:'Sagaa Retail Ltd',x:75,y:1160},{page:26,text:'Totals',x:75,y:1298},{page:26,text:'I .49',x:586,y:1300}
  ];
  const row26=P.parseReceiptBatch('', 'Fuel Receipts Nadeel Nazam.pdf',page26)[0];
  assert.deepEqual([row26.date,row26.total,row26.fuelAmount,row26.drawingsAmount,row26.status],['2025-06-18',21.49,20,1.49,'ACCEPTED']);
});
test('fuel receipt rows sort by selected PDF order and then page number',()=>{
  const rows=P.sortReceiptRowsByPdfPage([
    {source:'second.pdf',sourcePath:'C:/second.pdf',page:4},
    {source:'first.pdf',sourcePath:'C:/first.pdf',page:3},
    {source:'first.pdf',sourcePath:'C:/first.pdf',page:1},
    {source:'second.pdf',sourcePath:'C:/second.pdf',page:1}
  ],[{source:'second.pdf',sourcePath:'C:/second.pdf'},{source:'first.pdf',sourcePath:'C:/first.pdf'}]);
  assert.deepEqual(rows.map(row=>[row.source,row.page]),[['second.pdf',1],['second.pdf',4],['first.pdf',1],['first.pdf',3]]);
});
test('TAXI DRIVER purchases are treated as fuel and unreadable nonblank pages are not silently omitted',()=>{
  const taxi=P.parseReceiptBatch('', 'shell.pdf',[
    {page:1,text:'Shell Huntingdon Road',x:80,y:230},{page:1,text:'UNLEADED',x:80,y:405},{page:1,text:'TAXI DRIVER',x:80,y:600},
    {page:1,text:'Total',x:30,y:661},{page:1,text:'£33.02',x:462,y:661},{page:1,text:'Date/Time 31/01/2026 11:20',x:34,y:1095}
  ])[0];
  assert.deepEqual([taxi.total,taxi.fuelAmount,taxi.drawingsAmount,taxi.status],[33.02,33.02,'','ACCEPTED']);
  const audit=P.parseReceiptBatch('', 'scanned.pdf',[
    {page:1,text:'Little Hampton London Road Yaxley VAT: 663 139 630',x:80,y:230},
    {page:1,text:'UNLEADED Pump',x:80,y:405},{page:1,text:'Total:',x:30,y:507},{page:1,text:'£30.00',x:462,y:508},{page:1,text:'Date/Time 15.06.2025 22:32',x:34,y:1095},
    {page:2,text:'Thank you for using Pay at Pump. Tesco Stores Ltd.',x:80,y:200}
  ],{auditUnmatchedPages:true,pageCount:4,visualPages:[1,2,3,4]});
  assert.deepEqual(audit.map(row=>row.page),[1,3,4]);
  assert.deepEqual([audit[1].status,audit[1].date,audit[1].total,audit[1].auditPlaceholder],['REJECTED','','',true]);
  assert.equal(P.isReceiptBackPage([{text:'Thank you for using Pay at Pump.'}]),true);
});
test('fuel purchases split non-fuel items to drawings, but TAXI DRIVER transactions stay all fuel',()=>{
  const tesco=P.parseReceiptBatch('', 'renamed-tesco.pdf',[
    {page:1,text:'TESCO EXPRESS ESSO',x:100,y:100},{page:1,text:'PUMP #3 UNLEADED',x:60,y:300},{page:1,text:'22.32 litre @134.9 P/L',x:100,y:330},{page:1,text:'£30.11',x:560,y:330},
    {page:1,text:'RED BULL',x:100,y:370},{page:1,text:'£1.95',x:560,y:370},{page:1,text:'TOTAL',x:55,y:430},{page:1,text:'£32.06',x:560,y:430},
    {page:1,text:'MASTERCARD SALE',x:100,y:460},{page:1,text:'£32.06',x:560,y:460},{page:1,text:'07/03/26 20:05',x:90,y:900}
  ])[0];
  assert.deepEqual([tesco.total,tesco.fuelAmount,tesco.drawingsAmount,tesco.status],[32.06,30.11,1.95,'ACCEPTED']);
  const shell=P.parseReceiptBatch('', 'renamed-shell.pdf',[
    {page:1,text:'Shell Stanground',x:60,y:100},{page:1,text:'UNLEADED',x:60,y:300},{page:1,text:'£30.00',x:560,y:300},
    {page:1,text:'CADBURY DECK',x:70,y:350},{page:1,text:'£1.40',x:560,y:350},{page:1,text:'Discount -£0.40',x:70,y:390},{page:1,text:'TOTAL',x:60,y:440},{page:1,text:'£31.00',x:560,y:440},
    {page:1,text:'SALE AMOUNT',x:60,y:480},{page:1,text:'£31.00',x:560,y:480},{page:1,text:'Date/Time 11-09-2025 19:54',x:60,y:800}
  ])[0];
  assert.deepEqual([shell.total,shell.fuelAmount,shell.drawingsAmount,shell.status],[31,30,1,'ACCEPTED']);
  const totalOnlyRetry=P.parseReceiptBatch('', 'tesco.pdf',[
    {page:1,text:'TESCO Petrol Filling Station',x:100,y:100},{page:1,text:'PUMP UNLEADED',x:60,y:300},{page:1,text:'£30.01',x:560,y:330},{page:1,text:'FRUIT SWEETS',x:90,y:390},{page:1,text:'£1.50',x:560,y:390},
    {page:1,text:'TOTAL',x:60,y:440},{page:1,text:'£30.01',x:560,y:440},{page:1,text:'MASTERCARD SALE',x:90,y:470},{page:1,text:'£30.01',x:560,y:470},{page:1,text:'20/02/26 20:44',x:90,y:900}
  ])[0];
  assert.deepEqual([totalOnlyRetry.total,totalOnlyRetry.status,totalOnlyRetry.rejectedReason],[30.01,'REJECTED','Fuel and other purchase amounts could not be separated confidently.']);
  const taxi=P.parseReceiptBatch('', 'shell.pdf',[
    {page:1,text:'Shell Stanground',x:60,y:100},{page:1,text:'UNLEADED',x:60,y:300},{page:1,text:'£30.00',x:560,y:300},{page:1,text:'TAXI DRIVER',x:80,y:350},
    {page:1,text:'CADBURY DECK £1.40',x:80,y:390},{page:1,text:'TOTAL',x:60,y:440},{page:1,text:'£31.40',x:560,y:440},{page:1,text:'Date/Time 11-09-2025',x:60,y:800}
  ])[0];
  assert.deepEqual([taxi.total,taxi.fuelAmount,taxi.drawingsAmount,taxi.status],[31.4,31.4,'','ACCEPTED']);
});
test('faded receipt totals, fuel lines, and split OCR date fragments stay tied to printed rows',()=>{
  const tescoFaded=P.parseReceiptBatch('', 'tesco.pdf',[
    {page:1,text:'TESCO Express Esso',x:200,y:100},{page:1,text:'PUMP 1 IJNI EADED',x:68,y:539},{page:1,text:'cgo.01 c',x:558,y:538},
    {page:1,text:'TO r Al',x:54,y:664},{page:1,text:'eao 01',x:483,y:664},{page:1,text:'MASTERCARD SALE',x:98,y:695},{page:1,text:'12/07/25 17:15',x:100,y:1200}
  ])[0];
  assert.deepEqual([tescoFaded.total,tescoFaded.fuelAmount,tescoFaded.drawingsAmount,tescoFaded.status],[30.01,30.01,'','ACCEPTED']);
  const faintTotal=P.parseReceiptBatch('', 'tesco.pdf',[
    {page:1,text:'TESCO Express Esso',x:200,y:100},{page:1,text:'PUMP UNLEADED',x:198,y:549},{page:1,text:'AL',x:138,y:675},{page:1,text:'ALF',x:274,y:705},{page:1,text:'T o day',x:518,y:1171},{page:1,text:'eao - 01',x:645,y:686}
  ])[0];
  assert.deepEqual([faintTotal.total,faintTotal.fuelAmount,faintTotal.status],[30.01,30.01,'REJECTED']);
  const shellFaintAmount=P.parseReceiptBatch('', 'shell.pdf',[
    {page:1,text:'Shell GO+',x:120,y:1213},{page:1,text:'-l ot:a.1 :',x:65,y:611},{page:1,text:'. 02',x:758,y:632},{page:1,text:'@ 1.319/1',x:318,y:516},{page:1,text:'no .02',x:744,y:530},
    {page:1,text:'AMOUNT',x:177,y:1952},{page:1,text:'30 .c.',x:467,y:1955}
  ])[0];
  assert.deepEqual([shellFaintAmount.total,shellFaintAmount.fuelAmount,shellFaintAmount.status],[30.02,30.02,'REJECTED']);
  const splitDate=P.parseReceiptBatch('', 'bp.pdf',[
    {page:1,text:'Little Hampton London Road Yaxley VAT: 663 139 630',x:80,y:230},{page:1,text:'UNLEADED',x:140,y:404},
    {page:1,text:'Total',x:32,y:508},{page:1,text:'30.03',x:767,y:542},{page:1,text:'03.',x:400,y:1115},{page:1,text:'0b 2025 20,',x:463,y:1115}
  ])[0];
  assert.deepEqual([splitDate.date,splitDate.total,splitDate.status],['2025-05-03',30.03,'ACCEPTED']);
});
test('Fuel receipts sample keeps every scanned page auditable and reads the MFG split totals on OCR retry',{skip:process.env.CLEARCOUNT_RUN_FUEL_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Fuel/Fuel Receipts 1.pdf'))},()=>{
  const pdfPath=path.resolve(__dirname,'../samples/extractor/Fuel/Fuel Receipts 1.pdf'),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  const scan=(scale,pages=[])=>{
    const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',pdfPath,'-Scale',String(scale)];if(pages.length)args.push('-PageList',pages.join(','));
    const raw=execFileSync('powershell.exe',args,{encoding:'utf8',windowsHide:true,maxBuffer:60*1024*1024}),pageRecords=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),summaryLine=raw.split(/\r?\n/).filter(line=>line.trim().startsWith('{')).at(-1),summary=JSON.parse(summaryLine);
    return {pageRecords,summary,lines:pageRecords.flatMap(page=>page.lines||[])};
  };
  const first=scan(2.5),rows=P.parseReceiptBatch(first.summary.text,pdfPath,first.lines,{auditUnmatchedPages:true,pageCount:first.summary.pages,visualPages:first.summary.visualPages||[]});
  const page24=rows.find(row=>row.page===24),page25=rows.find(row=>row.page===25),taxi=rows.find(row=>row.page===17);
  assert.ok(page24,'MFG page 24 should be represented before retry');
  assert.deepEqual([page25.date,page25.total,page25.fuelAmount,page25.drawingsAmount,page25.status],['2026-01-16',33.41,30.01,3.4,'ACCEPTED']);
  assert.deepEqual([taxi.total,taxi.fuelAmount,taxi.drawingsAmount,taxi.status],[33.02,33.02,'','ACCEPTED']);
  assert.equal(new Set(rows.map(row=>row.page)).size,rows.length,'each receipt or unreadable page should appear once');
  for(const page of first.summary.visualPages||[]){
    if(rows.some(row=>row.page===page))continue;
    const pageLines=first.pageRecords.find(item=>item.page===page)?.lines||[];
    assert.ok(P.isReceiptBackPage(pageLines),`visibly nonblank page ${page} must have a row unless it is a confirmed receipt back`);
  }
  for(const row of rows.filter(item=>item.auditPlaceholder))assert.deepEqual([row.status,row.date,row.total],['REJECTED','','']);
  const retry=scan(5,[24]),retried=P.parseReceiptBatch(retry.summary.text,pdfPath,retry.lines).find(row=>row.page===24);
  assert.deepEqual([retried.date,retried.total,retried.fuelAmount,retried.drawingsAmount,retried.status],['2026-01-09',31.26,30.01,1.25,'ACCEPTED']);
});
test('invoice export rate bases split printed total and VAT without deriving or changing either figure',()=>{
  assert.deepEqual(P.invoiceRateBases(120,20),{standardRate:100,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(130,20),{standardRate:100,zeroRate:10});
  assert.deepEqual(P.invoiceRateBases(100,0),{standardRate:'',zeroRate:100});
  assert.deepEqual(P.invoiceRateBases(106.03,17.67),{standardRate:88.36,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(69.58,11.60),{standardRate:57.98,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(276.28,46.05),{standardRate:230.23,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(69.62,11.60),{standardRate:58.02,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(69.57,11.60),{standardRate:57.97,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(-120,-20,'CREDIT NOTE'),{standardRate:-100,zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(-130,-18,'CREDIT NOTE'),{standardRate:-90,zeroRate:-22});
  assert.deepEqual(P.invoiceRateBases(500,'UNREADABLE'),{standardRate:'',zeroRate:''});
  assert.deepEqual(P.invoiceRateBases(500,0,'DELIVERY NOTE'),{standardRate:'',zeroRate:500});
});
test('VT UIS export uses one PIN header row and split analysis-only continuation rows',()=>{
  const records=[{invoiceNumber:'4286',date:'2026-10-01',supplier:'Fuel Ltd',total:120,vat:10,status:'ACCEPTED',documentType:'INVOICE',source:'statement.pdf',page:4}];
  const data=VT.makeVtUisRows(records);assert.deepEqual(data[0],VT.headers);assert.equal(data.length,3);
  assert.deepEqual(data[0],['Type','Ref no','Date','Primary account','Details','Total','VAT','Analysis','Analysis account','Entry details']);
  assert.deepEqual(data[1],['PIN','','2026-10-01','Fuel Ltd','Invoice 4286',120,10,50,'Cost of Sales: Standard Rated Purchases','Invoice 4286 | Standard rate']);
  assert.deepEqual(data[2],['','','','','','','',60,'Cost of Sales: Zero Rated Purchases','Invoice 4286 | Zero rate']);
  assert.equal(data[2].slice(0,7).every(value=>value===''),true);assert.equal(data.flat().includes('N/A'),false);
  const workbook=XLSX.utils.book_new(),sheet=VT.hideReferenceColumn(XLSX.utils.aoa_to_sheet(data));
  XLSX.utils.book_append_sheet(workbook,sheet,'VT UIS');
  const saved=XLSX.read(XLSX.write(workbook,{bookType:'xlsx',type:'buffer'}),{cellStyles:true});
  assert.equal(saved.Sheets['VT UIS']['!cols'][1].hidden,true);
});
test('VT-ready export uses the requested supplier names on every output tab',()=>{
  const records=[
    {invoiceNumber:'1001',date:'2026-10-01',supplier:'MASPO',total:120,vat:20,status:'ACCEPTED',documentType:'INVOICE'},
    {invoiceNumber:'1002',date:'2026-10-02',supplier:'Polish Village Bread LTD',total:100,vat:0,status:'ACCEPTED',documentType:'INVOICE'},
    {invoiceNumber:'1003',date:'2026-10-03',supplier:'Maspo Food Ltd',total:'',vat:0,status:'REJECTED',documentType:'INVOICE'}
  ];
  assert.deepEqual(records.slice(0,2).map(row=>VT.supplierName(row.supplier)),['Maspo Food Ltd','Polish Village Bread']);
  assert.deepEqual(VT.makeVtUisRows(records).slice(1).map(row=>row[3]),['Maspo Food Ltd','Polish Village Bread']);
  assert.equal(VT.makeVtExcludedRows(records)[1][2],'Maspo Food Ltd');
  assert.equal(VT.headers.includes('Transaction notes'),false);
});
test('VT batch contains every accepted record and holds back unverified and review rows',()=>{
  const rows=[
    {invoiceNumber:'1111',date:'2026-10-01',supplier:'A',total:120,vat:20,status:'ACCEPTED',documentType:'INVOICE'},
    {invoiceNumber:'2222',date:'2026-10-02',supplier:'A',total:100,vat:0,status:'ACCEPTED',documentType:'DELIVERY NOTE'},
    {invoiceNumber:'3333',date:'2026-10-03',supplier:'A',total:100,vat:0,status:'ACCEPTED',documentType:'INVOICE (CORRECTED)'},
    {invoiceNumber:'4444',date:'2026-10-04',supplier:'A',total:100,vat:0,status:'REJECTED',documentType:'INVOICE',vatUnverified:true},
    {invoiceNumber:'5555',date:'2026-10-05',supplier:'A',total:-10,vat:0,status:'REJECTED',documentType:'CREDIT NOTE'}
  ];
  const data=VT.makeVtUisRows(rows);assert.equal(data.filter(row=>row[0]==='PIN').length,3);const excluded=VT.makeVtExcludedRows(rows);assert.equal(excluded.length,3);assert.equal(excluded[1][7].includes('placeholder'),true);assert.equal(VT.exportVat({vat:'N/A'}),0);assert.equal(VT.exportVat({vat:18.25}),18.25);
});
test('VT analysis accounts follow each rate and supplier export order is alphabetical, including credits',()=>{
  const records=[
    {invoiceNumber:'9001',date:'2026-10-03',supplier:'Zulu Trading',total:-120,vat:-20,status:'ACCEPTED',documentType:'CREDIT NOTE'},
    {invoiceNumber:'1001',date:'2026-10-01',supplier:'Alpha Supply',total:100,vat:0,status:'ACCEPTED',documentType:'INVOICE'},
    {invoiceNumber:'2001',date:'2026-10-02',supplier:'Bravo Foods',total:130,vat:20,status:'ACCEPTED',documentType:'INVOICE'}
  ];
  assert.deepEqual(VT.sortBySupplier(records).map(row=>row.supplier),['Alpha Supply','Bravo Foods','Zulu Trading']);
  const data=VT.makeVtUisRows(records);
  assert.deepEqual(data.slice(1).map(row=>[row[0],row[3],row[8]]),[
    ['PIN','Alpha Supply','Cost of Sales: Zero Rated Purchases'],
    ['PIN','Bravo Foods','Cost of Sales: Standard Rated Purchases'],
    ['','','Cost of Sales: Zero Rated Purchases'],
    ['PCR','Zulu Trading','Cost of Sales: Standard Rated Purchases']
  ]);
});
test('VT import reads an Extractor invoice worksheet and flags placeholder VAT until the user edits it',()=>{
  const records=VTImport.recordsFromMatrix([
    ['Invoice number','Invoice date','Supplier','VAT','Total','Status','Rejection reason','Document type'],
    ['1001',46274,'Fuel Ltd',20,120,'ACCEPTED','','INVOICE'],
    ['1002','11/11/2026','Garage Ltd',0,80,'REJECTED','VAT is an unconfirmed 0.00 placeholder','INVOICE'],
    ['1003','2026-11-12','Fuel Ltd',-2,-12,'REVIEW','Credit note to review','CREDIT NOTE']
  ]);
  assert.equal(records.length,3);assert.equal(records[0].date,'2026-09-09');assert.equal(records[0].status,'ACCEPTED');
  assert.equal(records[1].vatUnverified,true);assert.equal(records[1].vat,0);assert.equal(records[2].status,'REJECTED');assert.equal(records[2].total,-12);
  records[1].vat=0;records[1].vatUnverified=false;records[1].status='ACCEPTED';
  const uis=VT.makeVtUisRows(records);assert.equal(uis.filter(row=>row[0]==='PIN').length,2);assert.equal(uis.filter(row=>row[0]==='PCR').length,0);
  records[2].status='ACCEPTED';const withCredit=VT.makeVtUisRows(records),credit=withCredit.find(row=>row[0]==='PCR');
  assert.deepEqual(credit.slice(0,8),['PCR','','2026-11-12','Fuel Ltd','Credit note 1003',12,2,10]);
});
test('VT import reads fuel receipt reports and creates separate fuel and drawings analysis rows',()=>{
  const records=VTImport.recordsFromMatrix([
    ['Date','Total','Expenses: Fuel','Capital Account: Drawings','Company','Category','Status','Source PDF','PDF / page'],
    ['11/11/2026',31.26,30.01,1.25,'MFG','Fuel receipts','ACCEPTED','receipts.pdf','Open PDF - page 24']
  ]);
  assert.deepEqual([records[0].date,records[0].supplier,records[0].vat,records[0].total,records[0].fuelAmount,records[0].drawingsAmount,records[0].isFuelReceipt,records[0].documentType,records[0].page],['2026-11-11','MFG',0,31.26,30.01,1.25,true,'FUEL RECEIPT','Open PDF - page 24']);
  const rows=VT.makeVtUisRows(records);
  assert.deepEqual(rows.slice(1),[
    ['PIN','','2026-11-11','MFG','Fuel receipt page 24',31.26,0,30.01,'Expenses: Fuel','Fuel receipt page 24 | Fuel'],
    ['','','','','','','',1.25,'Capital Account: Drawings','Fuel receipt page 24 | Drawings']
  ]);
});
test('VT receipt import puts an unsplit total to fuel and rejects mismatched analysis values',()=>{
  const [single]=VTImport.recordsFromMatrix([['Date','Total','Company','Category','Status'],['2026-11-11',47.8,'Shell','Fuel receipts','ACCEPTED']]);
  assert.deepEqual([single.documentType,single.fuelAmount,single.drawingsAmount,single.vat],['FUEL RECEIPT',47.8,null,0]);
  assert.equal(VT.makeVtUisRows([single]).length,2);
  const mismatch={...single,total:48,fuelAmount:46,drawingsAmount:1.25};
  assert.equal(VT.usable(mismatch),false);assert.match(VT.makeVtExcludedRows([mismatch])[1][7],/do not add up/);assert.equal(VT.makeVtUisRows([mismatch]).length,1);
});
test('VT mixed reviewed workbook distinguishes invoices from receipt rows',()=>{
  const records=VTImport.recordsFromMatrix([
    ['Invoice number','Invoice date','Supplier','VAT','Total','Expenses: Fuel','Capital Account: Drawings','Status','Document type'],
    ['1001','2026-11-11','Garage Ltd',20,120,'','', 'ACCEPTED','INVOICE'],
    ['', '2026-11-12','BP',0,31.26,30.01,1.25,'ACCEPTED','FUEL RECEIPT']
  ]);
  assert.deepEqual(records.map(row=>row.isFuelReceipt),[false,true]);
  assert.deepEqual(VT.makeVtUisRows(records).slice(1).map(row=>row[0]),['PIN','','PIN']);
});
test('VT import refuses workbooks that do not have invoice number and total headers',()=>{
  assert.throws(()=>VTImport.recordsFromMatrix([['Date','Supplier','Amount'],['2026-10-01','Fuel',12]]),/Invoice number and Total columns/);
});
test('VT import parses common Excel and UK date and amount representations',()=>{
  assert.equal(VTImport.date('11/11/2026'),'2026-11-11');assert.equal(VTImport.date(46337),'2026-11-11');assert.equal(VTImport.date('31/02/2026'),'');
  assert.equal(VTImport.money('1,234.56'),1234.56);assert.equal(VTImport.money('1.234,56'),1234.56);assert.equal(VTImport.money('20,50'),20.5);assert.equal(VTImport.money('(20.50)'),-20.5);
});
test('VT import reads actual Excel date cells and numeric invoice values',()=>{
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Invoice number','Invoice date','Supplier','VAT','Total','Status'],['2468',46274,'Garage Ltd',0,84.5,'ACCEPTED']]);
  sheet.B2.z='dd/mm/yyyy';XLSX.utils.book_append_sheet(workbook,sheet,'Invoices');
  const reopened=XLSX.read(XLSX.write(workbook,{bookType:'xlsx',type:'buffer'})),matrix=XLSX.utils.sheet_to_json(reopened.Sheets.Invoices,{header:1,raw:true,defval:''}),[row]=VTImport.recordsFromMatrix(matrix);
  assert.deepEqual([row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.status],['2468','2026-09-09','Garage Ltd',0,84.5,'ACCEPTED']);
});
test('VT paste rows survive an Excel workbook round trip with rate splits and reviewed PCR credits',()=>{
  const records=[
    {invoiceNumber:'1001',date:'2026-10-01',supplier:'Fuel Ltd',vat:10,total:120,status:'ACCEPTED',documentType:'INVOICE'},
    {invoiceNumber:'1002',date:'2026-10-02',supplier:'Fuel Ltd',vat:-2,total:-12,status:'ACCEPTED',documentType:'CREDIT NOTE'}
  ],book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(VT.makeVtUisRows(records));
  XLSX.utils.book_append_sheet(book,sheet,'VT UIS');
  const saved=XLSX.read(XLSX.write(book,{bookType:'xlsx',type:'buffer'})),rows=XLSX.utils.sheet_to_json(saved.Sheets['VT UIS'],{header:1,raw:true,defval:''});
  assert.deepEqual(rows[0],VT.headers);assert.deepEqual(rows.slice(1).map(row=>[row[0],row[4],row[5],row[6],row[7]]),[
    ['PIN','Invoice 1001',120,10,50],['','','','',60],['PCR','Credit note 1002',12,2,10]
  ]);
});
test('Monolith profile reads the last-page invoice total and VAT, not the outstanding account amount',()=>{
  const page=(number,invoiceNumber,pageNumber,pageCount,{date='28-07-2026',due='1,292.72',vat,total}={})=>[
    {page:number,text:'MONOLITH (UK) LTD',x:70,y:70},{page:number,text:`Total amount due: ${due} GBR`,x:1220,y:520},
    {page:number,text:`AUTO INVOICE - A ${invoiceNumber}`,x:1200,y:590},{page:number,text:`Page ${pageNumber} of ${pageCount} - Original`,x:1380,y:680},
    {page:number,text:'Date',x:670,y:778},{page:number,text:date,x:610,y:814},
    ...(vat===undefined?[]:[{page:number,text:'TOTAL VAT',x:950,y:2447},{page:number,text:vat,x:1710,y:2450}]),
    ...(total===undefined?[]:[{page:number,text:'Total',x:1020,y:2560},{page:number,text:total,x:1588,y:2564}])
  ];
  const lines=[...page(1,'310642',1,2),...page(2,'310642',2,2,{vat:'22.53 GBR',total:'1,255.39 GBR'}),
    {page:3,text:'MONOLITH (UK) LTD',x:70,y:70},{page:3,text:'Total amount due: 37.33 GBR',x:1220,y:520},
    {page:3,text:'AUTO INVOICE - A 310641',x:1200,y:590},{page:3,text:'Page 1 of 1 - Original',x:1380,y:680},
    {page:3,text:'Date',x:670,y:778},{page:3,text:'28-07-2026',x:610,y:814},{page:3,text:'TOTAL VAT',x:950,y:2447},{page:3,text:'moo GBR',x:1710,y:2450},{page:3,text:'CONTINUING... Total',x:943,y:2547},{page:3,text:'37.33 GBR',x:1645,y:2550},
    {page:4,text:'MONOLITH (UK) LTD',x:70,y:70},{page:4,text:'Delivery Note AUTO INVOICE - A 310642',x:1200,y:590}];
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'), 'Monolith.pdf', lines);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>[row.originalInvoiceNumber,row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.profileId,row.status]),[
    ['310642','0642','2026-07-28','Monolith',22.53,1255.39,'monolith','ACCEPTED'],
    ['310641','0641','2026-07-28','Monolith',0,37.33,'monolith','ACCEPTED']
  ]);
  const shifted=page(5,'325001',1,1,{date:'16-09-2026',vat:'12.34 GBR',total:'678.90 GBR'}).map(line=>({...line,x:line.x+350,y:line.y+1450})),[shiftedRow]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'Monolith.pdf',shifted);
  assert.deepEqual([shiftedRow.invoiceNumber,shiftedRow.date,shiftedRow.vat,shiftedRow.total,shiftedRow.status],['5001','2026-09-16',12.34,678.90,'ACCEPTED']);
});
test('Monolith scanned sample PDFs yield one accurate row per invoice', {skip:process.env.CLEARCOUNT_RUN_MONOLITH_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Monolith.pdf'))||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Monolith 1.pdf'))},()=>{
  const helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1'),fixtures={
    'Monolith.pdf':[
      ['310642','2026-07-28',22.53,1255.39],['310641','2026-07-28',0,37.33],['309202','2026-07-21',45.92,918.36],
      ['307621','2026-07-14',0,1435.52],['307620','2026-07-14',0,90.79],['315030','2026-08-18',134.51,1562.03],
      ['315029','2026-08-18',3.02,18.14],['315028','2026-08-18',29.77,251.54],['312029','2026-08-04',21.86,1185.54]
    ],
    'Monolith 1.pdf':[
      ['312028','2026-08-04',0,24.67],['322087','2026-09-22',0,545.34],['319280','2026-09-08',19.01,1584.16],
      ['319279','2026-09-08',0,101.40],['320688','2026-09-15',44.99,1022.25],['320687','2026-09-15',0,48.27],
      ['323577','2026-09-29',18.34,970.89],['323576','2026-09-29',0,75.85]
    ]
  };
  for(const [name,expected] of Object.entries(fixtures)){
    const pdfPath=path.resolve(__dirname,'../samples/extractor/Invoices',name),raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',pdfPath,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:40*1024*1024}),pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),records=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),pdfPath,lines);
    assert.deepEqual(records.map(row=>[row.originalInvoiceNumber,row.date,row.vat,row.total,row.supplier,row.profileId,row.status]),expected.map(([number,date,vat,total])=>[number,date,vat,total,'Monolith','monolith','ACCEPTED']),name);
    assert.equal(new Set(records.map(row=>row.originalInvoiceNumber)).size,records.length,`${name} must not duplicate invoice numbers`);
  }
});
test('Marion Trading groups repeated invoice pages, ignores statement summaries, and keeps only the printed footer VAT and total',()=>{
  const fixtures=[
    ['10445946','26/07/2026',0,2460.21,91.69,2,3],['10445911','26/07/2026',113.24,3394.73,139.44,6,14],
    ['10442568','12/07/2026',0,569.36,0,16,16],['10442507','12/07/2026',90.11,1175.51,0,17,20],
    ['10452415','23/08/2026',0,1302.85,0,22,24],['10452360','23/08/2026',5.94,1096.96,0,25,27],
    ['10449210','09/08/2026',201.68,2087.46,0,29,32],['10449251','09/08/2026',0,891.01,0,33,34],
    ['10459509','20/09/2026',0,1974.15,0,36,38],['10459440','20/09/2026',0,138.52,0,39,39],
    ['10455898','06/09/2026',229.79,4153.28,141.86,41,50],['10455944','06/09/2026',0,2130.14,58.02,51,53]
  ];
  const lines=[{page:1,text:'TOTAL DELTA-ARA PL LTD INVOICE 1: INVOICE 2: TOTAL Sold Balance 3394.73 2460.21 5854.94 1744.87 7599.81',x:400,y:100}];
  const invoicePage=(page,number,date,vat,total,discount)=>[
    {page,text:'MARION TRADING LTD.',x:70,y:50},{page,text:'INVOICE',x:930,y:80},
    {page,text:'Invoice No',x:1450,y:295},{page,text:number,x:1714,y:296},
    {page,text:'Date',x:1454,y:335},{page,text:date,x:1695,y:340},
    {page,text:'VAT Total',x:1436,y:2351},{page,text:String(vat),x:1718,y:2350},
    {page,text:'Discount Total',x:1437,y:2402},{page,text:String(discount),x:1719,y:2399},
    {page,text:'Total',x:1434,y:2446},{page,text:String(total),x:1736,y:2447}
  ];
  for(const [number,date,vat,total,discount,first,last] of fixtures){for(const page of new Set([first,Math.min(first+1,last),last]))lines.push(...invoicePage(page,number,date,vat,total,discount));}
  for(const page of [15,21,28,35,40])lines.push({page,text:'TOTAL DELTA-ARA PL LTD INVOICE 1: INVOICE 2: TOTAL Sold Balance 3394.73 2460.21 5854.94 1744.87 7599.81',x:400,y:100});
  const records=P.parseInvoiceBatch(lines.map(line=>line.text).join('\\n'),'Marion Trading.pdf',lines);
  assert.equal(records.length,fixtures.length);
  assert.deepEqual(records.map(row=>[row.originalInvoiceNumber,row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.profileId,row.status]),fixtures.map(([number,date,vat,total])=>[number,number.slice(-4),P.parseDate(date),'Marion Trading',vat,total,'marion-trading','ACCEPTED']));
  assert.deepEqual(records.map(row=>row.page),fixtures.map(item=>item[5]));
  const [number,date,vat,total]=fixtures[0],shifted=invoicePage(1,number,date,vat,total,0).map(line=>({...line,x:line.x-1100,y:line.y+1350}));
  const [shiftedRecord]=P.parseInvoiceBatch(shifted.map(line=>line.text).join('\n'),'Marion Trading.pdf',shifted);
  assert.deepEqual([shiftedRecord.invoiceNumber,shiftedRecord.date,shiftedRecord.vat,shiftedRecord.total,shiftedRecord.status], [number.slice(-4),P.parseDate(date),vat,total,'ACCEPTED']);
});
test('Marion Trading does not treat an unreadable VAT footer as zero',()=>{
  const lines=[
    {page:1,text:'MARION TRADING LTD.',x:70,y:50},{page:1,text:'Invoice No',x:1450,y:295},{page:1,text:'10442568',x:1714,y:296},
    {page:1,text:'Date',x:1454,y:335},{page:1,text:'12/07/2026',x:1695,y:340},
    {page:1,text:'VAT Total',x:1436,y:2351},{page:1,text:'Total',x:1434,y:2446},{page:1,text:'569.36',x:1736,y:2447}
  ];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\\n'),'Marion Trading.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.vat,row.total,row.retryOcr,row.status],['2568','',569.36,true,'REJECTED']);
});
test('Marion Trading accepts a blank VAT footer as zero only when every item VAT rate is visibly zero',()=>{
  const make=rate=>[
    {page:1,text:'MARION TRADING LTD.',x:70,y:50},{page:1,text:'Invoice No',x:1450,y:295},{page:1,text:'10442568',x:1714,y:296},
    {page:1,text:'Date',x:1454,y:335},{page:1,text:'12/07/2026',x:1695,y:340},
    {page:1,text:'Product Qty',x:60,y:550},{page:1,text:'Code',x:66,y:590},{page:1,text:'VAT',x:1652,y:576},
    {page:1,text:'10001',x:80,y:650},{page:1,text:rate,x:1700,y:650},{page:1,text:'10002',x:80,y:700},{page:1,text:rate,x:1700,y:700},
    {page:1,text:'VAT Total',x:1436,y:2351},{page:1,text:'Total',x:1434,y:2446},{page:1,text:'569.36',x:1736,y:2447}
  ];
  const parse=rate=>P.parseInvoiceBatch(make(rate).map(line=>line.text).join('\\n'),'Marion Trading.pdf',make(rate))[0];
  const zero=parse('0.0'),taxable=parse('20.0');
  assert.deepEqual([zero.vat,zero.total,zero.retryOcr,zero.status],[0,569.36,false,'ACCEPTED']);
  assert.deepEqual([taxable.vat,taxable.retryOcr,taxable.status],['',true,'REJECTED']);
});
test('Marion Trading account-summary pages produce no invoice rows',()=>{
  const summary='TOTAL DELTA-ARA PL LTD INVOICE 1: INVOICE 2: INVOICE 3: INVOICE 4: TOTAL Sold Balance 3394.73 2460.21 5854.94 1744.87 7599.81';
  assert.deepEqual(P.parseInvoiceBatch(summary,'Marion Trading.pdf',[{page:1,text:summary,x:200,y:100}]),[]);
});
test('Marion Trading scanned sample matches the printed invoice values', {skip:process.env.CLEARCOUNT_RUN_MARION_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Marion Trading.pdf'))},()=>{
  const pdfPath=path.resolve(__dirname,'../samples/extractor/Invoices/Marion Trading.pdf'),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',pdfPath,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  const pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]);
  const records=P.parseInvoiceBatch(lines.map(line=>line.text).filter(Boolean).join('\n'),pdfPath,lines);
  for(const target of records.filter(row=>row.retryOcr)){
    const next=records.filter(row=>row.page>target.page).sort((a,b)=>a.page-b.page)[0],end=next?next.page-1:Math.max(...pages.map(page=>page.page)),retryPages=Array.from({length:end-target.page+1},(_,i)=>target.page+i);
    const retryRaw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',pdfPath,'-Scale','5','-PageList',retryPages.join(',')],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
    const retryPageData=retryRaw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),retryLines=retryPageData.flatMap(page=>page.lines||[]),retryRows=P.parseInvoiceBatch(retryLines.map(line=>line.text).filter(Boolean).join('\n'),pdfPath,retryLines,{ocrScale:5}),verified=retryRows.find(row=>row.originalInvoiceNumber===target.originalInvoiceNumber);
    if(verified)Object.assign(target,verified);
  }
  assert.deepEqual(records.map(row=>[row.originalInvoiceNumber,row.invoiceNumber,row.date,row.supplier,row.vat,row.total,row.status]),[
    ['10445946','5946','2026-07-26','Marion Trading',0,2460.21,'ACCEPTED'],
    ['10445911','5911','2026-07-26','Marion Trading',113.24,3394.73,'ACCEPTED'],
    ['10442568','2568','2026-07-12','Marion Trading',0,569.36,'ACCEPTED'],
    ['10442507','2507','2026-07-12','Marion Trading',90.11,1175.51,'ACCEPTED'],
    ['10452415','2415','2026-08-23','Marion Trading',0,1302.85,'ACCEPTED'],
    ['10452360','2360','2026-08-23','Marion Trading',5.94,1096.96,'ACCEPTED'],
    ['10449210','9210','2026-08-09','Marion Trading',201.68,2087.46,'ACCEPTED'],
    ['10449251','9251','2026-08-09','Marion Trading',0,891.01,'ACCEPTED'],
    ['10459509','9509','2026-09-20','Marion Trading',0,1974.15,'ACCEPTED'],
    ['10459440','9440','2026-09-20','Marion Trading',0,138.52,'ACCEPTED'],
    ['10455898','5898','2026-09-06','Marion Trading',229.79,4153.28,'ACCEPTED'],
    ['10455944','5944','2026-09-06','Marion Trading',0,2130.14,'ACCEPTED']
  ]);
});
test('invoice numbers use the final four digits and generic suppliers stay rejected until profiled',()=>{const invoice=P.parseInvoice('ACME MOTORS LTD Invoice no. 2026/1042 Invoice date 11/11/2026 Subtotal £100.00 VAT £20.00 Total due £120.00');assert.deepEqual([invoice.invoiceNumber,invoice.status,invoice.accepted,invoice.rejected,invoice.supplier,invoice.unconfiguredSupplier],['1042','REJECTED',false,true,'ACME MOTORS LTD',true]);assert.match(invoice.rejectedReason,/supplier profile is not set up/i);const maspo=P.parseInvoice('MASPO LTD Invoice no. 2607-SP/02/04286 Invoice date (taxpoint): 29.07.2026 Total: 296,85 GBP');assert.equal(maspo.invoiceNumber,'4286');const statement=P.parseInvoice('Supplier statement Account statement Invoice No: FS 12345/2026 Date 11/11/2026 Balance due 500.00');assert.equal(statement.status,'REJECTED');assert.equal(statement.total,'');assert.match(statement.rejectedReason,/not appear to be an invoice/i);});
test('unknown supplier invoices are retained as a rejected supplier list',()=>{const lines=[
  {page:1,text:'ACME MOTORS LTD',x:80,y:40},{page:1,text:'Invoice no. 2026/1042',x:80,y:80},{page:1,text:'Invoice date: 11/11/2026',x:80,y:120},{page:1,text:'Subtotal: £100.00',x:80,y:160},{page:1,text:'VAT: £20.00',x:80,y:200},{page:1,text:'Total due: £120.00',x:80,y:240},
  {page:2,text:'ACME MOTORS LTD',x:80,y:40},{page:2,text:'Invoice no. 2026/1043',x:80,y:80},{page:2,text:'Invoice date: 12/11/2026',x:80,y:120},{page:2,text:'Subtotal: £50.00',x:80,y:160},{page:2,text:'VAT: £10.00',x:80,y:200},{page:2,text:'Total due: £60.00',x:80,y:240}
],rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'unknown-supplier.pdf',lines);assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>[row.invoiceNumber,row.supplier,row.total,row.vat,row.status,row.unconfiguredSupplier]),[['1042','ACME MOTORS LTD',120,20,'REJECTED',true],['1043','ACME MOTORS LTD',60,10,'REJECTED',true]]);assert.ok(rows.every(row=>/supplier profile is not set up/i.test(row.rejectedReason)));const app=fs.readFileSync(path.join(__dirname,'../extractor/app.js'),'utf8');assert.match(app,/row\.unconfiguredSupplier/);assert.match(app,/rejected invoice list is below/i);});
test('invoice VAT is mandatory, including zero; missing VAT queues one retry and rejects',()=>{const missing=P.parseInvoice('ACME MOTORS LTD Invoice number: 2026/1042 Invoice date: 11/11/2026 Subtotal: £100.00 Total due: £120.00');assert.equal(missing.vat,'');assert.equal(missing.retryOcr,true);assert.equal(missing.status,'REJECTED');assert.match(missing.rejectedReason,/supplier profile is not set up/i);const zero=P.parseInvoice('ACME MOTORS LTD Invoice number: 2026/1043 Invoice date: 11/11/2026 Subtotal: £100.00 VAT: £0.00 Total due: £100.00');assert.equal(zero.vat,0);assert.equal(zero.retryOcr,false);assert.equal(zero.status,'REJECTED');assert.equal(zero.unconfiguredSupplier,true);});
test('duplicate invoice records collapse by supplier, final four digits and date',()=>{const base={invoiceNumber:'4286',originalInvoiceNumber:'2607-SP/02/04286',supplier:'MASPO LTD',date:'2026-07-29',total:296.85,accepted:true};const result=P.deduplicateInvoiceRows([base,{...base,originalInvoiceNumber:'2607 SP 02 04286',source:'copy.pdf',page:9},{...base,supplier:'Other Supplier'}]);assert.equal(result.duplicates,1);assert.equal(result.rows.length,2);});
test('continuation fragments with an unreadable date merge without importing their stray amounts',()=>{const complete={invoiceNumber:'2677',originalInvoiceNumber:'2608-SP/02/02677',supplier:'MASPO',date:'2026-08-19',vat:294.99,total:4074.52,status:'ACCEPTED',accepted:true,source:'MASPO.pdf',page:20},fragment={...complete,date:'',vat:'UNREADABLE',total:'',status:'REJECTED',accepted:false,page:26};const result=P.deduplicateInvoiceRows([fragment,complete]);assert.equal(result.rows.length,1);assert.equal(result.duplicates,1);assert.deepEqual([result.rows[0].date,result.rows[0].vat,result.rows[0].total,result.rows[0].page],['2026-08-19',294.99,4074.52,20]);const later=P.deduplicateInvoiceRows([complete,{...complete,date:'2027-08-19',page:30}]);assert.equal(later.rows.length,2);});
test('invoice dates reject impossible dates and OCR years far outside the supported range',()=>{assert.equal(P.parseDate('29.07.2026'),'2026-07-29');assert.equal(P.parseDate('31.02.2026'),'');assert.equal(P.parseDate('29.07.2608'),'');});
test('mixed supplier PDFs select the profile separately for each invoice',()=>{const lines=[
  {page:1,text:'Invoice no.',x:710,y:266},{page:1,text:'2607-SP/02/00454',x:978,y:261},{page:1,text:'Seller',x:204,y:423},{page:1,text:'MASPO LTD',x:204,y:468},{page:1,text:'08.07.2026',x:1062,y:1026},{page:1,text:'Invoice date (taxpoint):',x:201,y:1037},{page:1,text:'Total In GBP',x:1364,y:1703},{page:1,text:'555.56',x:1584,y:1702},{page:1,text:'111.11',x:1698,y:1702},{page:1,text:'666.67',x:1808,y:1702},{page:1,text:'Total: 666,67 GBP',x:210,y:1852},
  {page:2,text:'Polish Village Bread LTD',x:100,y:100},{page:2,text:'Delivery date: 2026-08-19',x:100,y:140},{page:2,text:'DELIVERY 665547/MAG/2026',x:700,y:700},{page:2,text:'Total',x:979,y:1000},{page:2,text:'235,60',x:1536,y:1000},{page:2,text:'Issued baskets:',x:1140,y:1100}
];const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'mixed-suppliers.pdf',lines);assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>[row.supplier,row.invoiceNumber,row.total,row.profileId]),[['MASPO','0454',666.67,'maspo'],['Polish Village Bread LTD','5547',235.60,'polish-village-bread']]);});
test('large image streams skip text parsing so OCR can handle image-heavy PDFs',async()=>{const image=Buffer.alloc(200000,'A');const source=Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n2 0 obj\n<< /Subtype /Image /Length '+image.length+' >>\nstream\n','latin1'),image,Buffer.from('\nendstream\nendobj\n','latin1')]);const r=await P.parsePdf(source,'bank','image-heavy.pdf');assert.equal(r.info.hasText,false);assert.equal(r.transactions.length,0);});
test('compressed PDF streams remain readable when binary bytes include high values',async()=>{const text='(01/10/2026) Tj (Shell fuel) Tj (12.34) Tj (100.00) Tj';const compressed=zlib.deflateSync(Buffer.from(text,'latin1'));const source=Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n2 0 obj\n<< /Filter /FlateDecode /Length '+compressed.length+' >>\nstream\n','latin1'),compressed,Buffer.from('\nendstream\nendobj\n','latin1')]);const r=await P.parsePdf(source,'bank','compressed.pdf');assert.equal(r.info.hasText,true);assert.equal(r.transactions[0].details,'Shell fuel');assert.equal(r.transactions[0].receipt,12.34);});
test('OCR bank lines recover Barclays-style month dates and amount columns',()=>{const lines=[
  {page:1,text:'Statement date 28 Aug 2026',x:490,y:43},
  {page:1,text:'03 Aug',x:97,y:721},{page:1,text:'Card Purchase Shell',x:183,y:721},{page:1,text:'42.50',x:474,y:721},
  {page:1,text:'05 Aug',x:97,y:800},{page:1,text:'Received From Driver',x:183,y:800},{page:1,text:'125.00',x:554,y:800}
];const r=P.parseOcrBank(lines,'Statement date 28 Aug 2026','barclays.pdf');assert.equal(r.length,2);assert.deepEqual(r.map(x=>[x.date,x.payment,x.receipt]),[['2026-08-03',42.5,''],['2026-08-05','',125]]);});
test('compatible formats list the supported Monzo, Barclays and Metro Bank statement layouts',()=>{const banks=P.compatibleCompanies.filter(company=>company.category==='Bank statements');assert.deepEqual(banks.map(company=>company.name),['Monzo','Barclays','Metro Bank']);assert.match(banks[0].description,/ISO dates/);assert.match(banks[1].description,/OCR-supported/);assert.match(banks[2].description,/money out, money in and balance columns/);});
test('OCR normalises ten as IO and carries a day-only date across rows',()=>{const lines=[{page:2,text:'Statement date 28 Aug 2026',x:490,y:43},{page:2,text:'IO Aug',x:98,y:143},{page:2,text:'Card Purchase Apple',x:183,y:143},{page:2,text:'2.99',x:481,y:143},{page:2,text:'24',x:98,y:300},{page:2,text:'Received From Driver',x:183,y:300},{page:2,text:'26.27',x:562,y:300}];const r=P.parseOcrBank(lines,'Statement date 28 Aug 2026','barclays.pdf');assert.deepEqual(r.map(x=>[x.date,x.payment,x.receipt]),[['2026-08-10',2.99,''],['2026-08-24','',26.27]]);});
test('ISO date bank statements split rows correctly',async()=>{const r=await P.parsePdf(pdf('(2026-10-11) Tj (Shell fuel) Tj (47.80 DR) Tj (2026-10-12) Tj (Taxi fares) Tj (260.00 CR) Tj'),'bank','monzo.pdf');assert.equal(r.transactions.length,2);assert.equal(r.transactions[0].date,'2026-10-11');assert.equal(r.transactions[1].receipt,260);});
test('Metro Bank column headers parse with clean or legacy pound characters',()=>{for(const prefix of ['', '\u00C2']){const currency=`(${prefix}\u00A3)`,items=[{text:'10 Aug 2026',x:50,y:700},{text:'Direct Debit Test',x:150,y:700},{text:`Money out ${currency}`,x:400,y:10},{text:`Money in ${currency}`,x:600,y:10},{text:`Balance ${currency}`,x:800,y:10},{text:'12.34',x:500,y:700},{text:'50.00',x:900,y:700}];const [row]=P.parseBank('','synthetic.pdf',[items]);assert.deepEqual([row.date,row.details,row.payment,row.balance],['2026-08-10','Direct Debit Test',12.34,50]);}});
test('OCR invoices handle ordinal dates and scrambled currency characters',()=>{const r=P.parseInvoice('True Seal Solutions Invoice Invoice number Test INV-OOOI Invoice date 11th October 2026 Unit price E500.00 Total E500.oo','invoice.pdf');assert.equal(r.invoiceNumber,'0001');assert.equal(r.date,'2026-10-11');assert.equal(r.supplier,'True Seal Solutions');assert.equal(r.total,500);assert.equal(r.subtotal,'');});
test('invoice number comes from the document when the filename is random',()=>{const r=P.parseInvoice('Invoice no F/0200/09/2026 Seller Customer KRAKOW PL1 Invoice Unit price 4.00 Total 4.00','renamed-document-7.pdf');assert.equal(r.invoiceNumber,'2026');});
test('layout-only WZ parsing extracts fields but rejects documents without a configured supplier profile',()=>{const r=P.parseInvoice('Delivery date: 2026-09-09 DELIVERY 666715/MAG/2026 Total Issued baskets: 291,91 Returned baskets:','renamed-document-8.pdf');assert.equal(r.invoiceNumber,'6715');assert.equal(r.total,291.91);assert.equal(r.status,'REJECTED');assert.equal(r.unconfiguredSupplier,true);assert.match(r.rejectedReason,/supplier profile is not set up/i);});
test('Polish Village Bread invoices handle decimal commas and dense headers',()=>{const r=P.parseInvoice('Seller: Customer: Polish Village Bread LTD 4470 35180 Invoice date. 2026-07-13 Invoice FS 23855/MAG/2026 Amount due: 729,78 Tax value o,oo Total due: 729,78 GBP','polish-village.pdf');assert.equal(r.invoiceNumber,'3855');assert.equal(r.date,'2026-07-13');assert.equal(r.supplier,'Polish Village Bread LTD');assert.equal(r.subtotal,'');assert.equal(r.vat,0);assert.equal(r.total,729.78);assert.equal(r.currency,'GBP');assert.equal(r.status,'ACCEPTED');});
test('Polish Village Bread profile tolerates OCR reading LTD as LiD and records VAT zero',()=>{const lines=[{page:1,text:'Polish Village Bread LiD',x:100,y:100},{page:1,text:'Delivery date: 2026-09-25',x:100,y:140},{page:1,text:'DELIVERY 683504/MAG/2026',x:700,y:700},{page:1,text:'Total',x:979,y:1000},{page:1,text:'341,68',x:1536,y:1000},{page:1,text:'Issued baskets:',x:1140,y:1100}];const row=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'mixed.pdf',lines)[0];assert.equal(P.identifyInvoiceProfile('Polish Village Bread LiD DELIVERY 683504/MAG/2026').id,'polish-village-bread');assert.deepEqual([row.invoiceNumber,row.supplier,row.vat,row.total,row.status],['3504','Polish Village Bread LTD',0,341.68,'ACCEPTED']);});
test('ambiguous Polish delivery totals stay rejected until focused OCR returns a complete printed amount',()=>{const parse=(raw,delivery='655685')=>P.parseInvoice(`Polish Village Bread LTD Delivery date: 2026-07-29 DELIVERY ${delivery}/MAG/2026 Total Issued baskets:`, 'scan.pdf',[{page:1,text:'Polish Village Bread LTD',x:100,y:100},{page:1,text:'Delivery date: 2026-07-29',x:100,y:140},{page:1,text:`DELIVERY ${delivery}/MAG/2026`,x:700,y:700},{page:2,text:'Total',x:979,y:110},{page:2,text:raw,x:1536,y:110},{page:2,text:'Issued baskets:',x:1140,y:185}]);const unresolved=parse('22S,ä6'),resolved=parse('223,26'),semicolonUnreadable=parse('47ö;01','679814'),recovered=parse('470.01','679814');assert.deepEqual([unresolved.total,unresolved.status],['','REJECTED']);assert.deepEqual([resolved.total,resolved.vat,resolved.status],[223.26,0,'ACCEPTED']);assert.deepEqual([semicolonUnreadable.total,semicolonUnreadable.status],['','REJECTED']);assert.deepEqual([recovered.total,recovered.vat,recovered.status],[470.01,0,'ACCEPTED']);});
test('Polish Village Bread keeps a readable first-pass total accepted when 5x cannot re-read it',()=>{
  const lines=[{page:1,text:'Polish Village Bread LTD',x:100,y:100},{page:1,text:'Delivery date: 2026-09-16',x:100,y:140},{page:1,text:'DELIVERY 678627/MAG/2026',x:700,y:700},{page:2,text:'Total',x:970,y:94},{page:2,text:'309,77',x:1526,y:87},{page:2,text:'Issued baskets:',x:1138,y:170}];
  const [firstPass]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'Plosih 2.pdf',lines,{verifyPolishWzTotals:true});
  assert.deepEqual([firstPass.invoiceNumber,firstPass.total,firstPass.firstPassTotal,firstPass.retryOcr],['8627','',309.77,true]);
  assert.deepEqual(P.resolvePolishWzTotal(firstPass.firstPassTotal,303.77),{total:303.77,verified:true,status:'ACCEPTED'});
  assert.deepEqual(P.resolvePolishWzTotal(241.82,''),{total:241.82,verified:false,status:'ACCEPTED'});
  assert.deepEqual(P.resolvePolishWzTotal('',''),{total:'',verified:false,status:'REJECTED'});
});
test('invoice statuses are accepted or rejected for credit notes as well as invoices',()=>{
  assert.equal(P.invoiceStatusFor('INVOICE',true), 'ACCEPTED');
  assert.equal(P.invoiceStatusFor('DELIVERY NOTE',true), 'ACCEPTED');
  assert.equal(P.invoiceStatusFor('INVOICE',false), 'REJECTED');
  assert.equal(P.invoiceStatusFor('CREDIT NOTE',true), 'ACCEPTED');
  assert.equal(P.invoiceStatusFor('CREDIT NOTE',false), 'REJECTED');
  assert.equal(P.invoiceStatusFor('INVOICE',true,true), 'PROCESSING');
});
test('Polish Village Bread invoice 8627 uses the 5x printed total instead of the low-resolution 3/9 OCR error',{skip:process.platform!=='win32'||!fs.existsSync(path.join(__dirname,'..','samples','extractor','Invoices','Plosih 2.pdf'))},()=>{
  const source=path.join(__dirname,'..','samples','extractor','Invoices','Plosih 2.pdf'),helper=path.join(__dirname,'..','extractor','ocr-helper.ps1');
  const scan=scale=>{const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Scale',String(scale),'-PageList','22,23','-Path',source],{encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024}),pages=output.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]);return {pages,lines};};
  const low=scan(2.5),[firstPass]=P.parseInvoiceBatch(low.pages.map(page=>page.text||'').join('\n'),source,low.lines,{verifyPolishWzTotals:true});
  assert.deepEqual([firstPass.invoiceNumber,firstPass.total,firstPass.firstPassTotal,firstPass.retryOcr],['8627','',309.77,true]);
  const high=scan(5),[verified]=P.parseInvoiceBatch(high.pages.map(page=>page.text||'').join('\n'),source,high.lines,{ocrScale:5});
  assert.ok(verified,'invoice 8627 should be found on the high-resolution pass');
  assert.deepEqual([verified.total,verified.vat,verified.status,verified.retryOcr],[303.77,0,'ACCEPTED',false]);
  assert.deepEqual(P.resolvePolishWzTotal(firstPass.firstPassTotal,verified.total),{total:303.77,verified:true,status:'ACCEPTED'});
});
test('Polish Village Bread deduction invoices use the net amount due',()=>{const r=P.parseInvoice('Seller: Polish Village Bread LTD 1-5 BARON AVENUE, EARLS BARTON, NORTHAMPTON, NN6 OJE, VAT: GB0839416894 Invoice date. 2026-07-27 Invoice FS 25503/MAG/2026 Total discount: O,OO GBP 640,63 Amount due: Due in: 11 days Tax value o,oo o,oo Total: Net value 645,10 645,10 Tax value Gross value o,oo o,oo 645,10 645,10 Total In words: six hundred forty GBP 63/100 Deduction statement Total due: _4,47','polish-village-deduction.pdf');assert.equal(r.invoiceNumber,'5503');assert.equal(r.date,'2026-07-27');assert.equal(r.supplier,'Polish Village Bread LTD');assert.equal(r.subtotal,645.1);assert.equal(r.vat,0);assert.equal(r.total,640.63);assert.equal(r.currency,'GBP');assert.equal(r.review,false);});
test('Polish Village Bread invoice totals stay attached to their own invoice',()=>{const second=P.parseInvoice('Seller: Polish Village Bread LTD 1-5 BARON AVENUE Invoice date. 2026-08-10 Invoice FS 27169/MAG/2026 Net value 852,50 852,50 Tax value o,oo o,oo Amount due: Due in: O days 852,50 = 2026-08-10 Total due: eight hundred fifty two GBP 50/100 Statement of the account Invoice No. FS 26260/MAG/2026 FS 27169/MAG/2026 Date of issue 2026-08-03 2026-08-10 Total due: 786,48 852,50','FS-27169-MAG-2026.pdf');assert.equal(second.total,852.5);assert.equal(second.date,'2026-08-10');const corrected=P.parseInvoice('Seller: Customer: Polish Village Bread LTD 89140 4470 Invoice date. 2026-09-14 Invoice FS 31236/MAG/2026 Amount due: 800,94 Tax value o,oo Total due: eight hundred GBP 94/100','FS-31236-MAG-2026.pdf');assert.equal(corrected.supplier,'Polish Village Bread LTD');assert.equal(corrected.total,800.94);const september=P.parseInvoice('Invoice date. 2026-09-07 Invoice FS 30475/MAG/2026 Net value 678,19 678,19 Tax value Gross value O,OO GBP Amount due: Due in: O days Total: o,oo o,oo 678,19 = 2026-09-07','FS-30475-MAG-2026.pdf');assert.equal(september.total,678.19);});
test('WZ delivery notes reject statement balances that are not printed delivery totals',()=>{const direct=P.parseInvoice('Delivery date: 2026-07-03 DELIVERY 643683/MAG/2026 Total Issued baskets: Notes: 329,73 Returned baskets:','WZ-643683-MAG-2026.pdf');assert.equal(direct.invoiceNumber,'3683');assert.equal(direct.date,'2026-07-03');assert.equal(direct.total,329.73);const linked=P.parseInvoice('Delivery date: 2026-07-15 DELIVERY 649161/MAG/2026 Issued baskets: Notes: Statement of the account Invoice No. FS 22953/MAG/2026 FS 23855/MAG/2026 Date of issue 2026-07-06 2026-07-13 Due date 2026-07-17 2026-07-24 Total due: 859,18 729,78 Unpaid 859,18 729,78','WZ-649161-MAG-2026.pdf');assert.equal(linked.invoiceNumber,'9161');assert.equal(linked.date,'2026-07-15');assert.equal(linked.total,'');assert.equal(linked.retryOcr,true);});
test('WZ totals without readable pennies are blank and queued for higher-resolution OCR',()=>{const r=P.parseInvoice('Delivery date: 2026-07-17 DELIVERY 650506/MAG/2026 Total Issued baskets: Notes: 1/14.40 341 Returned baskets:','WZ-650506-MAG-2026.pdf');assert.equal(r.invoiceNumber,'0506');assert.equal(r.date,'2026-07-17');assert.equal(r.total,'');assert.equal(r.retryOcr,true);});
test('WZ OCR never reconstructs a total by adding invoice items',()=>{const values=[[50,1.49,74.5],[10,1.49,14.9],[5,1.64,8.2],[10,1.79,17.9],[5,2.26,11.3],[5,1.91,9.55],[5,2.13,10.65],[3,2.13,6.39],[5,1.91,9.55],[3,2.41,7.23],[40,1.74,69.6],[20,2.01,40.2],[3,18.7,56.1],[1,1.04,1.04],[1,1.04,1.04],[1,1.04,1.04],[1,1.04,1.04],[1,1.04,1.04]],lines=[{page:1,text:'Quantity',x:837,y:840},{page:1,text:'Gross price Discou',x:1159,y:840},{page:1,text:'Gross value',x:1439,y:840},{page:2,text:'Total',x:483,y:62},{page:2,text:'341',x:761,y:62}];values.forEach((v,i)=>{const y=917+i*50;lines.push({page:1,text:`${v[0]},000`,x:850,y},{page:1,text:v[1].toFixed(2).replace('.',','),x:1268,y},{page:1,text:v[2].toFixed(2).replace('.',','),x:1535,y});});const r=P.parseInvoice('Delivery date: 2026-07-17 DELIVERY 650506/MAG/2026 Total Issued baskets: Notes: 1/14.40 341 Returned baskets:','random-name.pdf',lines);assert.equal(r.total,'');assert.equal(r.retryOcr,true);assert.equal(r.status,'REJECTED');});
test('WZ OCR uses the amount aligned with the Total label',()=>{const r=P.parseInvoice('Delivery date: 2026-07-31 DELIVERY 656540/MAG/2026 Total Issued baskets: Notes: 13:58 Statement of the account Total due: 766,05 640,63 333,75 Returned baskets:','WZ 656540_MAG_2026.pdf',[{page:2,text:'Total',x:483,y:62},{page:2,text:'333,75',x:761,y:62},{page:2,text:'Total due:',x:649,y:381},{page:2,text:'766,05',x:677,y:404},{page:2,text:'640,63',x:677,y:425}]);assert.equal(r.total,333.75);assert.equal(r.status,'REJECTED');});
test('Polish WZ total extraction follows the printed label when the scan shifts and the value sits closer',()=>{
  const lines=[{page:1,text:'Polish Village Bread LTD',x:100,y:100},{page:1,text:'Delivery date: 2026-09-16',x:100,y:140},{page:1,text:'DELIVERY 681880/MAG/2026',x:700,y:700},{page:1,text:'Total',x:920,y:1200},{page:1,text:'327,96',x:1020,y:1200},{page:1,text:'Issued baskets:',x:1100,y:1300}];
  const parse=items=>P.parseInvoiceBatch(items.map(line=>line.text).join('\n'),'shifted-WZ.pdf',items)[0],base=parse(lines),shifted=parse(lines.map(line=>({...line,x:line.x+500,y:line.y+1450})));
  assert.deepEqual([base.invoiceNumber,base.date,base.total,base.status],['1880','2026-09-16',327.96,'ACCEPTED']);
  assert.deepEqual([shifted.invoiceNumber,shifted.date,shifted.total,shifted.status],[base.invoiceNumber,base.date,base.total,base.status]);
});
test('WZ OCR keeps decimal pennies when the scan separates the total',()=>{const r=P.parseInvoice('Delivery date: 2026-09-09 DELIVERY 675002/MAG/2026 Total Issued baskets: Statement of the account Total due: 573,11 678,19 291,91 Returned baskets:','WZ-675002-MAG-2026.pdf',[{page:2,text:'Total',x:483,y:62},{page:2,text:'291,91',x:761,y:62}]);assert.equal(r.total,291.91);});
test('Polish Village WZ rows keep OCR-spaced pennies and prefer the printed total',()=>{
  const firstValues=['28,80','14,40','8,00','8,25','9,10','9,85','12,05','15,20','7,40','20,10','10,10','5,05','2,02','2,02','4, 34','4,34','4,34','70,24'];
  const firstLines=firstValues.map((text,i)=>({page:1,text,x:1530,y:900+i*50}));
  firstLines.push({page:2,text:'Total',x:979,y:113},{page:2,text:'235;60',x:1536,y:116});
  const first=P.parseInvoice('Delivery date: 2026-08-19 DELIVERY 665547/MAG/2026 Total Issued baskets:','FS-25503-MAG-2026.pdf',firstLines);
  assert.equal(first.invoiceNumber,'5547');
  assert.equal(first.total,'');assert.equal(first.retryOcr,true);
  const secondValues=['14,40','14,40','8,00','13,50','14.80','20,10','10,10','5,05','70,24'];
  const secondLines=secondValues.map((text,i)=>({page:1,text,x:1540,y:900+i*50}));
  secondLines.push({page:1,text:'Total',x:972,y:1431},{page:1,text:'170,59',x:1531,y:1430});
  const second=P.parseInvoice('Delivery date: 2026-08-05 DELIVERY 658897/MAG/2026 Total Issued baskets:','WZ-8897.pdf',secondLines);
  assert.equal(second.invoiceNumber,'8897');
  assert.equal(second.total,170.59);
});
test('Polish Village WZ totals ignore outstanding account balances',()=>{
  const rows=(id,summary,values)=>P.parseInvoice(`Delivery date: 2026-09-16 DELIVERY ${id}/MAG/2026 Total Issued baskets:`,`${id}.pdf`,[
    ...values.map((value,i)=>({page:1,text:String(1001+i),x:200,y:800+i*50})),
    ...values.map((value,i)=>({page:1,text:value,x:1500,y:800+i*50})),
    ...(summary||[])
  ]);
  const unreadable=rows('678627',null,['100.00','100.00','103.77']);assert.equal(unreadable.total,'');assert.equal(unreadable.retryOcr,true);
  assert.equal(rows('681880',[{page:2,text:'327,96',x:1530,y:102},{page:2,text:'Issued baskets:',x:1140,y:180}],['100.00','100.00','119.71']).total,327.96);
  const suspect=rows('679814',[{page:2,text:'Total',x:973,y:93},{page:2,text:'476;01',x:1528,y:86}],['156.00','156.00','158.01']);assert.equal(suspect.total,'');assert.equal(suspect.retryOcr,true);
  assert.equal(rows('685219',[{page:2,text:'Total',x:1017,y:118},{page:2,text:'258,62',x:1573,y:139}],['100.00','100.00','54.28']).total,258.62);
});
test('continued WZ notes whose footer carries the delivery heading stay grouped with the next page',()=>{const lines=[
  {page:1,text:'Delivery date:',x:100,y:80},{page:1,text:'2026-09-03',x:100,y:120},{page:1,text:'DELIVERY 673354/MAG/2026',x:1180,y:2658},{page:1,text:'Continued on the next page',x:100,y:2659},
  {page:2,text:'Total',x:967,y:120},{page:2,text:'461,01',x:1524,y:121},{page:2,text:'Issued baskets:',x:1135,y:197},{page:2,text:'Statement of the account',x:120,y:900},{page:2,text:'989,31',x:1510,y:1000}
];const r=P.parseInvoiceBatch(lines.map(x=>x.text).join('\n'),'random-name.pdf',lines);assert.equal(r.length,1);assert.equal(r[0].invoiceNumber,'3354');assert.equal(r[0].total,461.01);});
test('WZ totals with OCR-confused labels or currency symbols are retried instead of accepted',()=>{const r=P.parseInvoice('Delivery date: 2026-10-07 DELIVERY 688602/MAG/2026 Total Issued baskets:','random-name.pdf',[{page:1,text:'DELIVERY 688602/MAG/2026',x:700,y:700},{page:2,text:'Tout',x:964,y:427},{page:2,text:'$5,97',x:1516,y:422},{page:2,text:'Issued baskeG:',x:1126,y:504}]);assert.equal(r.invoiceNumber,'8602');assert.equal(r.total,'');assert.equal(r.retryOcr,true);});
test('combined invoice PDFs split each delivery note into one row',()=>{const lines=[
  {page:1,text:'Delivery date:',x:100,y:80},{page:1,text:'2026-08-12',x:100,y:120},{page:1,text:'DELIVERY 661933/MAG/2026',x:700,y:700},{page:1,text:'Total',x:950,y:1000},{page:1,text:'46,78',x:1300,y:1000},
  {page:2,text:'DELIVERY 661933/MAG/2026',x:1150,y:2660},
  {page:3,text:'Delivery date:',x:100,y:80},{page:3,text:'2026-08-14',x:100,y:120},{page:3,text:'DELIVERY 663317/MAG/2026',x:700,y:700},{page:3,text:'Total',x:950,y:1000},{page:3,text:'374,27',x:1300,y:1000}
];const r=P.parseInvoiceBatch(lines.map(x=>x.text).join('\n'),'combined.pdf',lines);assert.equal(r.length,2);assert.deepEqual(r.map(x=>[x.invoiceNumber,x.date,x.total]),[['1933','2026-08-12',46.78],['3317','2026-08-14',374.27]]);});
const biffaSampleFolder=path.join(__dirname,'..','samples','extractor','Krakow PL1 LTD INVOICES FOR JUL - SEP - Copy','Krakow PL1 LTD INVOICES FOR JUL - SEP - Copy','Biffa (Done)');
test('Biffa invoices use the supplier, subtotal and VAT summary instead of line-item totals',{skip:!fs.existsSync(path.join(biffaSampleFolder,'408C110915.pdf'))||!fs.existsSync(path.join(biffaSampleFolder,'408C123064.pdf'))},async()=>{const folder=biffaSampleFolder;const first=await P.parsePdf(fs.readFileSync(path.join(folder,'408C110915.pdf')),'invoice','408C110915.pdf');assert.deepEqual([first.invoice.invoiceNumber,first.invoice.date,first.invoice.supplier,first.invoice.subtotal,first.invoice.vat,Number(first.invoice.total.toFixed(2)),first.invoice.currency],['0915','2026-07-24','Biffa Waste Services Limited',298.92,59.78,358.70,'GBP']);const third=await P.parsePdf(fs.readFileSync(path.join(folder,'408C123064.pdf')),'invoice','408C123064.pdf');assert.equal(Number(third.invoice.total.toFixed(2)),434.22);});
test('Maspo invoices use their printed VAT summary and join repeated invoice pages',()=>{
  const lines=[
    {page:1,text:'2607-SP/02/00454',x:978,y:261},{page:1,text:'Invoice no.',x:710,y:266},{page:1,text:'Seller',x:204,y:423},{page:1,text:'MASPO LTD',x:204,y:468},{page:1,text:'08.07.2026',x:1062,y:1026},{page:1,text:'Invoice date (taxpoint):',x:201,y:1037},{page:1,text:'Total In GBP',x:1364,y:1703},{page:1,text:'555.56',x:1584,y:1702},{page:1,text:'111.11',x:1698,y:1702},{page:1,text:'666.67',x:1808,y:1702},{page:1,text:'Total: 666,67 GBP',x:210,y:1852},
    {page:2,text:'no. 2607-SP/02/00454',x:864,y:296},{page:2,text:'Invoice no.',x:680,y:296}
  ];
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO 1.pdf',lines);
  assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].supplier,rows[0].subtotal,rows[0].vat,rows[0].total,rows[0].documentType,rows[0].page],['0454','2026-07-08','MASPO',555.56,111.11,666.67,'INVOICE',1]);assert.equal(rows[0].retryOcr,false);
});
test('Maspo preserves a readable printed total when VAT summary OCR needs review',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/04286',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},{page:1,text:'Total: 296,85 GBP',x:170,y:1646}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.date,row.page,row.total,row.vat,row.retryOcr,row.status],['4286','2026-07-29',1,296.85,'',true,'REJECTED']);
});
test('Maspo keeps printed VAT and total even when the invoice figures do not add up',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/04287',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},{page:1,text:'20%',x:1500,y:1100},{page:1,text:'100,00',x:1560,y:1100},{page:1,text:'20,00',x:1680,y:1100},{page:1,text:'120,00',x:1780,y:1100},{page:1,text:'Total: 130,00 GBP',x:170,y:1646},{page:1,text:'In words: one hundred thirty 00/100',x:170,y:1700}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.total,row.vat,row.status],[130,20,'ACCEPTED']);
});
test('Maspo VAT comes from the final summary table, not taxable product rows',()=>{
  const makeInvoice=(number,vat)=>[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:`2607-SP/02/${number}`,x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},
    {page:1,text:'0%',x:1395,y:1832},{page:1,text:'9.90',x:1618,y:1832},{page:1,text:'Total in GBP',x:1380,y:1882},{page:1,text:'568.04',x:1600,y:1882},{page:1,text:String(vat),x:1730,y:1882},{page:1,text:'568.04',x:1826,y:1882},{page:1,text:'0.00',x:1730,y:1948},{page:1,text:'Total: 568,04 GBP',x:224,y:2032}
  ];
  for(const [number,vat] of [['04014','0.00'],['03433','0,00']]){const [row]=P.parseInvoiceBatch(makeInvoice(number,vat).map(line=>line.text).join('\n'),'MASPO.pdf',makeInvoice(number,vat));assert.equal(row.invoiceNumber,number.slice(-4));assert.equal(row.vat,0);}
});
test('Maspo continuation pages never treat a product net value as invoice VAT',()=>{
  const makeInvoice=vatCell=>[
    {page:25,text:'Invoice no.',x:728,y:260},{page:25,text:'2607-SP/02/03433',x:996,y:256},{page:25,text:'Seller',x:219,y:420},{page:25,text:'MASPO LTD',x:222,y:465},{page:25,text:'Invoice date (taxpoint):',x:218,y:1032},{page:25,text:'29.07.2026',x:1080,y:1022},
    {page:25,text:'0%',x:1325,y:667},{page:25,text:'1.78',x:1437,y:667},{page:25,text:'42.72',x:1538,y:667},{page:25,text:'42.72',x:1760,y:667},
    {page:25,text:'0%',x:1325,y:630},{page:25,text:'0%',x:1325,y:650},{page:25,text:'Total in GBP',x:1311,y:716},{page:25,text:'43425',x:1528,y:716},{page:25,text:'43425',x:1750,y:716},{page:25,text:vatCell,x:1658,y:780},{page:25,text:'Total: 434,25 GBP',x:156,y:858},{page:25,text:'In words: four hundred thirty four 25/100',x:157,y:896}
  ];
  const parse=vat=>P.parseInvoiceBatch(makeInvoice(vat).map(line=>line.text).join('\n'),'MASPO.pdf',makeInvoice(vat))[0];
  const unreadable=parse('???');assert.equal(unreadable.vat,'');assert.equal(unreadable.retryOcr,true);assert.equal(unreadable.status,'REJECTED');
  const zero=parse('om');assert.equal(zero.vat,0);assert.equal(zero.total,434.25);assert.equal(zero.status,'ACCEPTED');
});
test('Maspo OCR reading ODO in the printed VAT cell is treated as zero',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/02402',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},{page:1,text:'Totat In GBP',x:1386,y:1858},{page:1,text:'8214',x:1615,y:1922},{page:1,text:'ODO',x:1737,y:1922},{page:1,text:'8214',x:1848,y:1922},{page:1,text:'Total: 82,14 GBP',x:122,y:2030},{page:1,text:'In words: eighty two 14/100',x:124,y:2070}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status,row.retryOcr],['2402',82.14,0,'ACCEPTED',false]);
});
test('Maspo reads the VAT summary when OCR misreads the word in as fn',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2609-SP/02/01053',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'09.09.2026',x:1060,y:1025},{page:1,text:'Total fn GBP',x:1380,y:1882},{page:1,text:'744.61',x:1584,y:1882},{page:1,text:'149.72',x:1698,y:1882},{page:1,text:'894.33',x:1808,y:1882},{page:1,text:'Total: 898,33 GBP',x:210,y:2032},{page:1,text:'In words: eight hundred ninety eight 33/100',x:210,y:2072}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.vat,row.total,row.status],['1053',149.72,898.33,'ACCEPTED']);
});
test('Maspo rejects compact non-zero VAT OCR rather than inventing a decimal or invoice-specific amount',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02101634',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'15.07.2026',x:1060,y:1025},{page:5,text:'Total In GBP',x:1401,y:2491},{page:5,text:'371224',x:1620,y:2491},{page:5,text:'1034',x:1758,y:2491},{page:5,text:'372308',x:1852,y:2491},{page:6,text:'Total: 3723,08 GBP',x:122,y:559},{page:6,text:'In words: three thousand seven hundred twenty three 08/100',x:124,y:598}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status,row.retryOcr],['1634',3723.08,'','REJECTED',true]);
});
test('Maspo page 33 credit note is retained and invoice 5066 stays rejected when high-resolution OCR drops VAT digits', {skip:process.platform!=='win32'||!fs.existsSync(path.join(__dirname,'..','samples','extractor','Invoices','MASPO','Tested','Normal','MASPO 2.pdf'))},()=>{
  const source=path.join(__dirname,'..','samples','extractor','Invoices','MASPO','Tested','Normal','MASPO 2.pdf'),helper=path.join(__dirname,'..','extractor','ocr-helper.ps1');
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Scale','5','-PageList','33,34','-Path',source],{encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024});
  const pages=output.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),source,lines),result=P.reconcileInvoiceCorrections(rows);
  const credit=result.find(row=>row.documentType==='CREDIT NOTE'),invoice=result.find(row=>row.invoiceNumber==='5066');
  assert.ok(credit,'page 33 credit note should be found');
  assert.deepEqual([credit.invoiceNumber,credit.vat,credit.total,credit.status,credit.accepted,credit.rejected,credit.review,credit.correctsInvoice,credit.page],['3378',0,-22.45,'ACCEPTED',true,false,false,'FS103705/LON/07/2026',33]);
  assert.ok(invoice,'invoice 5066 should be found on page 34');
  assert.deepEqual([invoice.vat,invoice.total,invoice.status,invoice.retryOcr],['',232.17,'REJECTED',true]);
});
test('Maspo takes the final invoice VAT summary after a multi-page item table',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2606-SP/02/03782',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'30.06.2026',x:1060,y:1025},{page:9,text:'Item name Quantity VAT rate Net value VAT value Gross value',x:300,y:498},{page:9,text:'10.32',x:1605,y:823},{page:9,text:'Total In GBP',x:1374,y:1440},{page:9,text:'5945.38',x:1500,y:1440},{page:9,text:'137.38',x:1708,y:1440},{page:9,text:'6082.76',x:1808,y:1440},{page:9,text:'0%',x:1390,y:1495},{page:9,text:'20%',x:1390,y:1570},{page:9,text:'Total: 6082,76 GBP',x:122,y:1650},{page:9,text:'In words: six thousand eighty two 76/100',x:124,y:1690}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status,row.retryOcr],['3782',6082.76,137.38,'ACCEPTED',false]);
});
test('Maspo reads invoice summary VAT relative to its printed label after page coordinates shift',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/00454',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'08.07.2026',x:1060,y:1025},{page:1,text:'Total In GBP',x:1200,y:1600},{page:1,text:'555,56',x:1400,y:1600},{page:1,text:'111,11',x:1500,y:1600},{page:1,text:'666,67',x:1600,y:1600},{page:1,text:'Total: 666,67 GBP',x:200,y:1750},{page:1,text:'In words: six hundred sixty six 67/100',x:200,y:1790}];
  const parse=items=>P.parseInvoiceBatch(items.map(line=>line.text).join('\n'),'shifted-MASPO.pdf',items)[0],base=parse(lines),shifted=parse(lines.map(line=>({...line,x:line.x-300,y:line.y+1000})));
  assert.deepEqual([base.invoiceNumber,base.date,base.total,base.vat,base.status],['0454','2026-07-08',666.67,111.11,'ACCEPTED']);
  assert.deepEqual([shifted.invoiceNumber,shifted.date,shifted.total,shifted.vat,shifted.status],[base.invoiceNumber,base.date,base.total,base.vat,base.status]);
});
test('Maspo VAT summary can continue onto the following page',()=>{
  const lines=[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/04288',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},{page:1,text:'Total in GBP',x:1380,y:2450},{page:1,text:'100.00',x:1600,y:2450},
    {page:2,text:'Invoice no.',x:700,y:260},{page:2,text:'2607-SP/02/04288',x:980,y:260},{page:2,text:'100.00',x:1730,y:430},{page:2,text:'10.84',x:1730,y:500},{page:2,text:'Total: 110,84 GBP',x:170,y:1646},{page:2,text:'In words: one hundred ten 84/100',x:170,y:1700}
  ];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'split-summary.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status],['4288',110.84,10.84,'ACCEPTED']);
});
test('Maspo OCR zero VAT is accepted when OCR drops the decimal marks',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/02403',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},{page:1,text:'Total in GBP',x:1380,y:1882},{page:1,text:'43425',x:1584,y:1882},{page:1,text:'000',x:1698,y:1882},{page:1,text:'43425',x:1808,y:1882},{page:1,text:'Total: 434,25 GBP',x:210,y:2032}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.vat,row.total,row.status],['2403',0,434.25,'ACCEPTED']);
});
test('Maspo OCR zero VAT is accepted when the comma is read as a letter',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2609-SP/02/02136',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'09.09.2026',x:1060,y:1025},{page:1,text:'Total In GBP',x:1388,y:1729},{page:1,text:'216,85',x:1608,y:1729},{page:1,text:'216,85',x:1832,y:1729},{page:1,text:'OPO',x:1739,y:1796},{page:1,text:'0%',x:1520,y:1796},{page:1,text:'216,85',x:1608,y:1796},{page:1,text:'216,85',x:1832,y:1796},{page:1,text:'Total: 216,85 GBP',x:170,y:1880},{page:1,text:'In words: two hundred sixteen 85/100',x:170,y:1920}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO zero VAT.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.vat,row.total,row.status],['2136',0,216.85,'ACCEPTED']);
});
test('Maspo LON continuation pages with a leading OCR digit stay in one invoice',()=>{
  const lines=[
    {page:71,text:'Invoice no.',x:700,y:250},{page:71,text:'10369/LON/09/2026',x:980,y:250},{page:71,text:'Maspo Food Ltd',x:170,y:400},{page:71,text:'Invoice date:',x:1400,y:360},{page:71,text:'25.09.2026',x:1500,y:400},{page:71,text:'Item name',x:480,y:500},{page:71,text:'Gross value',x:1724,y:500},{page:71,text:'Continued on the next page Invoice 10369/LON/09/2026',x:200,y:2500},
    {page:76,text:'Item name',x:480,y:500},{page:76,text:'Net value',x:1344,y:562},{page:76,text:'Tax value',x:1542,y:562},{page:76,text:'0,00 85,34 85,34',x:1624,y:620},{page:76,text:'Gross value',x:1724,y:562},{page:76,text:'1 762,20 512,03 2 274,23',x:1786,y:650},{page:76,text:'Total In words: 2 274,23',x:971,y:814},{page:76,text:'Invoice 110369/LON/09/2026',x:1213,y:2527}
  ];
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'multi-page-LON.pdf',lines);
  assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].supplier,rows[0].total,rows[0].vat,rows[0].status],['0369','2026-09-25','MASPO',2274.23,85.34,'ACCEPTED']);
});
test('Maspo account statements are rejected instead of becoming invoice rows',()=>{const row=P.parseInvoice('MASPO LTD Statement of the account Invoice No. 2607-SP/02/04286 Date of issue 2026-07-29 Total due 296,85 Unpaid 296,85');assert.equal(row.status,'REJECTED');assert.equal(row.total,'');assert.equal(row.invoiceNumber,'');assert.match(row.rejectedReason,/statement or non-invoice/i);});
test('Maspo OCR variants and continuation pages use one supplier layout profile',()=>{const lines=[
  {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-sp/02103737',x:980,y:260},{page:1,text:'Seller',x:170,y:400},{page:1,text:'MASPO LTD',x:174,y:447},{page:1,text:'Invoice date (taxpoint):',x:165,y:1034},{page:1,text:'29.07.2026',x:1060,y:1030},
  {page:2,text:'Invoice no. 2607-SP/02/03737',x:700,y:260},{page:2,text:'Total: 3 746,08 GBP',x:170,y:1646}
];const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO mixed layouts.pdf',lines);assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].supplier,rows[0].total,rows[0].vat,rows[0].status,rows[0].profileId,rows[0].layoutId,rows[0].retryOcr],['3737','2026-07-29','MASPO',3746.08,'','REJECTED','maspo','maspo-labelled-total',true]);});
test('a repeated invoice header with an OCR-corrupted year stays attached to the original invoice',()=>{const lines=[
  {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/04286',x:980,y:260},{page:1,text:'Seller',x:170,y:400},{page:1,text:'MASPO LTD',x:174,y:447},{page:1,text:'Invoice date (taxpoint):',x:165,y:1034},{page:1,text:'29.07.2026',x:1060,y:1030},
  {page:2,text:'Invoice no.',x:700,y:260},{page:2,text:'2607-SP/02/04286',x:980,y:260},{page:2,text:'Seller',x:170,y:400},{page:2,text:'MASPO LTD',x:174,y:447},{page:2,text:'Invoice date (taxpoint):',x:165,y:1034},{page:2,text:'29.07.2608',x:1060,y:1030},{page:2,text:'Total in GBP',x:1378,y:1200},{page:2,text:'296.85',x:1588,y:1200},{page:2,text:'0.00',x:1708,y:1200},{page:2,text:'296.85',x:1812,y:1200},{page:2,text:'Total: 296,85 GBP',x:170,y:1500},{page:2,text:'In words: two hundred ninety six 85/100',x:170,y:1540}
];const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'continued.pdf',lines);assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].vat,rows[0].total,rows[0].status,rows[0].page],['4286','2026-07-29',0,296.85,'ACCEPTED',1]);});
test('a continuation with a damaged Maspo prefix stays attached by its invoice suffix',()=>{const lines=[
  {page:20,text:'Invoice no.',x:700,y:260},{page:20,text:'2608-SP/02/02677',x:980,y:260},{page:20,text:'Seller',x:170,y:400},{page:20,text:'MASPO LTD',x:174,y:447},{page:20,text:'Invoice date (taxpoint):',x:165,y:1034},{page:20,text:'19.08.2026',x:1060,y:1030},{page:20,text:'Item name',x:480,y:500},{page:20,text:'Gross value',x:1724,y:500},
  {page:26,text:'Invoice no. 2608-9/02/02677',x:700,y:260},{page:26,text:'Total in GBP',x:1378,y:1200},{page:26,text:'3779.53',x:1588,y:1200},{page:26,text:'294.99',x:1710,y:1200},{page:26,text:'4074.52',x:1812,y:1200},{page:26,text:'Total: 4074,52 GBP',x:170,y:1500},{page:26,text:'In words: four thousand seventy four 52/100',x:170,y:1540}
];const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'multi-page-maspo.pdf',lines);assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].date,rows[0].supplier,rows[0].vat,rows[0].total,rows[0].status,rows[0].page],['2677','2026-08-19','MASPO',294.99,4074.52,'ACCEPTED',20]);});
test('Maspo handles the alternate labelled-total and compact LON layouts under the same profile',()=>{
  const alternate=[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'Invoice 2607-SP/02/04286',x:980,y:260},{page:1,text:'Seller',x:170,y:400},{page:1,text:'MASPO LTD',x:174,y:447},{page:1,text:'Invoice date (taxpoint):',x:165,y:1034},{page:1,text:'29.07.2026',x:1060,y:1030},{page:1,text:'Total: 296,85 GBP',x:170,y:1646}
  ];
  const compact=[
    {page:1,text:'Seller: Maspo Food Ltd',x:150,y:400},{page:1,text:'Invoice 103705/LON/07/2026',x:160,y:480},{page:1,text:'Invoice date (taxpoint): 31.07.2026',x:150,y:520},{page:1,text:'Net value',x:1400,y:150},{page:1,text:'310.71',x:1450,y:180},{page:1,text:'Tax value',x:1600,y:150},{page:1,text:'0.00',x:1650,y:180},{page:1,text:'Gross value',x:1760,y:150},{page:1,text:'310.71',x:1800,y:180},{page:1,text:'Amount due: 310.71',x:1200,y:280}
  ];
  const [labelled]=P.parseInvoiceBatch(alternate.map(line=>line.text).join('\n'),'page14.pdf',alternate),[lon]=P.parseInvoiceBatch(compact.map(line=>line.text).join('\n'),'lon-layout.pdf',compact);
  assert.deepEqual([labelled.invoiceNumber,labelled.total,labelled.vat,labelled.profileId,labelled.layoutId,labelled.status,labelled.retryOcr],['4286',296.85,'','maspo','maspo-labelled-total','REJECTED',true]);
  assert.deepEqual([lon.invoiceNumber,lon.date,lon.total,lon.profileId,lon.layoutId,lon.status],['3705','2026-07-31',310.71,'maspo','maspo-compact-summary','ACCEPTED']);
});
test('Maspo footer-only continuation layout keeps its printed total and cannot mislabel the customer as supplier',()=>{
  const lines=[
    {page:2,text:'Item name ... Tax value ... Gross value ... Continued on the next page Invoice 103515/LON/07/2026',x:200,y:2500},
    {page:3,text:'Item name ... Tax value ... Gross value ... Continued on the next page Invoice 103515/LON/07/2026',x:200,y:2500},
    {page:4,text:'Item name ... Gross value Net value 961.62 137.76 1099.38 Tax value 0.00 27.55 27.55 Gross value 961.62 165.31 1 126.93 Total in words: 1 126,93 GBP Amount due: 12.08.2026 ARA PL LTD Maspo Food Ltd Invoice 103515/LON/07/2026',x:200,y:2500}
  ];
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'missing-first-page.pdf',lines);
  assert.equal(rows.length,1);assert.deepEqual([rows[0].invoiceNumber,rows[0].supplier,rows[0].total,rows[0].vat,rows[0].profileId,rows[0].layoutId,rows[0].status],['3515','MASPO',1126.93,27.55,'maspo','maspo-lon-item-table','REJECTED']);
  assert.doesNotMatch(rows[0].supplier,/ARA PL/i);
});
test('Maspo LON summary pages stay attached and preserve the printed total and VAT on the three affected layouts',()=>{
  const firstInvoice=[
    {page:1,text:'Invoice no.',x:700,y:250},{page:1,text:'103515/LON/07/2026',x:980,y:250},{page:1,text:'Seller',x:170,y:390},{page:1,text:'Maspo Food Ltd',x:174,y:430},{page:1,text:'Invoice date:',x:1400,y:360},{page:1,text:'31.07.2026',x:1500,y:400},
    {page:2,text:'Item name',x:480,y:500},{page:2,text:'Gross value',x:1724,y:500},{page:2,text:'Continued on the next page',x:130,y:2528},{page:2,text:'Invoice 103515/LON/07/2026',x:1218,y:2528},
    {page:3,text:'Item name',x:480,y:500},{page:3,text:'Gross value',x:1724,y:500},{page:3,text:'Continued on the next page',x:130,y:2524},{page:3,text:'Invoice 103515/LON/07/2026',x:1218,y:2524},
    {page:4,text:'Net value',x:1344,y:562},{page:4,text:'Tax value',x:1542,y:562},{page:4,text:'Gross value',x:1724,y:562},{page:4,text:'Total:',x:1130,y:698},{page:4,text:'1 099,38',x:1391,y:700},{page:4,text:'27,55',x:1624,y:699},{page:4,text:'1 126.93',x:1786,y:699},{page:4,text:'In words:',x:971,y:814},{page:4,text:'Invoice 103515/LON/07/2026',x:1213,y:2527}
  ];
  const page14=[
    {page:14,text:'Invoice no.',x:701,y:236},{page:14,text:'2607-SP/02/04286',x:980,y:236},{page:14,text:'Seller',x:170,y:400},{page:14,text:'MASPO LTD',x:174,y:440},{page:14,text:'Invoice date (taxpoint):',x:166,y:1034},{page:14,text:'29.07.2026',x:1060,y:1030},{page:14,text:'Total tn GBP',x:1373,y:1494},{page:14,text:'o,oo',x:1737,y:1494},{page:14,text:'Total: 296,85 GBP',x:170,y:1646}
  ];
  const page32=[
    {page:32,text:'Invoice no.',x:734,y:260},{page:32,text:'2607-SP/02/03815',x:980,y:260},{page:32,text:'Seller',x:170,y:400},{page:32,text:'MASPO LTD',x:174,y:440},{page:32,text:'Invoice date (taxpoint):',x:166,y:1034},{page:32,text:'28.07.2026',x:1060,y:1030},{page:32,text:'Item no. Item name Quantity Unit Net price VAT rate Net value VAT value Gross value',x:100,y:490},{page:32,text:'Total in GBP',x:1378,y:1242},{page:32,text:'3481.30',x:1588,y:1242},{page:32,text:'19178',x:1710,y:1242},{page:32,text:'3675M',x:1812,y:1242},{page:32,text:'0%',x:1500,y:1306},{page:32,text:'2512.38',x:1560,y:1306},{page:32,text:'0.00',x:1680,y:1306},{page:32,text:'2512.38',x:1780,y:1306},{page:32,text:'20%',x:1500,y:1372},{page:32,text:'968.92',x:1560,y:1372},{page:32,text:'193.78',x:1680,y:1372},{page:32,text:'1162.70',x:1780,y:1372},{page:32,text:'Total: 3675,08 GBP',x:224,y:1452},{page:32,text:'In words:',x:226,y:1490}
  ];
  const continuationItems=[{page:31,text:'0%',x:1392,y:1122},{page:31,text:'12.54',x:1608,y:1122},{page:31,text:'0.00',x:1728,y:1122},{page:31,text:'12.54',x:1832,y:1122}];
  const extract=lines=>P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  const [first]=extract(firstInvoice),[fourteen]=extract(page14),[thirtyTwo]=extract([...continuationItems,...page32]);
  assert.deepEqual([first.invoiceNumber,first.total,first.vat,first.status,first.page],['3515',1126.93,27.55,'ACCEPTED',1]);
  assert.deepEqual([fourteen.invoiceNumber,fourteen.total,fourteen.vat,fourteen.status],['4286',296.85,0,'ACCEPTED']);
  assert.deepEqual([thirtyTwo.invoiceNumber,thirtyTwo.total,thirtyTwo.subtotal,thirtyTwo.vat,thirtyTwo.status],['3815',3675.08,3481.3,193.78,'ACCEPTED']);
});
test('Maspo uses the printed Total in GBP VAT when OCR damages the repeated rate-band value',()=>{
  const lines=[
    {page:32,text:'Invoice no.',x:734,y:260},{page:32,text:'2607-SP/02/03815',x:980,y:260},{page:32,text:'Seller',x:170,y:400},{page:32,text:'MASPO LTD',x:174,y:440},{page:32,text:'Invoice date (taxpoint):',x:166,y:1034},{page:32,text:'28.07.2026',x:1060,y:1030},
    {page:32,text:'Total in GBP',x:1377,y:1244},{page:32,text:'3481.30',x:1586,y:1244},{page:32,text:'193.78',x:1708,y:1244},{page:32,text:'3675.08',x:1810,y:1244},
    {page:32,text:'0%',x:1500,y:1309},{page:32,text:'2512.38',x:1560,y:1309},{page:32,text:'0.00',x:1680,y:1309},{page:32,text:'2512.38',x:1780,y:1309},
    {page:32,text:'20%',x:1500,y:1375},{page:32,text:'968.92',x:1560,y:1375},{page:32,text:'19378',x:1708,y:1375},{page:32,text:'1162.70',x:1780,y:1375},
    {page:32,text:'Total: 3675,08 GBP',x:224,y:1452},{page:32,text:'In words: three thousand six hundred seventy five 08/100',x:226,y:1490}
  ];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO 3815.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status],['3815',3675.08,193.78,'ACCEPTED']);
});
test('Maspo restores a lost decimal only when the amount box width confirms complete digits',()=>{
  const make=(number,vat,width,lines=[])=>[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:`2609-SP/02/${number}`,x:980,y:260},{page:1,text:'MASPO LTD',x:170,y:400},{page:1,text:'Invoice date (taxpoint):',x:165,y:1034},{page:1,text:'09.09.2026',x:1060,y:1030},
    {page:1,text:'Total in GBP',x:1319,y:1268},{page:1,text:'3345,33',x:1536,y:1268},{page:1,text:vat,x:1671,y:1265,width},{page:1,text:'3370,53',x:1768,y:1264},
    {page:1,text:'0%',x:1455,y:1332},{page:1,text:'3219,33',x:1536,y:1332},{page:1,text:'o,oo',x:1680,y:1332,width:32},{page:1,text:'3219,33',x:1768,y:1332},
    {page:1,text:'20%',x:1500,y:1400},{page:1,text:'126,00',x:1536,y:1400},{page:1,text:vat,x:1672,y:1400,width:width-0.4},{page:1,text:'151,20',x:1780,y:1400},
    {page:1,text:'0.00',x:1679,y:980,width:32.4},{page:1,text:'0.00',x:1679,y:1036,width:32.4},{page:1,text:'0.00',x:1679,y:1091,width:32.4},
    {page:1,text:'Total: 3370,53 GBP',x:170,y:1502},{page:1,text:'In words: three thousand three hundred seventy 53/100',x:170,y:1543},...lines
  ];
  const parse=(number,vat,width,lines)=>P.parseInvoiceBatch(make(number,vat,width,lines).map(line=>line.text).join('\n'),'MASPO width check.pdf',make(number,vat,width,lines))[0];
  const recovered=parse('00876','2520',42),truncated=parse('05066','182',40);
  assert.deepEqual([recovered.invoiceNumber,recovered.vat,recovered.status],['0876',25.2,'ACCEPTED']);
  assert.deepEqual([truncated.invoiceNumber,truncated.vat,truncated.status],['5066','','REJECTED']);
});
test('Maspo VAT comes from a split closing summary and the printed total VAT band row',()=>{
  const split=[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/00616',x:980,y:260},{page:1,text:'MASPO LTD',x:170,y:400},{page:1,text:'Invoice date (taxpoint):',x:165,y:1034},{page:1,text:'08.07.2026',x:1060,y:1030},{page:1,text:'Total GBP',x:1366,y:440},{page:1,text:'1737',x:1709,y:440},{page:1,text:'5291.66',x:1800,y:440},
    {page:2,text:'Invoice no.',x:700,y:260},{page:2,text:'2607-SP/02/00616',x:980,y:260},{page:2,text:'5185.65',x:1537,y:430},{page:2,text:'0.00',x:1675,y:430},{page:2,text:'5185.65',x:1759,y:430},{page:2,text:'63.34',x:1555,y:495},{page:2,text:'17,67',x:1667,y:495},{page:2,text:'106.01',x:1770,y:495},{page:2,text:'Total: 5291,66 GBP',x:170,y:575},{page:2,text:'In words: five thousand two hundred ninety one 66/100',x:170,y:612}
  ];
  const banded=[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2608-LON/08/06349',x:980,y:260},{page:1,text:'MASPO LTD',x:170,y:400},{page:1,text:'Invoice date:',x:165,y:500},{page:1,text:'21.08.2026',x:1060,y:500},{page:1,text:'Tax rate',x:998,y:201},{page:1,text:'Net value',x:1346,y:201},{page:1,text:'Tax value',x:1545,y:201},{page:1,text:'Gross value',x:1728,y:201},{page:1,text:'0%',x:1200,y:245},{page:1,text:'2254,03',x:1392,y:245},{page:1,text:'0,00',x:1643,y:245},{page:1,text:'2254,03',x:1788,y:245},{page:1,text:'20%',x:1200,y:292},{page:1,text:'1196,66',x:1394,y:292},{page:1,text:'239,33',x:1613,y:292},{page:1,text:'1435,99',x:1790,y:292},{page:1,text:'Total:',x:1133,y:336},{page:1,text:'3450,69',x:1393,y:338},{page:1,text:'239,33',x:1613,y:338},{page:1,text:'3690,02',x:1789,y:338},{page:1,text:'Total: 3690,02 GBP',x:170,y:402},{page:1,text:'In words: three thousand six hundred ninety 02/100',x:170,y:452}
  ];
  const extract=lines=>P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO VAT rows.pdf',lines)[0];
  const splitRow=extract(split),bandedRow=extract(banded);
  assert.deepEqual([splitRow.invoiceNumber,splitRow.total,splitRow.vat,splitRow.status],['0616',5291.66,17.67,'ACCEPTED']);
  assert.deepEqual([bandedRow.invoiceNumber,bandedRow.total,bandedRow.vat,bandedRow.status],['6349',3690.02,239.33,'ACCEPTED']);
});
test('Maspo closing VAT table without readable headings rejects partial VAT instead of accepting it',()=>{
  const make=vat=>[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/00616',x:980,y:260},{page:1,text:'MASPO LTD',x:170,y:400},{page:1,text:'Invoice date (taxpoint):',x:165,y:1034},{page:1,text:'08.07.2026',x:1060,y:1030},{page:2,text:'5185.65',x:1537,y:430},{page:2,text:'0.00',x:1675,y:430},{page:2,text:'5185.65',x:1759,y:430},{page:2,text:'63.34',x:1555,y:495},{page:2,text:vat,x:1667,y:495},{page:2,text:'106.01',x:1770,y:495},{page:2,text:'Total: 5291,66 GBP',x:170,y:575},{page:2,text:'In words: five thousand two hundred ninety one 66/100',x:170,y:612}];
  const parse=vat=>P.parseInvoice('MASPO LTD Invoice no. 2607-SP/02/00616 Invoice date (taxpoint): 08.07.2026 Total: 5291,66 GBP In words: five thousand two hundred ninety one 66/100','MASPO.pdf',make(vat));
  const partial=parse('1757');assert.equal(partial.vat,'');assert.equal(partial.retryOcr,true);assert.equal(partial.status,'REJECTED');
  const unreadable=parse('17E7');assert.equal(unreadable.vat,'');assert.equal(unreadable.retryOcr,true);assert.equal(unreadable.status,'REJECTED');
  const complete=parse('17,67');assert.equal(complete.vat,17.67);assert.equal(complete.retryOcr,false);assert.equal(complete.status,'ACCEPTED');
});
test('Maspo recovers fused OCR comma and six only when nearby printed cells confirm its width',()=>{
  const make=(vat,width)=>[
    {page:67,text:'Invoice no.',x:700,y:260},{page:67,text:'2607-SP/02/00616',x:980,y:260},{page:67,text:'Seller MASPO LTD',x:170,y:400},{page:67,text:'Invoice date (taxpoint):',x:165,y:1034},{page:67,text:'08.07.2026',x:1060,y:1030},
    {page:73,text:'Total In GBP',x:1368,y:2446.4},{page:73,text:'0.00',x:1717.6,y:2386.4,width:31.2},{page:73,text:'1757',x:1709.6,y:2446.4,width:40},{page:73,text:'5291.66',x:1802.4,y:2446.4,width:59.2},
    {page:74,text:'0%',x:1461.2,y:429.2},{page:74,text:'5185.65',x:1539.6,y:429.2,width:57.6},{page:74,text:'0.00',x:1677.6,y:430.4,width:31.2},{page:74,text:'5185.65',x:1762,y:430.8,width:57.6},
    {page:74,text:'41',x:1457.6,y:497.6},{page:74,text:'88,34',x:1557.2,y:495.2,width:39.2},{page:74,text:vat,x:1669.6,y:496,width},
    {page:74,text:'Total: 5291,66 GBP',x:175.2,y:571.6},{page:74,text:'In words: five thousand two hundred ninety one 66/100',x:176.8,y:609.2}
  ];
  const parse=(vat,width)=>P.parseInvoice('MASPO LTD Invoice no. 2607-SP/02/00616 Invoice date (taxpoint): 08.07.2026 Total: 5291,66 GBP In words: five thousand two hundred ninety one 66/100','MASPO 0616.pdf',make(vat,width));
  for(const raw of ['17E7','17ß7']){const row=parse(raw,38.4);assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status],['0616',5291.66,17.67,'ACCEPTED']);}
  const noGeometryLines=make('17E7',undefined).filter(line=>line.page!==73),noGeometry=P.parseInvoice('MASPO LTD Invoice no. 2607-SP/02/00616 Invoice date (taxpoint): 08.07.2026 Total: 5291,66 GBP In words: five thousand two hundred ninety one 66/100','MASPO 0616.pdf',noGeometryLines);assert.deepEqual([noGeometry.vat,noGeometry.status],['','REJECTED']);
});
test('Maspo long item tables use the final VAT summary instead of an earlier item VAT',()=>{
  const lines=[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2608-SP/02/02677',x:980,y:260},{page:1,text:'MASPO LTD',x:170,y:400},{page:1,text:'Invoice date (taxpoint):',x:165,y:500},{page:1,text:'19.08.2026',x:1060,y:500},{page:1,text:'4,99',x:1728,y:1100},{page:1,text:'Total in GBP',x:1377,y:1215},{page:1,text:'1474,93',x:1588,y:1215},{page:1,text:'294,99',x:1708,y:1215},{page:1,text:'1769,92',x:1812,y:1215},{page:1,text:'Total: 4074,52 GBP',x:170,y:1428},{page:1,text:'In words: four thousand seventy four 52/100',x:170,y:1464}];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO final summary.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.vat,row.status],['2677',4074.52,294.99,'ACCEPTED']);
});
test('Maspo rejects partial VAT tokens from low-resolution scans and accepts the complete retry',()=>{
  const make=vat=>[{page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2608-SP/02/02677',x:980,y:260},{page:1,text:'MASPO LTD',x:170,y:400},{page:1,text:'Invoice date (taxpoint):',x:165,y:500},{page:1,text:'19.08.2026',x:1060,y:500},{page:1,text:'Total in GBP',x:1377,y:1215},{page:1,text:'3779.53',x:1586,y:1215},{page:1,text:vat,x:1708,y:1215},{page:1,text:'4074.52',x:1810,y:1215},{page:1,text:'0%',x:1508,y:1281},{page:1,text:'304.60',x:1586,y:1281},{page:1,text:'0.00',x:1708,y:1281},{page:1,text:'2304.60',x:1810,y:1281},{page:1,text:'20%',x:1508,y:1349},{page:1,text:'1474.93',x:1587,y:1349},{page:1,text:vat==='294.99'?'294.99':'æ4.99',x:1707,y:1349},{page:1,text:'1769.92',x:1811,y:1349},{page:1,text:'Total: 4074,52 GBP',x:170,y:1428},{page:1,text:'In words: four thousand seventy four 52/100',x:170,y:1464}];
  const parse=vat=>P.parseInvoiceBatch(make(vat).map(line=>line.text).join('\n'),'MASPO 2677.pdf',make(vat))[0];
  const first=parse('æ.99');assert.equal(first.vat,'');assert.equal(first.retryOcr,true);assert.equal(first.status,'REJECTED');
  const retried=parse('294.99');assert.equal(retried.vat,294.99);assert.equal(retried.retryOcr,false);assert.equal(retried.status,'ACCEPTED');
});
test('Maspo shifted summary columns retain small VAT values and correct OCR digit slips',()=>{
  const lines=[
    {page:41,text:'Invoice no.',x:653.6,y:257.2},{page:41,text:'2607-SP/02101634',x:933.2,y:257.2},{page:41,text:'MASPO LTD',x:187.2,y:448},{page:41,text:'Invoice date (taxpoint):',x:181,y:1034},{page:41,text:'15.07.2026',x:1078,y:1034},
    {page:45,text:'Total In GBP',x:1401.2,y:2491.2},{page:45,text:'371224',x:1620,y:2491.2},{page:45,text:'1034',x:1758,y:2491.2},{page:45,text:'372308',x:1852.8,y:2491.2},
    {page:46,text:'0%',x:1500,y:405},{page:46,text:'3658,04',x:1564.4,y:405},{page:46,text:'0,00',x:1682,y:405},{page:46,text:'3658,04',x:1777,y:405},
    {page:46,text:'20%',x:1500,y:475.6},{page:46,text:'54,20',x:1564.4,y:475.6},{page:46,text:'10,84',x:1682,y:475.6},{page:46,text:'65,04',x:1777,y:475.6},
    {page:46,text:'Total: 3723,08 GBP',x:122.4,y:558.8},{page:46,text:'In words: three thousand seven hundred twenty three 08/100',x:124.8,y:597.6}
  ];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO.pdf',lines);
  assert.deepEqual([row.invoiceNumber,row.total,row.subtotal,row.vat,row.status,row.retryOcr],['1634',3723.08,3712.24,10.84,'ACCEPTED',false]);
});
test('Maspo cash receipts, complaint reports and pallet notes are skipped in mixed PDFs',()=>{
  const lines=[
    {page:1,text:'Invoice no.',x:700,y:260},{page:1,text:'2607-SP/02/04001',x:980,y:260},{page:1,text:'MASPO LTD',x:200,y:450},{page:1,text:'Invoice date (taxpoint):',x:200,y:1030},{page:1,text:'29.07.2026',x:1060,y:1025},{page:1,text:'Total: 100,00 GBP',x:170,y:1646},
    {page:2,text:'MASPO FOOD LTD CASH RECEIPT Date 31.07.2026 Invoice 103515/LON/07/2026',x:100,y:200},{page:2,text:'COMPLAINT REPORT',x:100,y:700},{page:2,text:'PALLET NOTE',x:100,y:1200},
    {page:3,text:'Invoice no.',x:700,y:260},{page:3,text:'2607-SP/02/04002',x:980,y:260},{page:3,text:'MASPO LTD',x:200,y:450},{page:3,text:'Invoice date (taxpoint):',x:200,y:1030},{page:3,text:'30.07.2026',x:1060,y:1025},{page:3,text:'Total: 200,00 GBP',x:170,y:1646}
  ];
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'mixed-MASPO.pdf',lines);
  assert.deepEqual(rows.map(row=>row.invoiceNumber),['4001','4002']);assert.ok(rows.every(row=>row.isInvoiceDocument));
  assert.deepEqual(P.parseInvoiceBatch('MASPO FOOD LTD CASH RECEIPT Complaint Report Pallet Note Invoice 103515/LON/07/2026','paperwork.pdf',[
    {page:1,text:'MASPO FOOD LTD CASH RECEIPT Complaint Report Pallet Note Invoice 103515/LON/07/2026',x:100,y:200}
  ]),[]);
});
test('Maspo correction invoices retain the linked invoice, VAT adjustment and revised totals',()=>{
  const lines=[
    {page:1,text:'Invoice correction no.',x:553,y:234},{page:1,text:'2608-SPW02/00372',x:1094,y:229},{page:1,text:'Seller',x:170,y:395},{page:1,text:'MASPO LTD',x:173,y:443},{page:1,text:'27.08.2026',x:1067,y:1026},{page:1,text:'Invoice date (taxpoint):',x:167,y:1035},{page:1,text:'Applies to the Invoice: 2608.SP/02/03905',x:171,y:1307},{page:1,text:'Before correction:',x:175,y:1416},{page:1,text:'Total In GBP',x:1382,y:1673},{page:1,text:'3032.48',x:1600,y:1673},{page:1,text:'0.00',x:1746,y:1673},{page:1,text:'3032.48',x:1834,y:1673},{page:1,text:'After correction:',x:174,y:1806},{page:1,text:'Total In GBP',x:1382,y:2069},{page:1,text:'3024.11',x:1601,y:2069},{page:1,text:'0.00',x:1747,y:2069},{page:1,text:'3024.11',x:1836,y:2069},
    {page:2,text:'Invoice correction no. 2608-SPW02/00372',x:520,y:262},{page:2,text:'Total: -8,37 GBP',x:137,y:423}
  ];
  lines.find(line=>line.text.startsWith('Applies to')) .text='Applies to the Invoice: 2608•SP/02/03905';
  const rows=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO 2.pdf',lines),row=rows[0];
  assert.equal(rows.length,1);assert.deepEqual([row.invoiceNumber,row.date,row.supplier,row.correctsInvoice,row.documentType,row.subtotal,row.vat,row.total,row.correctedVat,row.correctedTotal],['0372','2026-08-27','MASPO','2608.SP/02/03905','CORRECTION','',0,-8.37,0,3024.11]);assert.equal(row.retryOcr,false);
});
test('Maspo does not apply a correction when OCR drops digits from its printed revised total',()=>{
  const lines=[
    {page:1,text:'Invoice correction no.',x:553,y:234},{page:1,text:'2608-SPK/02/00372',x:1094,y:229},{page:1,text:'MASPO LTD',x:173,y:443},{page:1,text:'Invoice date (taxpoint):',x:167,y:1035},{page:1,text:'27.08.2026',x:1067,y:1026},{page:1,text:'Applies to the Invoice: 2608•SP/02/03905',x:171,y:1307},{page:1,text:'Before correction:',x:175,y:1416},{page:1,text:'After correction:',x:174,y:1806},{page:1,text:'Total In GBP',x:1382,y:2069},{page:1,text:'3024,11',x:1601,y:2069},{page:1,text:'0.00',x:1747,y:2069},{page:1,text:'024.11',x:1836,y:2069},{page:1,text:'Total: -8,37 GBP',x:137,y:2410}
  ];
  const [row]=P.parseInvoiceBatch(lines.map(line=>line.text).join('\n'),'MASPO correction scan.pdf',lines);
  assert.equal(row.correctsInvoice,'2608.SP/02/03905');assert.equal(row.correctedVat,0);assert.equal(row.correctedTotal,'');assert.equal(row.retryOcr,true);assert.equal(row.status,'REJECTED');
  const [original,unapplied]=P.reconcileInvoiceCorrections([{invoiceNumber:'2608-SP/02/03905',originalInvoiceNumber:'2608-SP/02/03905',documentType:'INVOICE',total:3032.48,vat:0,subtotal:3032.48},row]);
  assert.equal(original.total,3032.48);assert.equal(unapplied.documentType,'CORRECTION - REVISED VALUES UNREADABLE');
});
test('invoice corrections are reconciled after batch extraction and missing references are listed last',()=>{
  const correction={invoiceNumber:'3588/LON/08/2026',date:'2026-08-20',documentType:'CORRECTION',correctsInvoice:'FS 105363/LON/08/2026',correctedSubtotal:399.25,correctedVat:0,correctedTotal:399.25,subtotal:-17.1,vat:0,total:-17.1,source:'corrections.pdf'};
  const missing={invoiceNumber:'3599/LON/08/2026',date:'2026-08-21',documentType:'CORRECTION',correctsInvoice:'FS 999999/LON/08/2026',correctedVat:0,correctedTotal:20,subtotal:20,vat:0,total:20,source:'corrections.pdf'};
  const laterInvoice={invoiceNumber:'105363/LON/08/2026',date:'2026-08-14',documentType:'INVOICE',subtotal:416.35,vat:0,total:416.35,source:'later.pdf'};
  const earlierInvoice={invoiceNumber:'FS 888888/LON/08/2026',documentType:'INVOICE',subtotal:10,vat:0,total:10};
  const rows=P.reconcileInvoiceCorrections([correction,missing,laterInvoice,earlierInvoice]);
  assert.deepEqual(rows.map(row=>row.invoiceNumber),[laterInvoice.invoiceNumber,earlierInvoice.invoiceNumber,missing.invoiceNumber]);
  assert.deepEqual([rows[0].oldVat,rows[0].oldTotal,rows[0].vat,rows[0].total,rows[0].documentType,rows[0].correctionReference],[0,416.35,0,399.25,'INVOICE (CORRECTED)','3588/LON/08/2026']);
  assert.equal(rows[0].subtotal,399.25);
  assert.equal(rows[2].documentType,'CORRECTION - ORIGINAL NOT FOUND');
  assert.deepEqual([rows[2].oldVat,rows[2].oldTotal,rows[2].vat,rows[2].total,rows[2].accepted],['','',0,20,false]);
  assert.match(rows[2].correctionNote,/999999.*not found/i);
});
test('ambiguous or unreadable invoice corrections are kept as unapplied final rows',()=>{
  const base={invoiceNumber:'123456/LON/08/2026',documentType:'INVOICE',total:100,vat:0,subtotal:100};
  const correction={invoiceNumber:'3588/LON/08/2026',documentType:'CORRECTION',correctsInvoice:'FS 123456/LON/08/2026',correctedVat:0,correctedTotal:90,total:-10,vat:0,subtotal:-10};
  const rows=P.reconcileInvoiceCorrections([base,{...base},correction]);
  assert.equal(rows.length,3);
  assert.equal(rows[2].documentType,'CORRECTION - MULTIPLE MATCHES');
  assert.deepEqual([rows[2].oldVat,rows[2].oldTotal,rows[2].vat,rows[2].total,rows[2].accepted],['','',0,90,false]);
  assert.deepEqual(rows.slice(0,2).map(row=>row.documentType),['INVOICE','INVOICE']);
  const unreadable=P.reconcileInvoiceCorrections([base,{...correction,correctedTotal:'',correctedVat:''}]);
  assert.equal(unreadable[1].documentType,'CORRECTION - REVISED VALUES UNREADABLE');
  assert.equal(unreadable[0].total,100);
});
const metroSampleFiles=['June 2026.pdf','July 2026.pdf','August 2026.pdf'];
test('Metro Bank columnar statements recover transactions and running balances',{skip:!metroSampleFiles.every(file=>fs.existsSync(path.join(__dirname,'..','samples','extractor',file)))},async()=>{
  for(const file of metroSampleFiles){
    const source=path.join(__dirname,'..','samples','extractor',file),r=await P.parsePdf(fs.readFileSync(source),'bank',file);
    assert.ok(r.transactions.length>150,`${file} should contain the statement transactions`);
    assert.ok(r.transactions.every(row=>/^2026-\d{2}-\d{2}$/.test(row.date)),`${file} contains an invalid date`);
    assert.ok(r.transactions.every(row=>typeof row.balance==='number'&&Number.isFinite(row.balance)),`${file} is missing balances`);
    assert.equal(r.transactions.some(row=>/Card Purchase/i.test(row.details)),true);
    assert.equal(r.transactions.some(row=>/Paymentsense Limited/i.test(row.details)),true);
    assert.equal(r.transactions.some(row=>row.details.includes('Statement number')),false);
    assert.equal(r.transactions.some(row=>row.date.startsWith('2080-')),false);
    assert.equal(r.transactions.some(row=>row.review),false);
    for(let i=1;i<r.transactions.length;i++){
      const previous=r.transactions[i-1],current=r.transactions[i],delta=Number((current.balance-previous.balance).toFixed(2));
      assert.equal(delta,current.amount,`${file} row ${i+1} amount does not reconcile to its balance`);
    }
    const dvla=r.transactions.find(row=>/Direct Debit DVLA-EX24ZRR/i.test(row.details));
    const standing=r.transactions.find(row=>/Standing Order GARROD AND CO LTD/i.test(row.details));
    assert.equal(dvla?.payment,54.25,`${file} DVLA amount`);
    assert.equal(standing?.payment,228,`${file} standing-order amount`);
  }
});
test('Deens Produce scan extracts each printed invoice once with the correct page and total',{skip:process.env.CLEARCOUNT_RUN_DEENS_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Deens Produce.pdf'))},()=>{
  const fixture=path.resolve(__dirname,'../samples/extractor/Invoices/Deens Produce.pdf'),shortPath=path.resolve(__dirname,`../.tmp/deens-test-${process.pid}.pdf`),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  fs.mkdirSync(path.dirname(shortPath),{recursive:true});fs.copyFileSync(fixture,shortPath);
  try{
    const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',shortPath,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:40*1024*1024});
    const pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines);
    const expected=[
      [1,'36163','2026-07-30',132],[2,'35765','2026-07-06',104],[4,'35812','2026-07-09',89.5],[5,'35869','2026-07-13',140.5],[6,'35932','2026-07-16',106.5],
      [7,'35990','2026-07-20',98],[9,'36047','2026-07-23',153.5],[10,'36090','2026-07-27',111],[11,'36226','2026-08-03',79.5],[12,'36276','2026-08-06',129.5],
      [13,'36325','2026-08-10',73.5],[14,'36392','2026-08-13',93.5],[15,'36436','2026-08-17',115],[16,'36505','2026-08-20',144.5],[17,'36552','2026-08-24',188],
      [18,'36609','2026-08-27',88],[19,'36680','2026-08-31',152.5],[20,'36750','2026-09-03',116.5],[21,'36786','2026-09-07',128.5],[22,'36853','2026-09-10',137.5],
      [23,'36919','2026-09-14',125],[24,'36981','2026-09-17',207.5],[25,'37044','2026-09-21',64],[26,'37054','2026-09-22',0],[27,'37159','2026-09-28',112.5]
    ];
    assert.equal(rows.length,expected.length,'blank pages must not produce invoice rows');
    assert.deepEqual(rows.map(row=>[row.page,row.originalInvoiceNumber,row.date,row.total,row.vat,row.supplier,row.status,row.profileId]),expected.map(([page,number,date,total])=>[page,number,date,total,0,'Deens Produce Ltd','ACCEPTED','deens-produce']));
    assert.equal(new Set(rows.map(row=>`${row.supplier}:${row.originalInvoiceNumber}:${row.date}`)).size,rows.length,'invoice pages must not duplicate records');
  }finally{fs.rmSync(shortPath,{force:true});}
});
test('Peterborough Bazaar scan extracts every unique printed invoice and retries its faint VAT footer',{skip:process.env.CLEARCOUNT_RUN_PETERBOROUGH_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Peterborough Bazaar.pdf'))},()=>{
  const fixture=path.resolve(__dirname,'../samples/extractor/Invoices/Peterborough Bazaar.pdf'),shortPath=path.resolve(__dirname,`../.tmp/pb-test-${process.pid}.pdf`),helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1');
  fs.mkdirSync(path.dirname(shortPath),{recursive:true});fs.copyFileSync(fixture,shortPath);
  try{
    const scan=scale=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',shortPath,'-Scale',String(scale),...(scale>=4.5?['-PageList','31']:[])],{encoding:'utf8',windowsHide:true,maxBuffer:40*1024*1024}),parse=raw=>{const pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]);return {pages,lines,rows:P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),fixture,lines)};};
    const first=parse(scan(2.5)),expected=[
      [1,'0279659','2026-09-28',173.80,23.37],[2,'0279660','2026-09-28',18.93,0],[3,'0278751','2026-09-19',63.90,2.82],[4,'0278163','2026-09-14',111.41,8.93],
      [5,'0278464','2026-09-17',35.05,0],[6,'0278462','2026-09-17',142.57,13.73],[7,'0277564','2026-09-09',142.60,4.96],[8,'0276686','2026-09-01',55.98,0],
      [10,'0277047','2026-09-04',137.00,3.60],[12,'0276286','2026-08-28',87.25,2.07],[13,'0276474','2026-08-30',17.00,0],[14,'0276287','2026-08-28',99.45,2.35],
      [15,'0275597','2026-08-22',95.60,7.44],[16,'0275926','2026-08-25',85.60,0],[17,'0275300','2026-08-20',132.60,0],[19,'0274847','2026-08-15',81.25,0],
      [20,'0275084','2026-08-18',21.00,0],[21,'0274732','2026-08-14',119.85,0],[22,'0274418','2026-08-12',18.50,0],[23,'0273337','2026-08-03',492.11,14.03],
      [24,'0274019','2026-08-08',110.80,0],[25,'0274146','2026-08-10',425.50,12.50],[26,'0269883','2026-07-06',292.64,23.22],[27,'0270107','2026-07-07',9.50,0],
      [28,'0270960','2026-07-14',220.01,10.29],[29,'0270662','2026-07-11',69.50,2.16],[30,'0271645','2026-07-20',253.38,18.20],[31,'0272493','2026-07-27',256.45,14.74]
    ];
    assert.equal(first.pages.length,31);assert.ok(first.pages.every(page=>page.ocrLanguage==='en-GB'),'all PCs must use the same UK English OCR recognizer');assert.equal(first.rows.length,expected.length,'blank handwritten pages and the duplicated invoice page must not create rows');
    assert.deepEqual(first.rows.map(row=>[row.page,row.originalInvoiceNumber,row.date,row.total,row.vat]),expected.map(([page,number,date,total,vat])=>[page,number,date,total,page===31?'':vat]));
    assert.ok(first.rows.slice(0,-1).every(row=>row.supplier==='Peterborough Bazaar Limited'&&row.status==='ACCEPTED'&&row.profileId==='peterborough-bazaar'));
    assert.deepEqual([first.rows.at(-1).supplier,first.rows.at(-1).total,first.rows.at(-1).vat,first.rows.at(-1).status,first.rows.at(-1).retryOcr],['Peterborough Bazaar Limited',256.45,'','REJECTED',true]);
    const retry=parse(scan(5)),retried=retry.rows.find(row=>row.page===31);assert.ok(retry.pages.every(page=>page.ocrLanguage==='en-GB'));
    assert.ok(retried,'the focused retry must keep the source page attached');
    assert.deepEqual([retried.originalInvoiceNumber,retried.invoiceNumber,retried.date,retried.vat,retried.total,retried.status],['0272493','2493','2026-07-27',14.74,256.45,'ACCEPTED']);
    assert.equal(new Set(first.rows.map(row=>`${row.profileId}:${row.originalInvoiceNumber}:${row.date}`)).size,first.rows.length);
  }finally{fs.rmSync(shortPath,{force:true});}
});
test('Eagle Foods scans extract known invoice totals from both layouts and reject conflicting statement evidence',{skip:process.env.CLEARCOUNT_RUN_EAGLE_OCR!=='1'||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Eagle Foods/Eagelfoods.pdf'))||!fs.existsSync(path.resolve(__dirname,'../samples/extractor/Invoices/Eagle Foods/Eagelfoods 1.pdf'))},()=>{
  const helper=path.resolve(__dirname,'../extractor/ocr-helper.ps1'),fixtures=[
    {file:'Eagelfoods.pdf',expected:[['143871','2026-08-31',1880.40,52.51],['145417','2026-09-21',2041.12,59.58],['145755','2026-09-25',1404.84,21.83]],summaryPages:[5,28]},
    {file:'Eagelfoods 1.pdf',expected:[['144223','2026-09-04',1993.32,35.30],['141787','2026-08-02',37.16,0],['143668','2026-08-28',1697.31,18.92],['143181','2026-08-25',1819.30,0],['144720','2026-09-11',1777.39,43.03],['144885','2026-09-14',1681.19,43.32],['143868','2026-08-30',100.37,0]],summaryPages:[7,8,9,10,11,12,13,14,15,16,18,19,23,50,51,52,53]}
  ];
  for(const fixture of fixtures){const source=path.resolve(__dirname,`../samples/extractor/Invoices/Eagle Foods/${fixture.file}`),shortPath=path.resolve(__dirname,`../.tmp/eagle-${process.pid}-${fixture.file.replace(/\W+/g,'-')}.pdf`);fs.mkdirSync(path.dirname(shortPath),{recursive:true});fs.copyFileSync(source,shortPath);try{const raw=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',shortPath,'-Scale','2.5'],{encoding:'utf8',windowsHide:true,maxBuffer:50*1024*1024}),pages=raw.split(/\r?\n/).filter(line=>line.startsWith('PAGE:')).map(line=>JSON.parse(line.slice(5))),lines=pages.flatMap(page=>page.lines||[]),rows=P.parseInvoiceBatch(pages.map(page=>page.text||'').join('\n'),source,lines),identified=rows.filter(row=>String(row.originalInvoiceNumber||'').replace(/\D/g,'').length>=4),byNumber=new Map(rows.map(row=>[String(row.originalInvoiceNumber||'').replace(/\D/g,''),row]));assert.equal(identified.length,new Set(identified.map(row=>`${String(row.originalInvoiceNumber).replace(/\D/g,'')}:${row.date||''}`)).size,`${fixture.file} should not duplicate identified invoices`);for(const [number,date,total,vat] of fixture.expected){const row=byNumber.get(number);assert.ok(row,`${fixture.file} should extract invoice ${number}`);assert.deepEqual([row.date,row.total,row.vat,row.status],[date,total,vat,'ACCEPTED'],`${fixture.file} invoice ${number}`);}assert.ok(rows.every(row=>!(row.sourcePages||[]).some(page=>fixture.summaryPages.includes(page))),`${fixture.file} statement pages must not become invoices`);if(fixture.file==='Eagelfoods 1.pdf'){const conflict=rows.find(row=>row.originalInvoiceNumber==='144408');assert.equal(conflict?.status,'REJECTED');assert.ok(conflict?.eagleSummaryConflict);}}finally{fs.rmSync(shortPath,{force:true});}}
});
