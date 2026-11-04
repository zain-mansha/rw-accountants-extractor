(function(root,factory){
  const parser=typeof module==='object'&&module.exports?require('./parser.js'):root.FareExtractorParser;
  const api=factory(parser);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.VtInvoiceExport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(parser){
  'use strict';
  const headers=['Type','Ref no','Date','Primary account','Details','Total','VAT','Analysis','Analysis account','Entry details'];
  const numeric=value=>value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value));
  const text=value=>String(value??'').trim();
  const typeOf=row=>text(row['Document type']??row.documentType).toUpperCase();
  const statusOf=row=>text(row.Status??row.status).toUpperCase();
  const invoiceNumberOf=row=>text(row['Invoice number']??row.invoiceNumber);
  const isFuelReceipt=row=>row?.isFuelReceipt===true||typeOf(row).includes('RECEIPT');
  const totalOf=row=>row.Total??row.total;
  const vatOf=row=>row.VAT??row.vat;
  const dateOf=row=>row['Invoice date']??row.date??'';
  const fuelAmountOf=row=>row['Expenses: Fuel']??row.fuelAmount;
  const drawingsAmountOf=row=>row['Capital Account: Drawings']??row.drawingsAmount;
  const otherAmountOf=row=>row.otherAmount??drawingsAmountOf(row);
  const handlingOf=row=>text(row.handling).toLowerCase()==='taxi-driver'?'taxi-driver':'company';
  const vatSplitOf=row=>row.vatSplit===true||/^(?:yes|true|1)$/i.test(text(row.vatSplit));
  const standardRateOf=row=>row.standardRate??row['Standard Rate'];
  const zeroRateOf=row=>row.zeroRate??row['Zero rate'];
  const cents=value=>Math.round(Number(value)*100);
  function supplierName(value){
    const name=text(value),key=name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
    if(key==='maspo'||key==='maspo food ltd')return 'Maspo Food Ltd';
    if(key==='polish village bread'||key==='polish village bread ltd')return 'Polish Village Bread';
    return name;
  }
  const supplierOf=row=>supplierName(row.Supplier??row.supplier);
  function sortBySupplier(records){
    const collator=new Intl.Collator(undefined,{sensitivity:'base',numeric:true});
    return (records||[]).map((record,index)=>({record,index,name:supplierOf(record)})).sort((a,b)=>{
      if(!a.name&&b.name)return 1;
      if(a.name&&!b.name)return -1;
      return collator.compare(a.name,b.name)||a.index-b.index;
    }).map(item=>item.record);
  }
  const sourceOf=row=>text(row['Source PDF']??row.source);
  const pageOf=row=>{
    const raw=text(row['PDF / page']??row.page);
    const match=raw.match(/page\s+(\d+)/i);
    return match?Number(match[1]):Number(row.page)||0;
  };
  const isCreditNote=row=>typeOf(row).includes('CREDIT NOTE');
  const usable=row=>{
    if(statusOf(row)!=='ACCEPTED'||row.vatUnverified===true||!supplierOf(row)||!numeric(totalOf(row))||!numeric(vatOf(row))||dateOf(row)==='')return false;
    if(!isFuelReceipt(row))return Boolean(invoiceNumberOf(row));
    const fuel=fuelAmountOf(row),other=otherAmountOf(row),taxi=handlingOf(row)==='taxi-driver';
    if(vatSplitOf(row)){
      const standard=numeric(standardRateOf(row))?cents(standardRateOf(row)):0,zero=numeric(zeroRateOf(row))?cents(zeroRateOf(row)):0;
      if(!numeric(vatOf(row))||standard+zero+cents(vatOf(row))!==cents(totalOf(row)))return false;
      if(taxi&&numeric(fuel)&&numeric(other)&&cents(fuel)>0&&cents(other)>0)return false;
      return true;
    }
    const otherCents=numeric(other)?cents(other):0;
    return numeric(fuel)&&(!text(other)||numeric(other))&&cents(fuel)+otherCents===cents(totalOf(row));
  };
  function referenceOf(row){return isFuelReceipt(row)?`Receipt${pageOf(row)?` page ${pageOf(row)}`:''}`:invoiceNumberOf(row);}
  function exclusionReason(row){
    const status=statusOf(row),type=typeOf(row);
    if(row.vatUnverified===true)return 'VAT is not confirmed. The Invoices sheet shows a numeric 0.00 placeholder; enter the verified amount before posting.';
    if(status!=='ACCEPTED')return `${status||'UNCLASSIFIED'} record; resolve it before entering in VT.`;
    if(type.includes('CORRECT'))return 'Corrected invoice; confirm how the existing VT posting should be amended before entering it.';
    if(isFuelReceipt(row)){
      if(vatSplitOf(row)){
        if(handlingOf(row)==='taxi-driver'&&numeric(fuelAmountOf(row))&&numeric(otherAmountOf(row))&&cents(fuelAmountOf(row))>0&&cents(otherAmountOf(row))>0)return 'The printed VAT summary does not show how VAT is split between fuel and shop purchases. Turn off rate splitting for this mixed taxi-driver receipt.';
        if(!numeric(standardRateOf(row))&&!numeric(zeroRateOf(row)))return 'Standard and zero rate values are missing.';
        if(!numeric(vatOf(row))||cents(standardRateOf(row)||0)+cents(zeroRateOf(row)||0)+cents(vatOf(row))!==cents(totalOf(row)))return 'The VAT rate split does not match the printed receipt total.';
      }else{
        if(!numeric(fuelAmountOf(row))||!text(otherAmountOf(row))&&!numeric(fuelAmountOf(row)))return 'Fuel and other transaction amounts are missing.';
        if(text(otherAmountOf(row))&&!numeric(otherAmountOf(row)))return 'Other transaction amount is not a valid number.';
        if(numeric(fuelAmountOf(row))&&cents(fuelAmountOf(row))+(numeric(otherAmountOf(row))?cents(otherAmountOf(row)):0)!==cents(totalOf(row)))return 'Fuel and other transaction amounts do not add up to the printed receipt total.';
      }
      if(!dateOf(row)||!supplierOf(row)||!numeric(totalOf(row)))return 'A required company, date or total is missing.';
      return 'Not included in the VT batch.';
    }
    if(!numeric(vatOf(row)))return 'VAT is not confirmed. The Invoices sheet shows a numeric 0.00 placeholder; correct it before posting.';
    if(!numeric(totalOf(row))||!dateOf(row)||!supplierOf(row)||!invoiceNumberOf(row))return 'A required supplier, invoice number, date or total is missing.';
    return 'Not included in the VT batch.';
  }
  function makeVtUisRows(records){
    const output=[headers];
    for(const row of sortBySupplier(records)){
      if(!usable(row))continue;
      const credit=isCreditNote(row),sourceTotal=Number(totalOf(row)),sourceVat=Number(vatOf(row));
      if(isFuelReceipt(row)){
        const total=sourceTotal,vat=sourceVat,fuel=Number(fuelAmountOf(row)),other=numeric(otherAmountOf(row))?Number(otherAmountOf(row)):0,details=referenceOf(row),analysis=[],taxi=handlingOf(row)==='taxi-driver';
        if(vatSplitOf(row)){
          const standard=Number(standardRateOf(row)||0),zero=Number(zeroRateOf(row)||0),defaultAccount=taxi?(fuel>0?'Expenses: Fuel':'Capital Account: Drawings'):'';
          if(standard!==0)analysis.push({amount:standard,account:defaultAccount,label:'Standard rate'});
          if(zero!==0)analysis.push({amount:zero,account:defaultAccount,label:'Zero rate'});
        }else if(taxi){
          if(fuel!==0)analysis.push({amount:fuel,account:'Expenses: Fuel',label:'Fuel'});
          if(other!==0)analysis.push({amount:other,account:'Capital Account: Drawings',label:'Other purchase'});
        }else{
          if(fuel!==0)analysis.push({amount:fuel,account:'',label:'Fuel transaction'});
          if(other!==0)analysis.push({amount:other,account:'',label:'Other transaction'});
        }
        analysis.forEach((line,index)=>output.push(index===0
          ?['PIN','',dateOf(row),supplierOf(row),details,total,vat,line.amount,line.account,`${details} | ${line.label}`]
          :['','','','','','','',line.amount,line.account,`${details} | ${line.label}`]));
        continue;
      }
      // VT applies the transaction sign from PIN/PCR, so credit note values are entered as positive amounts.
      const total=credit?Math.abs(sourceTotal):sourceTotal,vat=credit?Math.abs(sourceVat):sourceVat;
      const rates=parser.invoiceRateBases(total,vat,typeOf(row));
      const analysis=[];
      if(numeric(rates.standardRate)&&Number(rates.standardRate)!==0)analysis.push({amount:Number(rates.standardRate),label:'Standard rate'});
      if(numeric(rates.zeroRate)&&Number(rates.zeroRate)!==0)analysis.push({amount:Number(rates.zeroRate),label:'Zero rate'});
      if(!analysis.length)analysis.push({amount:Math.round((total-vat)*100)/100,label:'Net'});
      analysis.forEach(line=>{line.account=line.label==='Standard rate'||(line.label==='Net'&&vat!==0)?'Cost of Sales: Standard Rated Purchases':'Cost of Sales: Zero Rated Purchases';});
      const invoiceRef=invoiceNumberOf(row),documentType=typeOf(row),label=credit?'Credit note':documentType.includes('CORRECT')?'Corrected invoice':documentType==='DELIVERY NOTE'?'Delivery note':'Invoice',details=`${label} ${invoiceRef}`;
      analysis.forEach((line,index)=>output.push(index===0
        ?[credit?'PCR':'PIN','',dateOf(row),supplierOf(row),details,total,vat,line.amount,line.account,`${details} | ${line.label}`]
        :['','','','','','','',line.amount,line.account,`${details} | ${line.label}`]));
    }
    return output;
  }
  function makeVtExcludedRows(records){
    return [['Invoice / receipt reference','Date','Supplier / company','VAT','Total','Status','Document type','Reason','Source PDF','PDF / page'],...sortBySupplier(records).filter(row=>!usable(row)).map(row=>[
      referenceOf(row),dateOf(row),supplierOf(row),numeric(vatOf(row))?Number(vatOf(row)):0,numeric(totalOf(row))?Number(totalOf(row)):'',statusOf(row),typeOf(row),exclusionReason(row),sourceOf(row),pageOf(row)||''
    ])];
  }
  function exportVat(row){return numeric(row?.vat)?Number(row.vat):0;}
  function hideReferenceColumn(sheet){
    const columns=sheet['!cols']||[];
    columns[1]={...(columns[1]||{}),hidden:true,wch:10};
    sheet['!cols']=columns;
    return sheet;
  }
  return {headers,makeVtUisRows,makeVtExcludedRows,exclusionReason,exportVat,usable,isFuelReceipt,sortBySupplier,supplierName,hideReferenceColumn};
});
