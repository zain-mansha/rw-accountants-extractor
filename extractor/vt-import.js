(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.VtWorkbookImport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const normalizeHeader=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const aliases={
    invoiceNumber:['invoicenumber','invoiceno','invoicereference','refno','reference'],
    date:['invoicedate','date'],
    supplier:['supplier','suppliername','account','company','payee'],
    vat:['vat','vatamount','tax'],
    total:['total','gross','grossamount','invoicetotal'],
    status:['status','result'],
    documentType:['documenttype','type'],
    reason:['rejectionreason','reason','reviewnote'],
    source:['sourcepdf','source','filename'],
    page:['pdfpage','page'],
    fuelAmount:['expensesfuel','fuel','fuelamount','expensefuel'],
    drawingsAmount:['capitalaccountdrawings','drawings','drawingsamount'],
    category:['category'],
    correctsInvoice:['correctsinvoice','correctedinvoice'],
    correctionReference:['correctionreference','correctionref'],
    oldVat:['oldvat'],
    oldTotal:['oldtotal']
  };
  function money(value){
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(value===null||value===undefined||String(value).trim()==='')return null;
    let raw=String(value).trim().replace(/[£$€\s]/g,''),negative=/^\(.*\)$/.test(raw);
    raw=raw.replace(/[()]/g,'');
    const comma=raw.lastIndexOf(','),dot=raw.lastIndexOf('.');
    if(comma>=0&&dot>=0){raw=raw.replace(/[.,]/g,'');raw=raw.slice(0,-2)+'.'+raw.slice(-2);}
    else if(comma>=0){const tail=raw.length-comma-1;raw=tail===2?raw.replace(',','.'):raw.replace(/,/g,'');}
    else raw=raw.replace(/,/g,'');
    const parsed=Number(raw);return Number.isFinite(parsed)?(negative?-Math.abs(parsed):parsed):null;
  }
  function date(value){
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
    if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=2958465)return new Date(Date.UTC(1899,11,30)+Math.round(value*86400000)).toISOString().slice(0,10);
    const raw=String(value??'').trim();if(!raw)return '';
    const valid=(year,month,day)=>{const result=new Date(Date.UTC(year,month-1,day));return result.getUTCFullYear()===year&&result.getUTCMonth()+1===month&&result.getUTCDate()===day?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';};
    let match=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(match)return valid(Number(match[1]),Number(match[2]),Number(match[3]));
    match=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);if(match)return valid(Number(match[3]),Number(match[2]),Number(match[1]));
    return '';
  }
  function status(value,type){
    const normalized=String(value??'').trim().toUpperCase();
    if(normalized==='ACCEPT'||normalized==='OK')return 'ACCEPTED';
    if(normalized==='ACCEPTED')return 'ACCEPTED';
    return 'REJECTED';
  }
  function findHeaderRow(matrix){
    for(let row=0;row<Math.min(matrix.length,12);row++){
      const values=(matrix[row]||[]).map(normalizeHeader);
      const hasInvoice=aliases.invoiceNumber.some(alias=>values.includes(alias));
      const hasAmount=aliases.total.some(alias=>values.includes(alias));
      const hasReceiptAmounts=aliases.fuelAmount.some(alias=>values.includes(alias))||aliases.drawingsAmount.some(alias=>values.includes(alias));
      const legacyReceipt=!hasInvoice&&values.includes('company')&&values.includes('category')&&values.includes('status');
      if(hasAmount&&(hasInvoice||hasReceiptAmounts||legacyReceipt))return row;
    }
    return -1;
  }
  function recordsFromMatrix(matrix){
    const headerRow=findHeaderRow(matrix||[]);
    if(headerRow<0)throw new Error('No supported table found. Choose an Extractor workbook with Invoice number and Total columns, or a fuel receipt report with Total and Company.');
    const headers=(matrix[headerRow]||[]).map(normalizeHeader),columns={};
    for(const [field,names] of Object.entries(aliases))columns[field]=headers.findIndex(header=>names.includes(header));
    const sourceHeaders=(matrix[headerRow]||[]).map(normalizeHeader),hasReceiptAmounts=columns.fuelAmount>=0||columns.drawingsAmount>=0,legacyReceipt=columns.invoiceNumber<0&&sourceHeaders.includes('company')&&sourceHeaders.includes('category')&&sourceHeaders.includes('status'),receiptTable=columns.invoiceNumber<0&&(hasReceiptAmounts||legacyReceipt);
    if(columns.total<0||(!receiptTable&&columns.invoiceNumber<0))throw new Error('Choose an Extractor invoice workbook with Invoice number and Total columns, or a fuel receipt workbook with Total and Company.');
    const records=[];
    for(const cells of matrix.slice(headerRow+1)){
      const cell=field=>columns[field]>=0?cells?.[columns[field]]:'';
      const values=Object.fromEntries(Object.keys(aliases).map(field=>[field,cell(field)]));
      if(Object.values(values).every(value=>value===null||value===undefined||String(value).trim()===''))continue;
      const total=money(values.total),documentType=String(values.documentType||(receiptTable?'FUEL RECEIPT':'INVOICE')).trim().toUpperCase(),reason=String(values.reason||'').trim(),isFuelReceipt=documentType.includes('FUEL RECEIPT')||receiptTable,fuelAmount=columns.fuelAmount>=0?money(values.fuelAmount):isFuelReceipt?total:null;
      const row={
        invoiceNumber:String(values.invoiceNumber??'').trim(),date:date(values.date),supplier:String(values.supplier??'').trim(),
        vat:columns.vat>=0?money(values.vat):isFuelReceipt?0:null,total,fuelAmount,drawingsAmount:money(values.drawingsAmount),isFuelReceipt,
        status:status(values.status,documentType),documentType,
        source:String(values.source??'').trim(),page:String(values.page??'').trim(),reason,
        correctsInvoice:String(values.correctsInvoice??'').trim(),correctionReference:String(values.correctionReference??'').trim(),
        oldVat:money(values.oldVat),oldTotal:money(values.oldTotal),
        vatUnverified:/placeholder|unconfirmed|could not be confirmed|unreadable/i.test(reason)
      };
      records.push(row);
    }
    if(!records.length)throw new Error('The invoice table was found, but it contains no invoice rows.');
    return records;
  }
  return {recordsFromMatrix,findHeaderRow,date,money,status};
});
