/* Fare Extractor - small, dependency-free PDF text and bookkeeping parser. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FareExtractorParser=factory();})(typeof self!=='undefined'?self:this,()=>{
  'use strict';
  const dec=new TextDecoder('utf-8');
  const latin=new TextDecoder('latin1');
  function bytesToLatin(bytes){return latin.decode(bytes);}
  function unescapePdf(s){return s.replace(/\\([\\()nrtbf])/g,(_,c)=>({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[c]||c)).replace(/\\(\d{1,3})/g,(_,n)=>String.fromCharCode(parseInt(n,8))).replace(/\\\r?\n/g,'');}
  function hexText(s){const raw=s.slice(1,-1).replace(/\s/g,'');let out='';for(let i=0;i+1<raw.length;i+=2){const n=parseInt(raw.slice(i,i+2),16);if(n>=32&&n<127)out+=String.fromCharCode(n);else if(n===10||n===13)out+=' ';}return out;}
  function tokenText(token){if(token[0]==='(')return unescapePdf(token.slice(1,-1));if(token[0]==='<')return hexText(token);return '';}
  function textFromOperators(raw){
    const source=String(raw||''),out=[],length=source.length;
    const readString=start=>{
      const opener=source[start];if(opener==='('){let depth=1,index=start+1;while(index<length){const char=source[index];if(char==='\\'){index+=source[index+1]==='\r'&&source[index+2]==='\n'?3:2;continue;}if(char==='(')depth++;else if(char===')'&&--depth===0)return {raw:source.slice(start,index+1),end:index+1};index++;}return null;}
      if(opener!=='<'||source[start+1]==='<')return null;const end=source.indexOf('>',start+1);return end<0?null:{raw:source.slice(start,end+1),end:end+1};
    };
    const skipSpace=index=>{while(index<length&&/\s/.test(source[index]))index++;return index;};
    const operatorAt=(index,word)=>source.slice(index,index+word.length)===word&&!/[A-Za-z]/.test(source[index+word.length]||'');
    for(let index=0;index<length;){
      if(source[index]==='['){
        const values=[];let cursor=index+1,closed=false;
        while(cursor<length){
          const char=source[cursor];if(char===']'){closed=true;cursor++;break;}
          if(char==='('||char==='<'&&source[cursor+1]!=='<'){const token=readString(cursor);if(!token)break;values.push(token.raw);cursor=token.end;continue;}
          cursor++;
        }
        if(!closed){break;}
        const operator=skipSpace(cursor);if(operatorAt(operator,'TJ')){const value=values.map(tokenText).join('').replace(/\s+/g,' ').trim();if(value)out.push(value);index=operator+2;continue;}
        index=cursor;continue;
      }
      if(source[index]==='('||source[index]==='<'&&source[index+1]!=='<'){
        const token=readString(index);if(!token){break;}
        const operator=skipSpace(token.end),isSingle=source[operator]==="'"||source[operator]==='"';
        if(operatorAt(operator,'Tj')||isSingle){const value=tokenText(token.raw).replace(/\s+/g,' ').trim();if(value)out.push(value);index=operator+(isSingle?1:2);continue;}
        index=token.end;continue;
      }
      index++;
    }
    return out.join(' ').replace(/\s+/g,' ').trim();
  }
  function positionedTextFromOperators(raw){
    const source=bytesToLatin(raw),items=[];let x=0,y=0,m;
    const operators=/(?:(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td)|(?:\((?:\\.|[^\\)])*\)\s*(?:Tj|['"]))/g;
    while((m=operators.exec(source))){
      if(m[1]!==undefined){x+=Number(m[1]);y+=Number(m[2]);continue;}
      const token=m[0].slice(0,m[0].lastIndexOf(')')+1),value=tokenText(token).replace(/\s+/g,' ').trim();
      if(value)items.push({text:value,x,y});
    }
    return items;
  }
  async function inflate(data){
    if(typeof process!=='undefined'&&process.versions?.node){const z=require('node:zlib');return new Uint8Array(z.inflateSync(Buffer.from(data)));}
    if(typeof DecompressionStream==='undefined')return data;
    const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function extractText(input){
    // Find stream boundaries in the original bytes. Decoding compressed bytes as
    // latin1 first corrupts a handful of values in Node (the label maps to
    // Windows-1252), which makes otherwise valid Flate streams impossible to inflate.
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),source=bytesToLatin(bytes),streams=[];
    const marker=(word,start)=>{for(let i=start;i<=bytes.length-word.length;i++){let ok=true;for(let j=0;j<word.length;j++)if(bytes[i+j]!==word.charCodeAt(j)){ok=false;break;}if(ok)return i;}return -1;};
    let cursor=0;
    const positionedStreams=[];
    while(cursor<bytes.length){
      const streamPos=marker('stream',cursor);if(streamPos<0)break;
      let dataStart=streamPos+6;if(bytes[dataStart]===13&&bytes[dataStart+1]===10)dataStart+=2;else if(bytes[dataStart]===10||bytes[dataStart]===13)dataStart+=1;
      const endPos=marker('endstream',dataStart);if(endPos<0)break;
      const before=source.slice(Math.max(0,streamPos-700),streamPos);let raw=bytes.slice(dataStart,endPos);
      // A PDF stream may have a line break immediately before endstream.
      while(raw.length&&(raw[raw.length-1]===10||raw[raw.length-1]===13))raw=raw.slice(0,-1);
      // Image streams can be several megabytes of arbitrary bytes. They do
      // not contain PDF text operators; scanning them with the text regex can
      // overflow the JavaScript regex stack before OCR gets a chance to run.
      if(/\/Subtype\s*\/Image\b/.test(before)){cursor=endPos+9;continue;}
      if(/\/FlateDecode/.test(before)){try{raw=await inflate(raw);}catch{cursor=endPos+9;continue;}}
      const streamText=textFromOperators(bytesToLatin(raw));
      if(streamText){streams.push(streamText);positionedStreams.push(positionedTextFromOperators(raw));}
      cursor=endPos+9;
    }
    const text=streams.filter(Boolean).join('\n').replace(/[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/g,' ').replace(/\s+\n/g,'\n');
    return {text,pages:Math.max(1,(source.match(/\/Type\s*\/Page\b/g)||[]).length),hasText:text.trim().length>0,pageItems:positionedStreams};
  }
  function parseDate(value){
    const s=String(value||'').trim();let m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(!m)m=s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);if(!m){const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12},words=s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})$/i);if(words){const month=months[words[2].slice(0,3).toLowerCase()];if(month)m=[null,words[1],month,words[3]];}}if(!m)return '';let y,day,month;if(m[1].length===4){y=Number(m[1]);month=Number(m[2]);day=Number(m[3]);}else{day=Number(m[1]);month=Number(m[2]);y=Number(m[3])<100?2000+Number(m[3]):Number(m[3]);}if(!Number.isInteger(y)||y<1900||y>2100||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return '';const parsed=new Date(Date.UTC(y,month-1,day));if(parsed.getUTCFullYear()!==y||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)return '';return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function amount(value){let s=String(value??'').replace(/[\u00A3$\u20AC\s]/g,'').replace(/,/g,'');if(!s)return null;const negative=/^\(.*\)$/.test(s)||/-/.test(s)||/\b(?:DR|DEBIT)\b/i.test(s);s=s.replace(/[()]/g,'').replace(/[^\d.-]/g,'');const n=Number(s);return Number.isFinite(n)?(negative?-1:1)*Math.abs(n):null;}
  function invoiceAmount(value){let s=String(value??'').trim();if(!s)return null;const negative=/^\(.*\)$/.test(s)||/-/.test(s)||/\b(?:DR|DEBIT)\b/i.test(s);s=s.replace(/[^\d\s,;.()\-]/g,'').replace(/[()]/g,'').replace(/\s+/g,' ').trim();if(/^-?\d{1,3}(?:[\s,]\d{3})+[.,;]\d{2}$/.test(s)){s=s.replace(/[\s,](?=\d{3}(?:[.,;]|$))/g,'').replace(/[;,]/,'.');}else if(/^-?\d+[.,;]\s*\d{2}$/.test(s)){s=s.replace(/[.,;]\s*/,'.');}else s=s.replace(/[\s,;]/g,'');const n=Number(s);return Number.isFinite(n)?(negative?-1:1)*Math.abs(n):null;}
  function moneyTokens(line){return [...String(line).matchAll(/(?:[\u00A3$\u20AC]\s*)?\(?-?\d[\d,]*(?:\.\d{2})\)?(?:\s*(?:CR|DR))?/gi)].map(m=>({raw:m[0],value:amount(m[0]),index:m.index})).filter(x=>x.value!==null);}
  function lines(text){return text.split(/\r?\n|(?=\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\b)/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);}
  const metroTransactionTypes=['Inward Payment','BACS Payment Received','Cash Deposit','Card Purchase','Outward Faster Payment','Direct Debit','Standing Order','Cheque Issued','Account to Account Transfer','Credit Card Payment-Thank You','Cash Exchange Charges','Account Maintenance Fee','Transaction Charges'];
  function metroDescriptions(value){
    const source=String(value||'').replace(/\s+/g,' ').trim();
    if(!source)return [];
    const escaped=metroTransactionTypes.map(type=>type.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    const marker=new RegExp(`(?=${escaped.join('|')})`,'g');
    return source.split(marker).map(item=>item.trim()).filter(item=>metroTransactionTypes.some(type=>item.startsWith(type)));
  }
  function metroMoneyValues(value){return [...String(value||'').matchAll(/\(?-?\d[\d,]*\.\d{2}\)?/g)].map(match=>amount(match[0])).filter(value=>value!==null).map(value=>Math.abs(value));}
  function parseMetroReportDate(value){
    const match=String(value||'').trim().match(/^([0-9OIl|]{1,2})\s+([A-Za-z]{3,9})\s*(\d{2}|20\d{2})\b/i);if(!match)return '';
    const day=Number(match[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')),month={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}[match[2].slice(0,3).toLowerCase()],year=match[3].length===2?2000+Number(match[3]):Number(match[3]);
    if(!month||day<1||day>31)return '';const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return parseDate(`${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`)?iso:'';
  }
  function parseMetroOnlineTransactionReport(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return null;
    const allText=`${source} ${text} ${ocrLines.map(line=>line?.text||'').join(' ')}`;
    if(!/online\s+banking\s+transaction\s+report/i.test(allText)||!/\bM?ETRO\s*BANK\b/i.test(allText))return null;
    const pages=new Map();for(const raw of ocrLines){const page=Number(raw?.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push({...raw,page,x:Number(raw?.x)||0,y:Number(raw?.y)||0,width:Number(raw?.width)||0,height:Number(raw?.height)||0,text:String(raw?.text||'').trim()});}
    const headerName=value=>String(value||'').toLowerCase().replace(/[^a-z]+/g,' ').trim(),median=values=>{const sorted=values.filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:18;};
    const readMoney=value=>{
      const raw=String(value||'').trim().replace(/[OoQq]/g,'0').replace(/[Il|]/g,'1'),match=raw.match(/[(-]?\s*\d[\d\s,]*[.,]\s*\d{2}\s*[)]?/);if(!match)return null;
      const token=match[0].replace(/\s+/g,''),negative=/^\(|^-/.test(token),separator=Math.max(token.lastIndexOf('.'),token.lastIndexOf(','));if(separator<0)return null;
      const whole=token.slice(0,separator).replace(/\D/g,''),pennies=token.slice(separator+1).replace(/\D/g,'').slice(0,2);if(pennies.length!==2)return null;
      const parsed=Number(`${whole||'0'}.${pennies}`);return Number.isFinite(parsed)?(negative?-1:1)*parsed:null;
    };
    const output=[];
    for(const [page,items] of [...pages.entries()].sort((a,b)=>a[0]-b[0])){
      const labels={date:[],valueDate:[],description:[],out:[],incoming:[],balance:[]};
      for(const line of items){const label=headerName(line.text);if(label==='date')labels.date.push(line);else if(label==='value date')labels.valueDate.push(line);else if(label==='description')labels.description.push(line);else if(label==='money out')labels.out.push(line);else if(label==='money in')labels.incoming.push(line);else if(label==='balance')labels.balance.push(line);}
      let header=null;
      for(const date of labels.date){const tolerance=Math.max(24,(date.height||18)*1.5),nearest=name=>labels[name].filter(line=>Math.abs(line.y-date.y)<=tolerance).sort((a,b)=>Math.abs(a.y-date.y)-Math.abs(b.y-date.y))[0]||null,valueDate=nearest('valueDate'),description=nearest('description'),out=nearest('out'),incoming=nearest('incoming'),balance=nearest('balance');if(!valueDate||!description||!out||!incoming||!balance)continue;
        const ordered=[date,valueDate,description,out,incoming,balance].map(line=>line.x+line.width/2);if(ordered.some((x,index)=>index&&x<=ordered[index-1]))continue;header={date,valueDate,description,out,incoming,balance,y:median([date.y,valueDate.y,description.y,out.y,incoming.y,balance.y]),height:median([date.height,valueDate.height,description.height,out.height,incoming.height,balance.height])};break;
      }
      if(!header)continue;
      const dateBoundary=(header.date.x+header.date.width+header.valueDate.x)/2,descriptionLeft=(header.valueDate.x+header.valueDate.width+header.description.x)/2,descriptionRight=(header.description.x+header.description.width+header.out.x)/2,outInBoundary=(header.out.x+header.out.width+header.incoming.x)/2,inBalanceBoundary=(header.incoming.x+header.incoming.width+header.balance.x)/2;
      const dateLines=items.filter(line=>line.x<dateBoundary&&line.y>header.y+Math.max(18,header.height*.65)).map(line=>{const partial=String(line.text||'').trim().match(/^([0-9OIl|]{1,2})\s+(20\d{2}|\d{2})$/i);return {line,date:parseMetroReportDate(line.text),partial:partial?{day:Number(partial[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')),year:partial[2].length===2?2000+Number(partial[2]):Number(partial[2])}:null};}).filter(item=>item.date||item.partial).sort((a,b)=>a.line.y-b.line.y);
      for(let index=0;index<dateLines.length;index++)if(!dateLines[index].date&&dateLines[index].partial){const previous=[...dateLines.slice(0,index)].reverse().find(item=>item.date),next=dateLines.slice(index+1).find(item=>item.date),partial=dateLines[index].partial;if(previous&&next&&previous.date.slice(0,7)===next.date.slice(0,7)&&Number(previous.date.slice(0,4))===partial.year&&Number(next.date.slice(0,4))===partial.year){const month=Number(previous.date.slice(5,7)),candidate=`${partial.year}-${String(month).padStart(2,'0')}-${String(partial.day).padStart(2,'0')}`;if(parseDate(`${String(partial.day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${partial.year}`))dateLines[index].date=candidate;}}
      const rowTolerance=Math.max(16,header.height*.9);
      for(let index=0;index<dateLines.length;index++){
        const dateRecord=dateLines[index],dateLine=dateRecord.line,nextY=dateLines[index+1]?.line.y??Infinity,nearby=items.filter(line=>Math.abs(line.y-dateLine.y)<=rowTolerance&&readMoney(line.text)!==null),columnValue=(left,right)=>nearby.filter(line=>line.x>=left&&line.x<right).sort((a,b)=>Math.abs(a.y-dateLine.y)-Math.abs(b.y-dateLine.y))[0]||null,outLine=columnValue(descriptionRight,outInBoundary),inLine=columnValue(outInBoundary,inBalanceBoundary),balanceLine=columnValue(inBalanceBoundary,Infinity),outValue=outLine?readMoney(outLine.text):null,inValue=inLine?readMoney(inLine.text):null,balance=balanceLine?readMoney(balanceLine.text):null;
        const hasOneMovement=(outValue!==null)!==(inValue!==null),movement=hasOneMovement?(inValue!==null?Math.abs(inValue):-Math.abs(outValue)):null,detail=items.filter(line=>line.x>=descriptionLeft&&line.x<descriptionRight&&line.y>=dateLine.y-rowTolerance&&line.y<nextY-rowTolerance/2).sort((a,b)=>a.y-b.y||a.x-b.x).map(line=>line.text).join(' ').replace(/\s+/g,' ').trim(),unreadableMovement=movement===null,dateUnconfirmed=!dateRecord.date,rejected=unreadableMovement||balance===null||dateUnconfirmed;
        output.push({date:dateRecord.date,details:detail||'Bank transaction',receipt:movement!==null&&movement>0?movement:'',payment:movement!==null&&movement<0?Math.abs(movement):'',amount:movement??'',balance:balance??'',balanceExpected:!dateUnconfirmed,source,page,profileId:'metro-online-transaction-report',ocrY:dateLine.y,balanceY:balanceLine?.y??null,confidence:rejected?'REJECTED':'Metro online transaction report',review:rejected,balanceMovementUnreadable:unreadableMovement,...(rejected?{status:'REJECTED',accepted:false,rejected:true,rejectedReason:dateUnconfirmed?'Transaction date could not be confirmed from the statement. Verify this row on the linked PDF page.':unreadableMovement?'Transaction amount could not be read from the statement. Verify this row on the linked PDF page.':'Running balance could not be read from the statement. Verify this row on the linked PDF page.'}:{})});
      }
    }
    if(!output.length)return [];
    const first=output.find(row=>row.date)?.date||'',last=[...output].reverse().find(row=>row.date)?.date||'',descending=first>last;
    return output.sort((a,b)=>a.date.localeCompare(b.date)||(descending?(Number(b.page)-Number(a.page)||Number(b.ocrY)-Number(a.ocrY)):(Number(a.page)-Number(b.page)||Number(a.ocrY)-Number(b.ocrY))));
  }
  function metroPositionedRows(items,source,pageNumber){
    if(!Array.isArray(items)||!items.length)return [];
    const isType=value=>metroTransactionTypes.some(type=>String(value||'').startsWith(type));
    const dateItems=items.filter(item=>item.x<110&&parseDate(item.text)).sort((a,b)=>b.y-a.y);
    const markers=items.filter(item=>item.x>=100&&item.x<330&&isType(item.text)).sort((a,b)=>b.y-a.y);
    if(!markers.length)return [];
    const outHeader=items.find(item=>/^Money out \((?:\u00C2)?\u00A3\)/.test(item.text)),inHeader=items.find(item=>/^Money in \((?:\u00C2)?\u00A3\)/.test(item.text)),balanceHeader=items.find(item=>/^Balance \((?:\u00C2)?\u00A3\)/.test(item.text));
    if(!outHeader||!inHeader||!balanceHeader)return [];
    const decimal=item=>{const match=String(item.text||'').match(/\(?-?\d[\d,]*\.\d{2}\)?/);return match?amount(match[0]):null;};
    const outValues=items.filter(item=>item.x>outHeader.x&&item.x<inHeader.x&&decimal(item)!==null).map(item=>({...item,value:Math.abs(decimal(item))}));
    const inValues=items.filter(item=>item.x>inHeader.x&&item.x<balanceHeader.x&&decimal(item)!==null).map(item=>({...item,value:Math.abs(decimal(item))}));
    const balanceValues=items.filter(item=>item.x>balanceHeader.x&&decimal(item)!==null).map(item=>({...item,value:Math.abs(decimal(item))}));
    const nearest=(values,y)=>values.filter(item=>Math.abs(item.y-y)<1.5).sort((a,b)=>Math.abs(a.y-y)-Math.abs(b.y-y))[0];
    const descriptionItems=items.filter(item=>item.x>=100&&item.x<330).sort((a,b)=>b.y-a.y);
    const rows=[];
    for(let i=0;i<markers.length;i++){
      const marker=markers[i],nextY=markers[i+1]?.y,parts=descriptionItems.filter(item=>item.y<=marker.y+1.5&&(nextY===undefined||item.y>nextY+1.5));
      const details=parts.map(item=>item.text).join(' ').replace(/\s+/g,' ').trim();
      if(/^Balance brought forward$/i.test(details))continue;
      const dateLine=dateItems.slice().sort((a,b)=>Math.abs(a.y-marker.y)-Math.abs(b.y-marker.y))[0],out=nearest(outValues,marker.y),incoming=nearest(inValues,marker.y),balance=nearest(balanceValues,marker.y);
      if(!dateLine||!balance||(!out&&!incoming))continue;
      const isReceipt=Boolean(incoming),value=isReceipt?incoming.value:out.value;
      rows.push({date:parseDate(dateLine.text),details:details||'Bank transaction',receipt:isReceipt?value:'',payment:isReceipt?'':value,amount:isReceipt?value:-value,balance:balance.value,balanceExpected:true,source,page:pageNumber,confidence:'Metro Bank columns',review:false});
    }
    return rows;
  }
  function metroPageRows(pageText,source,pageNumber){
    const page=String(pageText||'').replace(/\s+/g,' ').trim();
    if(!/Your transactions/.test(page)||!/Money out \((?:\u00C2)?\u00A3\)/.test(page)||!/Money in \((?:\u00C2)?\u00A3\)/.test(page)||!/Balance \((?:\u00C2)?\u00A3\)/.test(page))return [];
    const dateMarker=page.indexOf('Date '),transactionMarker=page.indexOf('Transaction'),outMarker=page.search(/Money out \((?:\u00C2)?\u00A3\)/),inMarker=page.search(/Money in \((?:\u00C2)?\u00A3\)/),balanceMarker=page.search(/Balance \((?:\u00C2)?\u00A3\)/);
    if(transactionMarker<0||outMarker<0||inMarker<0||balanceMarker<0)return [];
    const dateText=dateMarker>=0?page.slice(dateMarker+5,transactionMarker):'';
    const dates=[...dateText.matchAll(/\b\d{1,2}\s+[A-Za-z]{3}\s+20\d{2}\b/g)].map(match=>parseDate(match[0])).filter(Boolean);
    const descriptions=metroDescriptions(page.slice(transactionMarker+'Transaction'.length,outMarker));
    const outValues=metroMoneyValues(page.slice(outMarker+page.slice(outMarker).match(/^Money out \((?:\u00C2)?\u00A3\)/)[0].length,inMarker));
    const inValues=metroMoneyValues(page.slice(inMarker+page.slice(inMarker).match(/^Money in \((?:\u00C2)?\u00A3\)/)[0].length,balanceMarker));
    const balances=metroMoneyValues(page.slice(balanceMarker+page.slice(balanceMarker).match(/^Balance \((?:\u00C2)?\u00A3\)/)[0].length));
    if(!dates.length||!descriptions.length||!balances.length)return [];
    const summary=/Opening balance/.test(page);
    const detailDescriptions=(summary?descriptions.filter(item=>!/^Balance brought forward$/i.test(item)):descriptions).map(item=>item.replace(/\s+(?:To:|Closing Balance).*$/,'').replace(/\s+\d{8}\s+\d{2}-\d{2}-\d{2}\s+\d+$/,'').trim());
    const summaryDate=summary?dates.sort((a,b)=>dates.filter(item=>item===b).length-dates.filter(item=>item===a).length)[0]:'';
    const detailDates=summary?Array(detailDescriptions.length).fill(summaryDate):dates;
    const expected=Math.min(detailDescriptions.length,detailDates.length,balances.length-(summary?1:0));
    if(expected<=0)return [];
    const balanceValues=summary?balances.slice(1,1+detailDescriptions.length):balances.slice(0,dates.length);
    let outIndex=0,inIndex=0;
    const knownIncoming=detailDescriptions.filter(item=>/^(?:Inward Payment|BACS Payment Received|Cash Deposit)/.test(item)).length;
    const ambiguous=detailDescriptions.filter(item=>/^Account to Account Transfer/.test(item)).length;
    const remainingIncoming=Math.max(0,inValues.length-knownIncoming),remainingOutgoing=Math.max(0,outValues.length-(detailDescriptions.length-knownIncoming-ambiguous));
    const rows=[];
    for(let i=0;i<expected;i++){
      const detail=detailDescriptions[i],incoming=/^(?:Inward Payment|BACS Payment Received|Cash Deposit)/.test(detail);
      let isIncoming=incoming;
      if(/^Account to Account Transfer/.test(detail)){
        if(remainingIncoming===ambiguous)isIncoming=true;
        else if(remainingOutgoing===ambiguous)isIncoming=false;
        else isIncoming=/\b(?:received|payment|credit|deposit)\b/i.test(detail);
      }
      const value=isIncoming?(inValues[inIndex++]??null):(outValues[outIndex++]??null);
      if(value===null)continue;
      const signed=isIncoming?value:-value;
      const aligned=detailDescriptions.length===detailDates.length&&detailDescriptions.length===balanceValues.length;
      rows.push({date:detailDates[i]||'',details:detail,receipt:isIncoming?value:'',payment:isIncoming?'':value,amount:signed,balance:balanceValues[i]??'',balanceExpected:true,openingBalance:summary&&i===0?balances[0]:'',source,page:pageNumber,confidence:summary?'Metro Bank summary':(aligned?'Metro Bank columns':'Review row alignment'),review:!aligned});
    }
    return rows;
  }
  function parseMetroBank(text,source='',pageItems){
    if(Array.isArray(pageItems)&&pageItems.length){
      const positioned=pageItems.flatMap((items,index)=>metroPositionedRows(items,source,index+1));
      if(positioned.length)return positioned;
    }
    const pages=String(text||'').split(/\n/),output=[];
    pages.forEach((page,index)=>output.push(...metroPageRows(page,source,index+1)));
    return output;
  }
  function parseBank(text,source='',pageItems){
    const metro=parseMetroBank(text,source,pageItems);if(metro.length)return metro;
    const result=[],ls=lines(text),dateRe=/^(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\b/;
    for(let i=0;i<ls.length;i++){const line=ls[i],dm=line.match(dateRe);if(!dm)continue;const date=parseDate(dm[1]);if(!date)continue;let detail=line.slice(dm[0].length).trim(),j=i+1;while(j<ls.length&&!dateRe.test(ls[j])&&!moneyTokens(ls[j]).length&&j-i<3){detail+=' '+ls[j];j++;}const joined=ls.slice(i,j).join(' '),tokens=moneyTokens(joined);if(!tokens.length)continue;const movement=tokens.length>1?tokens[tokens.length-2]:tokens[0],balance=tokens.length>1?tokens.at(-1).value:'',valueBeforeDirection=movement.value;let value=valueBeforeDirection;const upper=joined.toUpperCase();if(value>0&&!/CR|CREDIT|RECEIPT|DEPOSIT/.test(upper)&&/DR|DEBIT|WITHDRAWAL/.test(upper))value=-value;detail=detail.replace(/(?:[\u00A3$\u20AC]\s*)?\(?-?\d[\d,]*(?:\.\d{2})\)?(?:\s*(?:CR|DR))?/gi,' ').replace(/\s+/g,' ').trim();result.push({date,details:detail||'Bank transaction',receipt:value>0?value:'',payment:value<0?Math.abs(value):'',amount:value,balance,balanceExpected:tokens.length>1,source,confidence:tokens.length>1?'Review balance column':'Review direction',review:tokens.length>1});i=j-1;}
    const opening=bankOpeningBalance(text);if(result.length&&opening!==null)result[0].openingBalance=opening;
    return result;
  }
  function bankOpeningBalance(text){
    const source=String(text||'').split(/\r?\n/);
    for(let i=0;i<source.length;i++)if(/\b(?:opening\s+balance|balance\s+brought\s+forward)\b/i.test(source[i])){
      const values=moneyTokens(source[i]);if(values.length)return values.at(-1).value;
      const next=moneyTokens(source[i+1]||'');if(next.length)return next.at(-1).value;
    }
    return null;
  }
  function bankRowAmountCents(row){
    let value=row?.amount;
    if(value===''||value===null||value===undefined||!Number.isFinite(Number(value))){
      const receipt=row?.receipt,payment=row?.payment;
      if(receipt!==''&&receipt!==null&&receipt!==undefined&&Number.isFinite(Number(receipt)))value=Math.abs(Number(receipt));
      else if(payment!==''&&payment!==null&&payment!==undefined&&Number.isFinite(Number(payment)))value=-Math.abs(Number(payment));
      else return null;
    }
    return Math.round(Number(value)*100);
  }
  function bankValueCents(value){
    if(value===''||value===null||value===undefined||!Number.isFinite(Number(value)))return null;
    return Math.round(Number(value)*100);
  }
  function inspectBankBalances(rows){
    const items=(Array.isArray(rows)?rows:[]).map((row,index)=>({row,index,date:String(row?.date||''),amountCents:bankRowAmountCents(row),balanceCents:bankValueCents(row?.balance)})).filter(item=>item.date||item.amountCents!==null||item.balanceCents!==null).sort((a,b)=>a.date&&b.date?a.date.localeCompare(b.date)||a.index-b.index:a.index-b.index);
    const mismatches=[];
    for(const item of items){
      if(item.row?.balanceMovementUnreadable||item.balanceCents!==null&&item.amountCents===null)mismatches.push({startIndex:item.index,endIndex:item.index,rowIndexes:[item.index],previousIndex:null,currentIndex:item.index,previousDate:'',date:item.date,expectedCents:item.balanceCents??0,actualCents:item.balanceCents??0,differenceCents:0,page:item.row?.page||'',unreadableMovement:true});
      else if(item.row?.balanceExpected&&item.date&&item.balanceCents===null)mismatches.push({startIndex:item.index,endIndex:item.index,rowIndexes:[item.index],previousIndex:null,currentIndex:item.index,previousDate:'',date:item.date,expectedCents:0,actualCents:0,differenceCents:0,page:item.row?.page||'',missingBalance:true});
    }
    let previous=null,pending=[],leading=[],checkedSegments=0,checkpointCount=0;
    const rejectUnreadableInterval=(entries,balanceItem,previousItem=null)=>{
      const unreadable=entries.filter(entry=>entry.amountCents===null||entry.row?.balanceMovementUnreadable);if(!unreadable.length)return;
      const first=unreadable[0];let mismatch=mismatches.find(item=>item.unreadableMovement&&item.currentIndex===first.index);
      if(!mismatch){mismatch={startIndex:first.index,endIndex:first.index,rowIndexes:[first.index],previousIndex:null,currentIndex:first.index,previousDate:'',date:first.date,expectedCents:0,actualCents:0,differenceCents:0,page:first.row?.page||'',unreadableMovement:true};mismatches.push(mismatch);}
      Object.assign(mismatch,{startIndex:entries[0]?.index??first.index,endIndex:balanceItem.index,rowIndexes:[...new Set(entries.map(entry=>entry.index))],previousIndex:previousItem?.index??null,previousDate:previousItem?.date||'',date:balanceItem.date,page:balanceItem.row?.page||first.row?.page||''});
      for(const extra of unreadable.slice(1)){const duplicate=mismatches.findIndex(item=>item!==mismatch&&item.unreadableMovement&&item.currentIndex===extra.index);if(duplicate>=0)mismatches.splice(duplicate,1);}
    };
    for(const item of items){
      if(previous)pending.push(item);else leading.push(item);
      if(item.balanceCents===null)continue;
      checkpointCount++;
      if(previous){
        const segmentRows=pending.map(entry=>entry.index),hasUnknownMovement=pending.some(entry=>entry.amountCents===null);
        if(pending.length&&!hasUnknownMovement){
          checkedSegments++;const expected=previous.balanceCents+pending.reduce((sum,entry)=>sum+entry.amountCents,0),difference=item.balanceCents-expected;
          if(difference!==0)mismatches.push({startIndex:segmentRows[0],endIndex:item.index,rowIndexes:segmentRows,previousIndex:previous.index,currentIndex:item.index,previousDate:previous.date,date:item.date,expectedCents:expected,actualCents:item.balanceCents,differenceCents:difference,page:item.row?.page||''});
        }else if(pending.length&&hasUnknownMovement)rejectUnreadableInterval(pending,item,previous);
      }else{
        const openingItem=leading.find(entry=>bankValueCents(entry.row?.openingBalance)!==null),opening=bankValueCents(openingItem?.row?.openingBalance),leadingRows=leading,hasUnknownMovement=leadingRows.some(entry=>entry.amountCents===null);
        if(opening!==null&&leadingRows.length&&!hasUnknownMovement){
          checkedSegments++;const expected=opening+leadingRows.reduce((sum,entry)=>sum+entry.amountCents,0),difference=item.balanceCents-expected;
          if(difference!==0)mismatches.push({startIndex:leadingRows[0].index,endIndex:item.index,rowIndexes:leadingRows.map(entry=>entry.index),previousIndex:openingItem?.index??null,currentIndex:item.index,previousDate:'',date:item.date,expectedCents:expected,actualCents:item.balanceCents,differenceCents:difference,page:item.row?.page||''});
        }else if(leadingRows.length&&hasUnknownMovement)rejectUnreadableInterval(leadingRows,item,openingItem||null);
      }
      previous=item;pending=[];leading=[];
    }
    return {mismatches,checkedSegments,checkpointCount};
  }
  function markBankBalanceMismatches(rows,report=inspectBankBalances(rows)){
    const source=Array.isArray(rows)?rows:[];
    for(const mismatch of report.mismatches){
      const range=mismatch.previousDate?`${mismatch.previousDate} to ${mismatch.date}`:mismatch.date,expected=(mismatch.expectedCents/100).toFixed(2),actual=(mismatch.actualCents/100).toFixed(2),difference=(Math.abs(mismatch.differenceCents)/100).toFixed(2),unreadableReason=mismatch.previousDate||mismatch.rowIndexes.length>1?`The running-balance interval ${range||'on this date'} contains an unreadable transaction amount after the high-resolution recheck. All rows in the interval are REJECTED; verify them against the statement.`:`The bank transaction dated ${range||'this date'} has no readable amount after the high-resolution recheck. This row is REJECTED; verify it against the bank statement.`,reason=mismatch.missingBalance?`The bank transaction on ${range||'this date'} has no readable running balance after the high-resolution recheck. This row is REJECTED; verify it against the statement.`:mismatch.unreadableMovement?unreadableReason:`Bank statement balance does not reconcile for ${range}: the listed transactions give \u00A3${expected}, but the statement shows \u00A3${actual} (a \u00A3${difference} difference). Verify the transaction rows against the bank statement; this date range is REJECTED.`;
      for(const index of mismatch.rowIndexes){const row=source[index];if(!row)continue;row.status='REJECTED';row.rejected=true;row.accepted=false;row.review=true;row.confidence='REJECTED';row.balanceMismatch=true;row.rejectedReason=reason;}
    }
    return source;
  }
  function parseBankCsv(text,source=''){
    const input=String(text||'').replace(/^\uFEFF/,'');if(!input.trim())return [];
    const parseRecords=delimiter=>{
      const records=[];let record=[],field='',quoted=false;
      for(let i=0;i<input.length;i++){
        const char=input[i];
        if(char==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
        else if(!quoted&&char===delimiter){record.push(field);field='';}
        else if(!quoted&&(char==='\n'||char==='\r')){if(char==='\r'&&input[i+1]==='\n')i++;record.push(field);field='';if(record.some(value=>String(value).trim()))records.push(record);record=[];}
        else field+=char;
      }
      record.push(field);if(record.some(value=>String(value).trim()))records.push(record);return records;
    };
    const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const headersFor=records=>{
      for(let rowIndex=0;rowIndex<Math.min(records.length,30);rowIndex++){
        const headers=records[rowIndex].map(normalize),date=headers.findIndex(value=>/^(?:transaction |posted |booking |value )?date$/.test(value));if(date<0)continue;
        const incoming=headers.findIndex(value=>/^(?:paid|money|amount) in(?: .+)?$|^(?:credit|credits|deposit|deposits|received)$/.test(value));
        const outgoing=headers.findIndex(value=>/^(?:paid|money|amount) out(?: .+)?$|^(?:debit|debits|withdrawal|withdrawals)$/.test(value));
        const amount=headers.findIndex(value=>/^(?:transaction )?amount$|^value$/.test(value));if(incoming<0&&outgoing<0&&amount<0)continue;
        const detailPriority=['description','transaction details','details','narrative','payee','merchant','reference','transaction'];let details=-1;for(const name of detailPriority){details=headers.findIndex(value=>value===name);if(details>=0)break;}
        const type=headers.findIndex(value=>value==='type'||value==='transaction type'||value==='debit credit'),balance=headers.findIndex(value=>/^(?:(?:running|available|closing|account) )?balance(?: .+)?$/.test(value));
        return {rowIndex,date,incoming,outgoing,amount,details,type,balance};
      }
      return null;
    };
    let records=[],layout=null;
    for(const delimiter of [',',';','\t']){const candidate=parseRecords(delimiter),found=headersFor(candidate);if(found){records=candidate;layout=found;break;}}
    if(!layout)return [];
    const valueAt=(row,index)=>index>=0?String(row[index]??'').trim():'';
    const numeric=value=>{
      let raw=String(value??'').trim().replace(/[\u00A0\u202F]/g,' ');if(!raw||/^(?:-|—|n\/a)$/i.test(raw))return null;
      const negative=/^\(.*\)$/.test(raw)||/^\s*-/.test(raw)||/\b(?:dr|debit)\b/i.test(raw);raw=raw.replace(/[()]/g,'').replace(/[£$€\s,]/g,'').replace(/[^\d.\-]/g,'');if(!raw||raw==='-'||raw==='.')return null;
      const parsed=Number(raw);return Number.isFinite(parsed)?(negative?-1:1)*Math.abs(parsed):null;
    };
    const output=[];
    for(const cells of records.slice(layout.rowIndex+1)){
      const date=parseDate(valueAt(cells,layout.date));if(!date)continue;
      const details=valueAt(cells,layout.details)||'Bank transaction',balanceValue=numeric(valueAt(cells,layout.balance)),kind=normalize(valueAt(cells,layout.type)),movements=[];
      if(layout.incoming>=0||layout.outgoing>=0){const incoming=numeric(valueAt(cells,layout.incoming)),outgoing=numeric(valueAt(cells,layout.outgoing));if(incoming!==null&&incoming!==0)movements.push(Math.abs(incoming));if(outgoing!==null&&outgoing!==0)movements.push(-Math.abs(outgoing));}
      else{let signed=numeric(valueAt(cells,layout.amount));if(signed===null||signed===0)continue;if(/\b(?:debit|debited|payment|withdrawal|outgoing|paid out)\b/.test(kind))signed=-Math.abs(signed);else if(/\b(?:credit|credited|deposit|received|incoming|paid in)\b/.test(kind))signed=Math.abs(signed);movements.push(signed);}
      for(const movement of movements){const review=layout.amount>=0&&!kind&&movement>0;output.push({date,details,receipt:movement>0?movement:'',payment:movement<0?Math.abs(movement):'',amount:movement,balance:balanceValue??'',source,page:'',confidence:review?'Review direction':'Bank CSV columns',review});}
    }
    return output;
  }
  function parseBarclaysOcrBank(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return null;
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const pages=new Map();
    for(const raw of ocrLines){const page=Number(raw?.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push({...raw,page,x:Number(raw?.x)||0,y:Number(raw?.y)||0,width:Number(raw?.width)||0,text:String(raw?.text||'').trim()});}
    const pageEntries=[...pages.entries()].sort((a,b)=>a[0]-b[0]);
    const pageHeaders=[];
    for(const [page,items] of pageEntries){
      const labels={date:items.filter(line=>/^date(?:\s*[\/:|]?\s*description)?$/i.test(line.text)),description:items.filter(line=>/^description$/i.test(line.text)),out:items.filter(line=>/^money\s+out\b/i.test(line.text)),income:items.filter(line=>/^money\s+in\b/i.test(line.text)&&!/^money\s+out\b/i.test(line.text)),balance:items.filter(line=>/^balance\b/i.test(line.text))};
      let best=null;
      for(const date of labels.date){
        const candidates=[...labels.out,...labels.balance];if(candidates.length<2)continue;
        const nearby=candidates.filter(line=>Math.abs(line.y-date.y)<=Math.max(20,(Number(date.height)||0)*1.6));
        const out=nearby.find(line=>labels.out.includes(line)),balance=nearby.find(line=>labels.balance.includes(line));if(!out||!balance||!(date.x<out.x&&out.x<balance.x))continue;
        const income=labels.income.filter(line=>Math.abs(line.y-date.y)<=Math.max(20,(Number(date.height)||0)*1.6)).sort((a,b)=>Math.abs(a.y-date.y)-Math.abs(b.y-date.y))[0]||null;
        const description=labels.description.filter(line=>Math.abs(line.y-date.y)<=Math.max(20,(Number(date.height)||0)*1.6)&&line.x>date.x&&line.x<out.x).sort((a,b)=>Math.abs(a.y-date.y)-Math.abs(b.y-date.y))[0]||null;
        const candidate={page,items,y:date.y,dateX:date.x,dateWidth:date.width,descriptionX:description?.x??null,outX:out.x,outWidth:/^money\s+out\s+money\s+in$/i.test(out.text)?null:out.width,inX:income?.x??null,balanceX:balance.x,balanceWidth:balance.width,headerHeight:Math.max(Number(date.height)||0,Number(out.height)||0,Number(balance.height)||0)};
        if(!best||Number(Boolean(description))+Number(Boolean(income))>Number(Boolean(best.descriptionX))+Number(Boolean(best.inX)))best=candidate;
      }
      if(best)pageHeaders.push(best);
    }
    if(!pageHeaders.length)return null;
    const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:null;};
    const globalAnchors={dateX:median(pageHeaders.map(header=>header.dateX)),descriptionX:median(pageHeaders.map(header=>header.descriptionX)),outX:median(pageHeaders.map(header=>header.outX)),outWidth:median(pageHeaders.map(header=>header.outWidth)),inX:median(pageHeaders.map(header=>header.inX)),balanceX:median(pageHeaders.map(header=>header.balanceX)),balanceWidth:median(pageHeaders.map(header=>header.balanceWidth))};
    if([globalAnchors.dateX,globalAnchors.outX,globalAnchors.balanceX].some(value=>value===null))return null;
    const statementBrand=/\bbarclays\b/i.test(`${source} ${text} ${ocrLines.map(line=>line?.text||'').join(' ')}`);
    // Only take over OCR parsing when Barclays' labelled transaction columns
    // are present; other banks retain the existing generic OCR path.
    if(!statementBrand&&pageHeaders.length<2)return null;
    const parseDatePrefix=value=>{
      let s=String(value||'').trim(),match=s.match(/^([0-9Il|Oo])\s+([0-9Il|Oo])\s+([A-Za-z]{3,9})\b/i),dayText='',monthText='',suffix='';
      if(match){dayText=`${match[1]}${match[2]}`;monthText=match[3];suffix=s.slice(match[0].length).trim();}
      else{match=s.match(/^([0-9Il|Oo]{1,2})\s+([A-Za-z]{3,9})\b/i);if(match){dayText=match[1];monthText=match[2];suffix=s.slice(match[0].length).trim();}}
      if(!match)return null;
      const day=Number(dayText.replace(/[Il|]/g,'1').replace(/[Oo]/g,'0')),month=months[monthText.slice(0,3).toLowerCase()];
      if(!month||day<1||day>31)return null;
      return {day,month,suffix};
    };
    const readMoney=value=>{
      let s=String(value||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/\s+/g,'').replace(/[^\d,.,+-]/g,'');
      if(!s)return null;
      const decimal=s.match(/([+-]?\d[\d,]*)(?:\.(\d{2})|,(\d{2}))$/);
      if(decimal){const whole=decimal[1].replace(/,/g,'');return Number(`${whole}.${decimal[2]??decimal[3]}`);}
      if(/^\+?\d[\d,]*$/.test(s))return Number(s.replace(/,/g,''));
      return null;
    };
    const pageContext=new Map();
    for(const [page,items] of pageEntries){
      const topText=items.filter(line=>line.y<400).map(line=>line.text).join(' ');
      const range=topText.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s*(20\d{2})?\s*[-\u2013]\s*(\d{1,2})\s+([A-Za-z]{3,9})\s*(20\d{2})\b/i);
      const statement=topText.match(/statement\s+date\b[\s\S]{0,70}?(20\d{2})/i);
      const years=[...topText.matchAll(/\b(20\d{2})\b/g)].map(match=>Number(match[1]));
      let context=pageContext.get(page-1)||null;
      if(range){
        const startMonth=months[range[2].slice(0,3).toLowerCase()],endMonth=months[range[5].slice(0,3).toLowerCase()],endYear=Number(range[6]||range[3]||years.at(-1)||context?.endYear||new Date().getFullYear());
        if(startMonth&&endMonth)context={startMonth,endMonth,startYear:Number(range[3]||((startMonth>endMonth)?endYear-1:endYear)),endYear};
      }
      if(statement){const year=Number(statement[1]);context={...(context||{}),endYear:year};}
      if(!context&&years.length)context={endYear:years.at(-1)};
      if(context)pageContext.set(page,context);
    }
    let inheritedContext=null,lastMonth=0,lastYear=0;
    const output=[];
    const sortedPages=pageEntries;
    for(const [page,items] of sortedPages){
      const rawHeader=pageHeaders.find(item=>item.page===page);if(!rawHeader)continue;
      const header={...rawHeader};for(const key of ['dateX','descriptionX','outX','outWidth','inX','balanceX','balanceWidth'])if(!Number.isFinite(header[key]))header[key]=globalAnchors[key];
      if(!Number.isFinite(header.descriptionX)){
        const bodyStarts=items.filter(line=>line.y>header.y+(header.headerHeight||0)&&line.x>header.dateX&&line.x<header.outX&&!/^date|^money\s|^balance$/i.test(line.text)&&!parseDatePrefix(line.text)).map(line=>line.x);
        header.descriptionX=median(bodyStarts);
      }
      if(!Number.isFinite(header.inX))header.inX=header.outX+(header.balanceX-header.outX)*0.5;
      if(!Number.isFinite(header.descriptionX)||!Number.isFinite(header.outWidth))continue;
      const context=pageContext.get(page)||inheritedContext; if(context)inheritedContext=context;
      const dateBoundary=(header.dateX+header.descriptionX)/2,descriptionBoundary=(header.descriptionX+header.outX)/2,split=(header.outX+header.outWidth+header.inX)/2,upper=(header.inX+header.balanceX)/2;
      const dates=items.filter(line=>line.y>header.y+Math.max(8,(header.headerHeight||0)*0.5)&&line.x<dateBoundary).map(line=>({line,parsed:parseDatePrefix(line.text)})).filter(item=>item.parsed).sort((a,b)=>a.line.y-b.line.y);
      const movements=items.filter(line=>line.y>header.y+Math.max(8,(header.headerHeight||0)*0.5)&&line.x>=descriptionBoundary&&line.x<upper).map(line=>({line,value:readMoney(line.text)})).filter(item=>item.value!==null).map(item=>({...item,kind:item.line.x<split?'payment':'receipt'})).sort((a,b)=>a.line.y-b.line.y||a.line.x-b.line.x);
      const rowHeight=median(movements.slice(1).map((item,index)=>item.line.y-movements[index].line.y).filter(gap=>gap>0))||median(dates.slice(1).map((item,index)=>item.line.y-dates[index].line.y).filter(gap=>gap>0))||0,usedDateLines=new Set();
      const dateForMovement=y=>{
        const tolerance=Math.max(12,(Number(header.headerHeight)||0)*0.5);let latest=null;
        for(const item of dates){if(item.line.y<=y+tolerance)latest=item;else break;}
        return latest;
      };
      for(let i=0;i<movements.length;i++){
        const movement=movements[i],dateRecord=dateForMovement(movement.line.y);
        if(!dateRecord)continue;
        usedDateLines.add(dateRecord.line);
        const {day,month,suffix}=dateRecord.parsed;
        let year=context?.endYear||Number(String(text).match(/\b(20\d{2})\b/)?.[1])||new Date().getFullYear();
        if(context?.startMonth&&context?.endMonth){year=(context.startMonth>context.endMonth&&month>=context.startMonth)?(context.startYear||year):context.endYear||year;}
        else if(context?.endYear){const statementMatch=String(text).match(/statement\s+date\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i);const statementMonth=statementMatch?months[statementMatch[2].slice(0,3).toLowerCase()]:0;if(statementMonth&&statementMonth<=2&&month>=10)year=context.endYear-1;}
        if(lastYear&&year===lastYear&&lastMonth===12&&month===1)year++;
        lastMonth=month;lastYear=year;
        const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const nextMovementY=movements[i+1]?.line.y??Infinity,descriptionLines=items.filter(line=>line.x>=dateBoundary&&line.x<descriptionBoundary&&Math.abs(line.y-movement.line.y)<=26&&line!==dateRecord.line).sort((a,b)=>Math.abs(a.y-movement.line.y)-Math.abs(b.y-movement.line.y)),primary=descriptionLines.find(line=>! /^(?:on\s+\d|ref\s*:|timed\s+at\b)/i.test(line.text)),extraEnd=Math.min(nextMovementY-4,movement.line.y+rowHeight*0.9),extraLines=items.filter(line=>line.x>=dateBoundary&&line.x<descriptionBoundary&&line.y>movement.line.y+18&&line.y<extraEnd&&(!Number.isFinite(nextMovementY)||Math.abs(line.y-nextMovementY)>26)).sort((a,b)=>a.y-b.y),inlineDateDetail=Math.abs(dateRecord.line.y-movement.line.y)<=26?suffix:'';
        const details=[inlineDateDetail,primary?.text,...extraLines.map(line=>line.text)].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
        const balanceLine=items.filter(line=>line.x>=upper&&line.x<header.balanceX+Math.max(35,(header.balanceWidth||0)*1.5)&&Math.abs(line.y-movement.line.y)<=Math.max(18,(header.headerHeight||0)*0.8)).sort((a,b)=>Math.abs(a.y-movement.line.y)-Math.abs(b.y-movement.line.y))[0],balanceValue=balanceLine?readMoney(balanceLine.text):null;
        const value=Math.abs(movement.value),payment=movement.kind==='payment'?value:'',receipt=movement.kind==='receipt'?value:'';
        output.push({date:iso,details:details||'Bank transaction',receipt,payment,balance:balanceValue??'',balanceExpected:Boolean(balanceLine),amount:movement.kind==='receipt'?value:-value,source,page,ocrY:Number(movement.line.y)||0,balanceY:balanceLine?(Number(balanceLine.y)||null):null,confidence:'Barclays labelled OCR columns',review:true});
      }
      for(const dateRecord of dates){
        if(usedDateLines.has(dateRecord.line))continue;
        const balanceLine=items.filter(line=>line.x>=upper&&line.x<header.balanceX+Math.max(35,(header.balanceWidth||0)*1.5)&&Math.abs(line.y-dateRecord.line.y)<=Math.max(Number(dateRecord.line.height)||0,Number(header.headerHeight)||0)*0.8).sort((a,b)=>Math.abs(a.y-dateRecord.line.y)-Math.abs(b.y-dateRecord.line.y))[0],balanceValue=balanceLine?readMoney(balanceLine.text):null;
        const {day,month}=dateRecord.parsed;let year=context?.endYear||Number(String(text).match(/\b(20\d{2})\b/)?.[1])||new Date().getFullYear();if(context?.startMonth&&context?.endMonth)year=(context.startMonth>context.endMonth&&month>=context.startMonth)?(context.startYear||year):context.endYear||year;else if(context?.endYear){const statementMatch=String(text).match(/statement\s+date\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i),statementMonth=statementMatch?months[statementMatch[2].slice(0,3).toLowerCase()]:0;if(statementMonth&&statementMonth<=2&&month>=10)year=context.endYear-1;}
        const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,inlineDetail=String(dateRecord.parsed.suffix||'').trim(),detail=[inlineDetail,...items.filter(line=>line.x>=dateBoundary&&line.x<descriptionBoundary&&Math.abs(line.y-dateRecord.line.y)<=Math.max(Number(dateRecord.line.height)||0,Number(header.headerHeight)||0)).map(line=>line.text).filter(value=>value!==dateRecord.line.text)].filter(Boolean).join(' ').trim(),normalizedDetail=detail.replace(/\s+/g,' ').trim();
        if(/^(?:(?:start|opening|end|closing)\s+balance|account\s+opened)$/i.test(normalizedDetail))continue;
        output.push({date:iso,details:detail||'Transaction amount not read',receipt:'',payment:'',amount:'',balance:balanceValue??'',balanceExpected:Boolean(balanceLine),source,page,ocrY:Number(dateRecord.line.y)||0,balanceY:balanceLine?(Number(balanceLine.y)||null):null,confidence:'REJECTED',review:true,balanceMovementUnreadable:true});
      }
    }
    return output;
  }
  function parseHsbcOcrBank(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return null;
    const allText=`${source} ${text} ${ocrLines.map(line=>line?.text||'').join(' ')}`;
    if(!/\bHSBC\b/i.test(allText))return null;
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const pages=new Map();
    for(const raw of ocrLines){const page=Number(raw?.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push({...raw,page,x:Number(raw?.x)||0,y:Number(raw?.y)||0,width:Number(raw?.width)||0,height:Number(raw?.height)||0,text:String(raw?.text||'').trim()});}
    const median=values=>{const sorted=values.filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0;};
    const label=line=>String(line?.text||'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\bdute\b/g,'date').replace(/\bdote\b/g,'date').replace(/\bderails\b/g,'details').replace(/\s+/g,' ').trim();
    const headers=[];
    for(const [page,items] of pages){
      const dates=items.filter(line=>/^date$/.test(label(line)));
      for(const date of dates){
        const nearby=name=>items.filter(line=>label(line)===name&&Math.abs(line.y-date.y)<=Math.max(22,(date.height||line.height||16)*1.5)).sort((a,b)=>Math.abs(a.y-date.y)-Math.abs(b.y-date.y))[0]||null;
        const detail=nearby('payment type and details'),out=nearby('paid out'),income=nearby('paid in'),balance=nearby('balance');
        if(!detail||!out||!income||!balance)continue;
        const anchors=[date,detail,out,income,balance].map(line=>({line,center:line.x+line.width/2})).sort((a,b)=>a.center-b.center);
        if(anchors.some((anchor,index)=>index&&anchor.center<=anchors[index-1].center))continue;
        const anchorHeight=median([date.height,detail.height,out.height,income.height,balance.height]);
        headers.push({page,items,date,detail,out,income,balance,headerY:median([date.y,detail.y,out.y,income.y,balance.y]),headerHeight:anchorHeight,centers:Object.fromEntries(anchors.map(anchor=>[label(anchor.line),anchor.center]))});
      }
    }
    // A recognizable HSBC statement with its labelled transaction table is
    // parsed by its own column layout. If OCR did not recover the headings,
    // leave the existing generic parser available as a fallback.
    if(!headers.length)return null;
    const parseDatePrefix=value=>{
      const match=String(value||'').trim().match(/^([0-9OIl|]{1,2})\s+([A-Za-z0-9|]{3,9})\s+([0-9OIl|]{2}|20[0-9OIl|]{2})\b/i);if(!match)return '';
      const day=Number(match[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')),monthText=match[2].replace(/0/g,'o').replace(/[1|]/g,'l').replace(/I/g,'l'),month=months[monthText.slice(0,3).toLowerCase()],yearDigits=match[3].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1'),year=Number(yearDigits)<100?2000+Number(yearDigits):Number(yearDigits);
      if(!month||day<1||day>31)return '';
      return parseDate(`${day}/${month}/${year}`);
    };
    const readMoney=value=>{
      let raw=String(value||'').trim().replace(/[\u00A3$\u20AC]/g,'').replace(/\bGBP\b/ig,'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/\s+/g,'').replace(/CR|DR/ig,'');
      const negative=/^\(.*\)$/.test(raw)||/^-/.test(raw);raw=raw.replace(/[()]/g,'').replace(/^[-+]/,'');
      // HSBC prints GBP amounts with two decimal places. Requiring both cents
      // avoids treating references, dates, percentages, or partial OCR as money.
      if(!/^\d[\d,]*\.\d{2}$/.test(raw))return null;
      const valueNumber=Number(raw.replace(/,/g,''));return Number.isFinite(valueNumber)?(negative?-1:1)*valueNumber:null;
    };
    const rows=[];let previousPageDate='';
    for(const header of headers.sort((a,b)=>a.page-b.page)){
      const c=header.centers,dateDetail=(c.date+c['payment type and details'])/2,detailOut=(c['payment type and details']+c['paid out'])/2,outIncome=(c['paid out']+c['paid in'])/2,incomeBalance=(c['paid in']+c.balance)/2;
      const afterHeader=header.headerY+Math.max(8,header.headerHeight*.45),items=header.items;
      const dateLines=items.filter(line=>line.y>afterHeader&&line.x<dateDetail).map(line=>({line,date:parseDatePrefix(line.text)})).filter(item=>item.date).sort((a,b)=>a.line.y-b.line.y);
      const moneyCandidates=items.filter(line=>line.y>afterHeader&&line.x>=detailOut&&line.x<incomeBalance).map(line=>({line,value:readMoney(line.text)})).filter(item=>item.value!==0&&(item.value!==null||/^[\s(+-]*(?:[£$€]\s*)?\d[\d,]*(?:[.,]\d{0,2})?[)\s]*$/.test(item.line.text))).map(item=>({...item,kind:item.line.x<outIncome?'payment':'receipt',readable:item.value!==null})).sort((a,b)=>a.line.y-b.line.y||a.line.x-b.line.x);
      const balances=items.filter(line=>line.y>afterHeader&&line.x>=incomeBalance).map(line=>({line,value:readMoney(line.text)})).filter(item=>item.value!==null).sort((a,b)=>a.line.y-b.line.y);
      const typeMarkers=items.filter(line=>line.y>afterHeader&&line.x>=(c.date+c['payment type and details'])/2&&line.x<c['payment type and details']+Math.max(24,header.headerHeight)&&/^(?:CR|BP|SO)$/i.test(line.text.trim())).sort((a,b)=>a.y-b.y);
      const isBalanceForward=value=>{const normalized=String(value||'').toLowerCase().replace(/[^a-z]/g,'').replace(/baiance/g,'balance');return /balance(?:brought|carried)/.test(normalized);};
      // Estimate each page's transaction rhythm from OCR row spacing, so a missing amount does not shift neighboring details.
      const movementHeights=moneyCandidates.map(item=>Number(item.line.height)||0),lineHeight=median([...movementHeights,...typeMarkers.map(line=>Number(line.height)||0),...dateLines.map(item=>Number(item.line.height)||0)])||header.headerHeight||16;
      const movementGaps=moneyCandidates.slice(1).map((item,index)=>Number(item.line.y)-Number(moneyCandidates[index].line.y)).filter(gap=>gap>lineHeight*2.4&&gap<lineHeight*7);
      const markerGaps=typeMarkers.slice(1).map((line,index)=>Number(line.y)-Number(typeMarkers[index].y)).filter(gap=>gap>lineHeight*2.4&&gap<lineHeight*7);
      const pitch=median([...movementGaps,...markerGaps])||lineHeight*4;
      const markerOffset=median(moneyCandidates.map(item=>{const prior=[...typeMarkers].reverse().find(line=>line.y<=item.line.y);return prior?Number(item.line.y)-Number(prior.y):0;}).filter(gap=>gap>lineHeight*.6&&gap<=pitch*1.35))||lineHeight*2;
      const slots=moneyCandidates.map(item=>({...item,inferred:false}));
      const pushInferredSlot=(y,kind='')=>{if(slots.some(slot=>Math.abs(Number(slot.line.y)-y)<=lineHeight*.65))return;slots.push({line:{page:header.page,x:kind==='receipt'?c['paid in']:kind==='payment'?c['paid out']:c['paid in'],y,width:0,height:lineHeight,text:''},value:null,kind,readable:false,inferred:true});};
      for(let index=1;index<moneyCandidates.length;index++){
        const previous=moneyCandidates[index-1],current=moneyCandidates[index],gap=Number(current.line.y)-Number(previous.line.y),steps=Math.round(gap/pitch);
        if(steps<2||Math.abs(gap-steps*pitch)>Math.max(lineHeight*1.2,pitch*.18))continue;
        for(let step=1;step<steps;step++){
          const y=Number(previous.line.y)+pitch*step;
          const rowStart=y-markerOffset,marker=[...typeMarkers].reverse().find(line=>Number(line.y)<=rowStart+lineHeight*.65&&Number(line.y)>=rowStart-pitch*.8),kind=marker?/^CR$/i.test(marker.text.trim())?'receipt':'payment':'';
          pushInferredSlot(y,kind);
        }
      }
      // Amounts normally sit one printed line below the transaction's type or
      // date. When OCR loses the entire amount cell there may be no amount line
      // from which to spot a gap, so use those row labels as relative anchors.
      const rowCues=[...typeMarkers.map(line=>({line,kind:/^CR$/i.test(line.text.trim())?'receipt':'payment'})),...dateLines.filter(item=>!typeMarkers.some(marker=>Math.abs(Number(marker.y)-Number(item.line.y))<=markerOffset+lineHeight*.6)).filter(item=>!items.some(line=>isBalanceForward(line.text)&&Math.abs(Number(line.y)-Number(item.line.y))<=lineHeight*.9)).filter(item=>items.some(line=>line.x>=dateDetail&&line.x<detailOut&&line.y>=Number(item.line.y)-lineHeight*.6&&line.y<=Number(item.line.y)+markerOffset+lineHeight*.5&&!isBalanceForward(line.text))).map(item=>({line:item.line,kind:''}))].sort((a,b)=>a.line.y-b.line.y);
      for(const cue of rowCues){const expectedY=Number(cue.line.y)+markerOffset,hasAmount=moneyCandidates.some(item=>Number(item.line.y)>=Number(cue.line.y)-lineHeight*.5&&Number(item.line.y)<=expectedY+lineHeight*.8);if(!hasAmount)pushInferredSlot(expectedY,cue.kind);}
      slots.sort((a,b)=>a.line.y-b.line.y||a.line.x-b.line.x);
      const movements=[];
      for(let movementIndex=0;movementIndex<slots.length;movementIndex++){
        const movement=slots[movementIndex],movementY=Number(movement.line.y),nearbyCue=rowCues.filter(cue=>Number(cue.line.y)<=movementY+lineHeight*.35&&Number(cue.line.y)>=movementY-pitch*.8).sort((a,b)=>Number(b.line.y)-Number(a.line.y))[0],rowStart=nearbyCue?Number(nearbyCue.line.y):movementY-markerOffset,previousSlot=slots[movementIndex-1],detailStart=Math.max(rowStart-lineHeight*.25,previousSlot?Number(previousSlot.line.y)+lineHeight*.12:-Infinity),explicitDate=[...dateLines].reverse().find(item=>Number(item.line.y)<=rowStart+lineHeight*.55),date=explicitDate?.date||previousPageDate;
        if(!date)continue;
        const detailLines=items.filter(line=>line.x>=dateDetail&&line.x<detailOut&&line.y>=detailStart&&line.y<=movementY+lineHeight*.4&&!isBalanceForward(line.text)).sort((a,b)=>a.y-b.y||a.x-b.x);
        const details=detailLines.map(line=>line.text).join(' ').replace(/\s+/g,' ').trim();
        const balance=balances.filter(item=>Math.abs(Number(item.line.y)-Number(movement.line.y))<=Math.max(lineHeight*.7,Number(movement.line.height||0)*.6)).sort((a,b)=>Math.abs(Number(a.line.y)-Number(movement.line.y))-Math.abs(Number(b.line.y)-Number(movement.line.y)))[0]||null;
        let kind=movement.kind;
        if(!kind){const rowMarkers=typeMarkers.filter(line=>Number(line.y)<=rowStart+lineHeight*.65&&Number(line.y)>=rowStart-pitch*.8);const marker=rowMarkers.at(-1);if(marker)kind=/^CR$/i.test(marker.text.trim())?'receipt':'payment';}
        const value=movement.readable?Math.abs(movement.value):'',signed=value===''?'':kind==='receipt'?value:kind==='payment'?-value:'';
        movements.push({date,details:details||'Bank transaction amount not read',receipt:value!==''&&kind==='receipt'?value:'',payment:value!==''&&kind==='payment'?value:'',amount:signed,balance:balance?.value??'',balanceExpected:Boolean(balance),source,page:header.page,ocrY:Number(movement.line.y)||0,balanceY:balance?.line.y??null,confidence:movement.readable?'HSBC labelled OCR columns':'REJECTED',review:true,...(!movement.readable?{balanceMovementUnreadable:true}: {})});
      }
      if(movements.length){
        const firstMovementY=slots[0]?.line.y??Infinity,pageOpening=balances.filter(item=>item.line.y<firstMovementY).at(-1)?.value;
        movements[0].pageOpeningBalance=pageOpening??'';
        if(!rows.length&&pageOpening!==undefined)movements[0].openingBalance=pageOpening;
        rows.push(...movements);
      }
      if(dateLines.length)previousPageDate=dateLines.at(-1).date;
    }
    return rows;
  }
  function parseOcrBank(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return [];
    const metroReportRows=parseMetroOnlineTransactionReport(ocrLines,text,source);if(metroReportRows!==null)return metroReportRows;
    const hsbcRows=parseHsbcOcrBank(ocrLines,text,source);if(hsbcRows!==null){if(hsbcRows.length)return hsbcRows;}
    const barclaysRows=parseBarclaysOcrBank(ocrLines,text,source);if(barclaysRows!==null){const opening=bankOpeningBalance(`${text}\n${ocrLines.map(line=>line?.text||'').join('\n')}`);if(barclaysRows.length&&opening!==null)barclaysRows[0].openingBalance=opening;return barclaysRows;}
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const yearMatch=String(text).match(/statement\s+date\s+\d{1,2}\s+([A-Za-z]{3,9})\s+(20\d{2})/i),year=yearMatch?Number(yearMatch[2]):new Date().getFullYear(),statementMonth=yearMatch?months[yearMatch[1].slice(0,3).toLowerCase()]:0;
    const cleanDate=value=>{const s=String(value||'').trim(),m=s.match(/^([0-9OIl|]{1,2})\s+([A-Za-z0-9|]{3,9})\b/i),dayText=m?m[1]:s.match(/^([0-9OIl|]{1,2})\b/)?.[1],monthText=m?m[2].replace(/0/g,'o').replace(/[1|]/g,'l').replace(/I/g,'l'):'',day=Number(String(dayText||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')),month=monthText?months[monthText.slice(0,3).toLowerCase()]:statementMonth;if(!month||day<1||day>31)return '';return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;};
    const byPage=new Map();for(const line of ocrLines){const page=Number(line.page)||1;if(!byPage.has(page))byPage.set(page,[]);byPage.get(page).push({...line,x:Number(line.x)||0,y:Number(line.y)||0,text:String(line.text||'').trim()});}
    const output=[];
    for(const pageLines of byPage.values()){
      const dates=pageLines.filter(l=>l.x<160&&cleanDate(l.text)&&l.y>100).sort((a,b)=>a.y-b.y);
      const movements=pageLines.filter(l=>l.y>100&&((l.x>=410&&l.x<525)||(l.x>=525&&l.x<625))&&moneyTokens(l.text).length).map(l=>{const token=moneyTokens(l.text)[0];return {...l,kind:l.x<525?'payment':'receipt',value:Math.abs(token.value)};}).sort((a,b)=>a.y-b.y||a.x-b.x);
      for(let i=0;i<movements.length;i++){
        const movement=movements[i],dateLine=[...dates].reverse().find(d=>d.y<=movement.y+8);if(!dateLine)continue;const date=cleanDate(dateLine.text);if(!date)continue;
        const nextY=movements[i+1]?.y??(movement.y+90),detailLines=pageLines.filter(l=>l.x>=160&&l.x<420&&l.y>=movement.y-5&&l.y<nextY-2).sort((a,b)=>a.y-b.y),detail=detailLines.map(l=>l.text).join(' ').replace(/\s+/g,' ').trim();
        output.push({date,details:detail||'Bank transaction',receipt:movement.kind==='receipt'?movement.value:'',payment:movement.kind==='payment'?movement.value:'',amount:movement.kind==='receipt'?movement.value:-movement.value,source,page:movement.page||1,ocrY:Number(movement.y)||0,balanceY:Number(movement.y)||0,confidence:'Review OCR row',review:true});
      }
    }
    const opening=bankOpeningBalance(`${text}\n${ocrLines.map(line=>line?.text||'').join('\n')}`);if(output.length&&opening!==null)output[0].openingBalance=opening;return output;
  }
  function firstMatch(text,patterns){for(const p of patterns){const m=text.match(p);if(m)return m[1].trim();}return '';}
  function cleanInvoiceNumber(value){
    let candidate=String(value??'').replace(/\s+/g,' ').trim().replace(/\s*([\/-])\s*/g,'$1').replace(/^[#:.;\s]+|[;,.:\s]+$/g,'');
    if(!candidate||candidate.length<3||(!/\d/.test(candidate)&&!/^INV[-\/]/i.test(candidate))||/^(?:invoice|number|no|date|unit|weight)$/i.test(candidate))return '';
    return candidate;
  }
  function fourDigitDocumentNumber(value){
    const candidate=String(value??'').trim(),match=candidate.match(/^(FS|WZ)\s*([0-9]{4,})\b/i);
    if(!match)return candidate;
    // Keep the full WZ delivery identifier (for example 673354). Only Polish
    // supplier invoice numbers use the four-digit suffix convention.
    return /^WZ$/i.test(match[1])?match[2]:match[2].slice(-4);
  }
  function normalizeInvoiceNumber(value){const digits=String(value??'').replace(/\D/g,'');return digits?digits.slice(-4):'';}
  function normalizeMaspoInvoiceNumber(value){
    const raw=String(value??'').trim(),serial=raw.match(/^(\d{3,8})\s*\/\s*[A-Z]{2,}\s*\/\s*\d{1,2}\s*\/\s*\d{4}$/i);
    return serial?serial[1].slice(-4):normalizeInvoiceNumber(raw);
  }
  function extractInvoiceNumber(text){
    const flat=String(text||'').replace(/\s+/g,' ').trim();
    // Prefer an explicitly labelled number. This prevents product descriptions
    // containing the word "invoice" from being mistaken for the number.
    const labelled=[
      /\b(?:tax\s+)?invoice\s*(?:number|no\.?|nr\.?|#)\s*(?:test\s+)?[:#.-]?\s*(INV[-\/]?[A-Z0-9-]+)/i,
      /\b(?:tax\s+)?invoice\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*([A-Z0-9]+(?:\s*[\/-]\s*[A-Z0-9]+)+)/i,
      /\b(?:tax\s+)?invoice\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i,
      /\binv\.?\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*([A-Z0-9]+(?:\s*[\/-]\s*[A-Z0-9]+)+)/i,
      /\binv\.?\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9\/-]{2,})/i,
      /\b(?:tax\s+)?invoice\s*[:#.-]\s*([A-Z0-9]+(?:\s*[\/-]\s*[A-Z0-9]+)+)/i,
      /\b(?:document|doc\.?|faktura|numer\s+faktury)\s*(?:number|no\.?|nr\.?|#)?\s*[:#.-]\s*([A-Z0-9]+(?:\s*[\/-]\s*[A-Z0-9]+)+)/i,
      /\b(?:reference|ref|our\s+ref)\s*[:#.-]\s*([A-Z0-9]+(?:\s*[\/-]\s*[A-Z0-9]+)+)/i
    ];
    for(const pattern of labelled){const match=flat.match(pattern),value=cleanInvoiceNumber(match?.[1]);if(value)return value;}
    // Some suppliers print e.g. "Invoice FS 23855/MAG/2026" without a
    // number/no label. Require a numeric, structured identifier here.
    const bare=[
      /\b(?:tax\s+)?invoice\s+((?:[A-Z]{1,8}\s*)?\d[\dA-Z]*(?:\s*[\/-]\s*[A-Z0-9]+)+)/i,
      /\b(?:tax\s+)?invoice\s*[:#.-]\s*([A-Z0-9][A-Z0-9\/-]{2,})/i
    ];
    for(const pattern of bare){const match=flat.match(pattern),value=cleanInvoiceNumber(match?.[1]);if(value)return value;}
    return '';
  }
  function parseInvoice(text,source=''){
    const flat=text.replace(/\s+/g,' ').trim(),ls=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),date=firstMatch(flat,[/(?:invoice|tax invoice|dated|date)\s*(?:no\.?|number)?\s*[:#-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/i,/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/]);
    const number=fourDigitDocumentNumber(extractInvoiceNumber(flat));
    const vatRaw=firstMatch(flat,[/(?:VAT|tax)\s*(?:amount)?\s*[:#-]?\s*([\u00A3$\u20AC]?\s*\(?\d[\d,]*\.\d{2}\)?)/i]);
    const discountWindow=flat.match(/total\s+discount\b([\s\S]{0,100}?)amount\s+due/i)?.[1]||'',discountValues=[...discountWindow.matchAll(/\d[\d,.]*/g)].map(match=>invoiceAmount(match[0])).filter(value=>value!==null);
    const totalRaw=firstMatch(flat,[new RegExp('\\b(?:total\\s*(?:due|payable)?|amount\\s*due|grand\\s*total|balance\\s*due)\\s*[:#-]?\\s*('+money+')','i')]);
    const subRaw=firstMatch(flat,[/(?:subtotal|net\s*amount|excl(?:uding)?\s*VAT)\s*[:#-]?\s*([\u00A3$\u20AC]?\s*\(?\d[\d,]*\.\d{2}\)?)/i]);
    const all=moneyTokens(flat).map(x=>x.value).filter(x=>x>=0),total=amount(totalRaw)||all.at(-1)||null,vat=amount(vatRaw),subtotal=amount(subRaw);
    const supplier=firstMatch(flat,[/(?:from|supplier|seller|sold\s*by)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &'.,-]{2,})/i])||ls.slice(0,2).find(x=>!/^invoice/i.test(x))||'';
    return {invoiceNumber:number,date:parseDate(date),supplier: supplier.replace(/\s{2,}/g,' ').trim(),subtotal:subtotal??'',vat:vat??'',total:total??'',currency:/\u20AC/.test(flat)?'EUR':/\$/.test(flat)?'USD':'GBP',source,confidence:number&&date&&total!==null?'Review values':'Low',review:!(number&&date&&total!==null)};
  }
  function extractDeliveryIdentifier(flat){
    const exact=firstMatch(flat,[/\bDELIVERY\s+([0-9]{3,}\s*\/\s*[A-Z0-9]+(?:\s*\/\s*[A-Z0-9]+)?)/i,/\bWZ\s*[-#:]?\s*([0-9]{3,}\s*\/\s*[A-Z0-9]+(?:\s*\/\s*[A-Z0-9]+)?)/i]);
    if(exact)return exact;
    // OCR occasionally inserts spaces or reads zero as O in a delivery
    // number (for example `6691 OO/MAG/2026`). Keep the numeric part and
    // normalise those character substitutions before extracting the number.
    const noisy=flat.match(/\bDELIVERY\s+([0-9OIL\s]{3,})(?=\s*(?:\/|[A-Z]{2,}))/i);
    if(noisy){
      const digits=noisy[1].replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/\s+/g,'');
      if(/^\d{3,}$/.test(digits))return `${digits}/MAG/2026`;
    }
    return '';
  }
  function isPolishVillageBreadText(value){
    // Windows OCR sometimes reads the `T` in LTD as `i` or `1` (for example,
    // `Polish Village Bread LiD`). These variants still identify this supplier.
    return /\bPolish\s+(?:Village|Viiiage|Milage|Villag[e6])\s+Bread\s+L(?:T|I|1)D\b/i.test(String(value||''));
  }
  function parseWzInvoice(flat,source='',ocrLines,options={}){
    const delivery=extractDeliveryIdentifier(flat);
    if(!delivery)return null;
    const date=parseDate(firstMatch(flat,[/delivery\s+date\b[\s\S]{0,100}?((?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}))/i,/(?:date|dated)\s*[:.]?\s*((?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}))/i,/((?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}))/i]));
    const statementStart=flat.search(/statement\s+of\s+the\s+account/i);
    const deliveryStart=flat.search(/\bDELIVERY\s+/i),deliverySection=flat.slice(deliveryStart>=0?deliveryStart:0,statementStart>=0?statementStart:flat.length);
    const directTail=deliverySection.match(/(?:total\s+)?issued\s+baskets\s*:\s*([\s\S]{0,120}?)(?=ret(?:urned|umed)\s+baskets|$)/i)?.[1]||'';
    const directPrintedMatch=flat.match(/\btotal\s+issued\s+baskets\s*:\s*(?:notes\s*:\s*)?((?:£|€|\$)?\s*\d[\d\s,.;]*[.,;]\s*\d{2})/i),directPrintedTotal=directPrintedMatch?invoiceAmount(directPrintedMatch[1]):null;
    // WZ forms print the real delivery total on the same baseline as the
    // bold `Total` label. OCR preserves each line's position, so use that
    // layout signal before looking at the account statement below. This
    // avoids confusing an invoice balance or returned-basket amount with the
    // value delivered on this WZ document.
    const layoutCandidate=Array.isArray(ocrLines)?(ocrLines.filter(line=>/^(?:total|tota[i1l]|tout)$/i.test(String(line?.text||'').trim())).flatMap(label=>{const x=Number(label?.x)||0,labelRight=x+(Number(label?.width)||0),minGap=Math.max(8,Math.min(28,(Number(label?.width)||0)*0.2));return ocrLines.filter(line=>Number(line?.page)===Number(label?.page)&&Number(line?.x)>labelRight+minGap&&Math.abs(Number(line?.y)-Number(label?.y))<=35).map(line=>{const raw=String(line?.text||''),match=raw.match(/\b\d[\d,.;]*\b/);return match?{value:invoiceAmount(match[0]),raw}:null})}).find(item=>item?.value!==null)??null):null;
    const layoutTotal=layoutCandidate?.value??null,layoutSuspect=Boolean(layoutCandidate&&(/[;]/.test(layoutCandidate.raw)||/[£€$]/.test(layoutCandidate.raw)||/[^\d\s,.;£€$]/.test(layoutCandidate.raw)||!/[,.]\s*\d{2}/.test(layoutCandidate.raw)));
    // A continuation page can lose the `Total` label while retaining the
    // printed delivery total at the top right (for example 327,96).
    const summaryCandidates=Array.isArray(ocrLines)?ocrLines.filter(line=>Number(line?.y)<260&&Number(line?.x)>1450&&/[0-9][,.;]\s*\d{2}/.test(String(line?.text||''))).map(line=>{const pageLines=ocrLines.filter(other=>Number(other?.page)===Number(line?.page)),hasItemRows=pageLines.filter(other=>Number(other?.x)>1450&&Number(other?.y)>Number(line?.y)+20&&Number(other?.y)<650&&/[0-9][,.]\s*\d{2}/.test(String(other?.text||''))).length>=2;return hasItemRows?null:{value:invoiceAmount(String(line.text||'')),raw:String(line.text||'')}}).filter(item=>item&&item.value!==null):[];
    const summaryCandidate=summaryCandidates[0]||null,summaryTotal=summaryCandidate?.value??null,summarySuspect=Boolean(summaryCandidate&&(/[;]/.test(summaryCandidate.raw)||/[^\d\s,.;£€$]/.test(summaryCandidate.raw)||!/[,.]\s*\d{2}/.test(summaryCandidate.raw)));
    // When OCR drops the bold `Total` word, Polish WZ forms place the total
    // immediately above the `Issued baskets` label in the far-right amount
    // column. Accept that single printed summary value, while excluding
    // continuation pages whose top-right area contains several item rows.
    const basketCandidate=Array.isArray(ocrLines)?ocrLines.filter(label=>/issued\s+baskets\s*:/i.test(String(label?.text||''))).flatMap(label=>ocrLines.filter(line=>Number(line?.page)===Number(label?.page)&&Number(line?.x)>1450&&Number(line?.y)<Number(label?.y)&&Number(line?.y)>=Number(label?.y)-120&&/\d/.test(String(line?.text||''))).map(line=>({line,value:invoiceAmount(String(line.text||'')),raw:String(line.text||'')}))).sort((a,b)=>Number(b.line.y)-Number(a.line.y)).find(item=>item.value!==null)??null:null;
    const postTableCandidate=Array.isArray(ocrLines)?(()=>{for(const page of [...new Set(ocrLines.map(line=>Number(line?.page)||1))]){const pageLines=ocrLines.filter(line=>(Number(line?.page)||1)===page),statementY=pageLines.filter(line=>/statement\s+of\s+the\s+account/i.test(String(line?.text||''))).map(line=>Number(line.y)||0).sort((a,b)=>a-b)[0]??Infinity,amounts=pageLines.filter(line=>Number(line?.x)>1450&&(Number(line?.y)||0)<statementY&&/[0-9][,.;]\s*\d{2}/.test(String(line?.text||''))).map(line=>({line,y:Number(line.y)||0,value:invoiceAmount(String(line.text||'')),raw:String(line.text||'')})).filter(item=>item.value!==null).sort((a,b)=>a.y-b.y);if(amounts.length<4)continue;const gaps=amounts.slice(1).map((item,i)=>item.y-amounts[i].y).filter(gap=>gap>0&&gap<160).sort((a,b)=>a-b);if(!gaps.length)continue;const typical=gaps[Math.floor(gaps.length/2)];for(let i=1;i<amounts.length;i++){const gap=amounts[i].y-amounts[i-1].y;if(gap>=typical*1.6&&gap<500){return amounts[i];}}}return null;})():null;
    // Some WZ scans place the basket count/price before the final total, for
    // example `Notes: 1/14.40 341`.  The final whole number is the total in
    // that layout; do not mistake the per-item price for the document total.
    const splitTotal=directTail.match(/\b\d+\s*\/\s*\d+[.,]\d{2}\s+(\d[\d,.]*)\b/);
    // Use only a total printed on the delivery document. Never reconstruct it
    // from item rows or substitute a supplier-account balance. If OCR cannot
    // read a document total, leave it blank and flag the row for review.
    const total=layoutTotal??summaryTotal??basketCandidate?.value??postTableCandidate?.value??(splitTotal?invoiceAmount(splitTotal[1]):directPrintedTotal);
    const polish=isPolishVillageBreadText(flat),supplier=polish?'Polish Village Bread LTD':(firstMatch(flat,[/seller\s*:\s*(?:customer\s*:\s*)?([A-Za-z][A-Za-z0-9 &.' ,-]{2,}?)(?=\s+\d{1,4}(?:[- ]|$)|\s+\d{3,}\b|\s+VAT\s*:|\s+invoice\b|$)/i,/(?:from|supplier|seller|sold\s*by)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &.' ,-]{2,80})/i,/^(.+?)\s+Invoice\b/i])||'');
    const fullNumber=fourDigitDocumentNumber(`WZ ${delivery.replace(/\s+/g,'')}`),number=polish?String(fullNumber).replace(/\D/g,'').slice(-4):fullNumber;
    const verifyPolishWzAtHighResolution=Boolean(polish&&options?.verifyPolishWzTotals&&Number(options?.ocrScale||0)<4.5&&total!==null);
    const retryOcr=layoutSuspect||summarySuspect||Boolean(basketCandidate&&!/[,.]\s*\d{2}/.test(basketCandidate.raw))||Boolean(splitTotal&&!/[,.]\s*\d{2}/.test(splitTotal[1]))||total===null||verifyPolishWzAtHighResolution;
    const safeTotal=retryOcr?'':(total??'');
    return {invoiceNumber:number,date,supplier:supplier.trim(),subtotal:safeTotal,vat:'',total:safeTotal,firstPassTotal:retryOcr&&polish&&total!==null?total:'',documentType:'DELIVERY NOTE',currency:'GBP',source,confidence:layoutTotal!==null||summaryTotal!==null||basketCandidate||postTableCandidate||splitTotal||directPrintedTotal!==null?'WZ delivery total':'WZ total not detected',retryOcr,review:!(number&&date&&total!==null)||retryOcr};
  }
  function maspoMoney(value){const raw=String(value??'').trim().replace(/[Oo]/g,'0'),match=raw.match(/-?\d[\d\s,.;]*[.,;]\s*\d{2}/);return match?{raw:match[0],value:invoiceAmount(match[0])}:null;}
  function maspoMoneyLoose(value){const original=String(value??'').trim();if(/^ODO$/i.test(original))return {raw:original,value:0};const parsed=maspoMoney(value);if(parsed)return parsed;const raw=original.replace(/[Oo]/g,'0'),digits=raw.match(/^(-?)(\d{3,8})$/);if(!digits)return null;const number=Number(`${digits[1]}${digits[2].slice(0,-2)}.${digits[2].slice(-2)}`);return Number.isFinite(number)?{raw:digits[0],value:number}:null;}
  function maspoVatMoney(value){
    const raw=String(value??'').trim();
    if(/^(?:[ODQ0]{1,3}|[Oo0][Mm]|[ODQ0][.,;][ODQ0]{0,2}|[Oo0][Pp][Oo0])$/i.test(raw))return {raw,value:0};
    // A non-zero VAT cell must contain the printed decimal separator. OCR may
    // turn 18.22 into `182`; treating that as 1.82 silently changes the tax.
    // Keep the cell unreadable until another scan produces an explicit amount.
    const normalized=raw.replace(/\b(?:GBP|PLN)\b/ig,'').replace(/[oO]/g,'0').trim();
    if(!/^-?(?:(?:\d{1,3}(?:[\s,]\d{3})+)|\d+)[.,;]\s*\d{2}$/.test(normalized))return null;
    return {raw,value:invoiceAmount(normalized)};
  }
  function maspoVatMoneyFromLine(line,lines){
    const direct=maspoVatMoney(line?.text);if(direct)return direct;
    const raw=String(line?.text??'').trim();
    // OCR can fuse a comma and decimal digit into a confusable glyph.
    // OCR can fuse a comma and decimal digit into one confusable glyph.
    // Interpret it as six only when nearby printed cells confirm its width.

    const normalizedRaw=raw.replace(/^(-?\d{1,2})[Ee\u00DF\u1E9E](\d)$/,(match,whole,last)=>`${whole}6${last}`).replace(/[\u00DF\u1E9E]/g,'6');
    const digits=normalizedRaw.match(/^(-?)(\d{3,6})$/),width=Number(line?.width);
    if(!digits||!Number.isFinite(width)||width<=0)return null;
    // Some Windows OCR passes preserve every printed digit but drop the comma
    // (for example `25,20` -> `2520`). Recover the separator only when the
    // text-box width agrees with a complete currency value. Calibrate the
    // printed character width from clear monetary cells in the same invoice
    // pages. This rejects cropped reads such as `18,22` -> `182`, whose box is
    // too wide for a three-digit amount, rather than silently accepting 1.82.
    const getReferences=candidates=>candidates.filter(other=>other!==line&&Number(other.x)>=1200&&Number(other.x)<1950).map(other=>{
      const text=String(other.text??'').trim().replace(/\s/g,'');
      if(!/^(?:-?\d{1,4}[.,;]\d{2}|[Oo0][.,;][Oo0]{2})$/i.test(text))return null;
      const money=maspoVatMoney(text);if(!money)return null;
      const boxWidth=Number(other.width);return Number.isFinite(boxWidth)&&boxWidth>0?boxWidth/text.length:null;
    }).filter(value=>Number.isFinite(value)&&value>0);
    const localReferences=getReferences((lines||[]).filter(other=>Number(other.page)===Number(line?.page)&&Math.abs(Number(other.y)-Number(line?.y))<=110&&Math.abs(Number(other.x)-Number(line?.x))<=350));
    const references=localReferences.length?localReferences:getReferences((lines||[]).filter(other=>Number(other.y)>=850&&Number(other.y)<2600));
    if(!references.length)return null;
    references.sort((a,b)=>a-b);const unit=references[Math.floor(references.length/2)],expected=unit*(digits[2].length+1),tolerance=Math.max(2,unit*.65);
    if(Math.abs(width-expected)>tolerance)return null;
    const normalized=`${digits[1]}${digits[2].slice(0,-2)}.${digits[2].slice(-2)}`;
    const value=invoiceAmount(normalized);return value===null?null:{raw,value};
  }
  function maspoRow(lines,labelPattern,afterY=-Infinity){
    const matches=line=>typeof labelPattern==='function'?labelPattern(String(line.text||'')):labelPattern.test(String(line.text||''));
    const labels=lines.filter(line=>Number(line.y)>=afterY&&matches(line)).sort((a,b)=>Number(a.y)-Number(b.y));
    for(const label of labels){const same=lines.filter(line=>line.page===label.page&&Math.abs(Number(line.y)-Number(label.y))<=38&&Number(line.x)>1280).map(line=>({line,money:maspoMoneyLoose(line.text)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.x)-Number(b.line.x));
      // The summary table shifts horizontally between Maspo scan layouts.
      // For its usual three numeric cells, read left-to-right instead of
      // relying on fixed x cutoffs that can put net into the VAT column.
      if(same.length===3)return {net:same[0].money.value,vat:maspoVatMoney(same[1].line.text)?.value??null,gross:same[2].money.value,y:Number(label.y)||0,label:String(label.text||'')};
      const net=same.filter(item=>Number(item.line.x)<1620).at(-1)?.money,vatItem=same.filter(item=>Number(item.line.x)>=1620&&Number(item.line.x)<1755)[0],vat=vatItem?maspoVatMoney(vatItem.line.text):null,gross=same.filter(item=>Number(item.line.x)>=1755).at(0)?.money;
      // Compact final-page summaries can omit the net column in OCR and shift
      // VAT just past the usual VAT boundary. In that two-cell layout, the
      // left cell is VAT and the right cell is the invoice gross total.
      if(!net&&!vat&&same.length===2)return {net:null,vat:maspoVatMoney(same[0].line.text)?.value??null,gross:same[1].money.value,y:Number(label.y)||0,label:String(label.text||'')};
      if(net||vat||gross)return {net:net?.value??null,vat:vat?.value??null,gross:gross?.value??null,y:Number(label.y)||0,label:String(label.text||'')};}
    return null;
  }
  function maspoTotalInGbpLabel(text){return /\btot[a-z]{0,2}\s+(?:[a-z]{1,2}\s+)?GBP\b/i.test(String(text||''));}
  function maspoCompactSummary(lines){
    const pages=[...new Set((lines||[]).filter(line=>Number(line.y)<500&&/\bamount\s+due\s*:|\btotal\s*:/i.test(String(line.text||''))).map(line=>Number(line.page)||1))];
    const valueFor=(page,pattern,minX,maxX,parse=maspoMoney)=>{const labels=(lines||[]).filter(line=>(Number(line.page)||1)===page&&Number(line.y)<500&&pattern.test(String(line.text||''))).sort((a,b)=>Number(a.y)-Number(b.y));for(const label of labels){const value=(lines||[]).filter(line=>(Number(line.page)||1)===page&&Number(line.x)>=minX&&Number(line.x)<maxX&&Number(line.y)>=Number(label.y)&&Number(line.y)-Number(label.y)<=125).map(line=>({line,money:parse(line.text)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.y)-Number(b.line.y))[0]?.money?.value;if(value!==undefined)return value;}return null;};
    for(const page of pages){const row={net:valueFor(page,/\bnet\s+value\b/i,1390,1600),vat:valueFor(page,/\b(?:tax|vat)\s+value\b/i,1600,1755,maspoVatMoney),gross:valueFor(page,/\bgross\s+value\b/i,1755,1950)};if(row.gross!==null||row.net!==null||row.vat!==null)return row;}
    return null;
  }
  function maspoFooterInvoice(flat){
    // Older Maspo/LON scans can start mid-invoice: the seller/header is on a
    // missing first page, while the continued item pages retain this footer.
    // Require both the supplier's structured LON reference and its distinctive
    // item/value table so a customer's account statement cannot trigger it.
    return /\binvoice\s+\d{5,8}\s*\/\s*LON\s*\/\s*\d{1,2}\s*\/\s*\d{4}\b/i.test(flat)&&/\bitem\s+name\b/i.test(flat)&&/\bgross\s+value\b/i.test(flat);
  }
  function maspoFooterTotal(flat){
    const words=flat.match(/\btotal\s+in\s+words\s*:\s*((?:\d[\d\s.,]*\d|\d)[,.]\d{2})/i);
    return words?invoiceAmount(words[1]):null;
  }
  function maspoFooterVat(flat,lines){
    const pages=[...new Set((lines||[]).map(line=>Number(line.page)||1))].sort((a,b)=>b-a);
    for(const page of pages){
      const pageLines=(lines||[]).filter(line=>(Number(line.page)||1)===page),taxHeaders=pageLines.filter(line=>/\btax\s+value\b/i.test(String(line.text||''))).sort((a,b)=>Number(b.y)-Number(a.y));
      for(const header of taxHeaders){
        const vatX=Number(header.x)||0,totals=pageLines.filter(line=>/^\s*total\s*:?\s*$/i.test(String(line.text||''))&&pageLines.some(other=>/\bin\s+words\s*:/i.test(String(other.text||''))&&Number(other.y)>Number(line.y)&&Number(other.y)-Number(line.y)<220)).sort((a,b)=>Number(b.y)-Number(a.y));
        for(const total of totals){
          const cell=pageLines.filter(line=>Math.abs(Number(line.y)-Number(total.y))<=38&&Number(line.x)>=vatX-35&&Number(line.x)<=vatX+180).map(line=>({line,money:maspoVatMoneyFromLine(line,pageLines)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Math.abs(Number(a.line.x)-vatX)-Math.abs(Number(b.line.x)-vatX))[0];
          if(cell)return cell.money.value;
        }
        const words=pageLines.filter(line=>/\btotal\s+in\s+words\s*:/i.test(String(line.text||''))).sort((a,b)=>Number(b.y)-Number(a.y))[0],endY=words?Number(words.y):Infinity;
        const values=pageLines.filter(line=>Number(line.y)>Number(header.y)&&Number(line.y)<endY&&Number(line.x)>=vatX-35&&Number(line.x)<=vatX+180).map(line=>({line,money:maspoVatMoneyFromLine(line,pageLines)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.y)-Number(b.line.y));
        if(values.length)return values.at(-1).money.value;
      }
    }
    const matches=[...String(flat||'').matchAll(/\btax\s+value\b/ig)],last=matches.at(-1),tail=last?String(flat).slice(last.index+last[0].length):'',summary=tail.split(/\bgross\s+value\b/i)[0].slice(0,160);
    const values=[...summary.matchAll(/\b\d[\d\s]*[,.]\s*\d{2}\b/g)].map(match=>invoiceAmount(match[0])).filter(value=>value!==null);
    return values.at(-1)??null;
  }
  function maspoColumnTotalRow(lines){
    const labels=(lines||[]).filter(line=>/^\s*total\s*:\s*$/i.test(String(line.text||''))&&(lines||[]).some(other=>other.page===line.page&&/\bin\s+words\s*:/i.test(String(other.text||''))&&Number(other.y)>Number(line.y)&&Number(other.y)-Number(line.y)<190)).sort((a,b)=>Number(a.y)-Number(b.y));
    for(const label of labels){const same=(lines||[]).filter(line=>line.page===label.page&&Math.abs(Number(line.y)-Number(label.y))<=38&&Number(line.x)>1280).map(line=>({line,money:maspoMoneyLoose(line.text)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.x)-Number(b.line.x));if(same.length===3)return {net:same[0].money.value,vat:maspoVatMoney(same[1].line.text)?.value??null,gross:same[2].money.value,y:Number(label.y)||0};const net=same.filter(item=>Number(item.line.x)<1580).at(-1)?.money,vatItem=same.filter(item=>Number(item.line.x)>=1580&&Number(item.line.x)<1755)[0],vat=vatItem?maspoVatMoney(vatItem.line.text):null,gross=same.filter(item=>Number(item.line.x)>=1755).at(0)?.money;if(net||vat||gross)return {net:net?.value??null,vat:vat?.value??null,gross:gross?.value??null,y:Number(label.y)||0};}
    return null;
  }
  function maspoSummaryVat(lines){
    const pages=[...new Set((lines||[]).map(line=>Number(line.page)||1))];
    const closingPages=new Set(pages.filter(page=>{const pageLines=(lines||[]).filter(line=>(Number(line.page)||1)===page);return pageLines.some(line=>/^\s*total\s*:/i.test(String(line.text||'')))&&pageLines.some(line=>/\bin\s+words\s*:/i.test(String(line.text||'')));}));
    // A long invoice may contain interim "Total in GBP" rows on continuation
    // pages. Prefer the summary on the page that closes the invoice; otherwise
    // an early all-zero product section can be mistaken for the invoice VAT.
    const labels=(lines||[]).filter(line=>maspoTotalInGbpLabel(line.text)).sort((a,b)=>Number(closingPages.has(Number(b.page)))-Number(closingPages.has(Number(a.page)))||Number(b.page)-Number(a.page)||Number(b.y)-Number(a.y));
    for(const label of labels){
      // The end-of-invoice summary aligns net, VAT and gross in three fixed
      // columns. Anchor to `Total in GBP`, then use the last printed VAT cell
      // in its table (the final tax-rate row); product-row VAT values above it
      // are not invoice totals. An unreadable final row still triggers review.
      const vatRows=(lines||[]).filter(line=>line.page===label.page&&Number(line.y)>=Number(label.y)-18&&Number(line.y)<=Number(label.y)+190&&Number(line.x)>=Number(label.x)+300&&Number(line.x)<=Number(label.x)+390&&/[0-9OoMm]/.test(String(line.text||''))).map(line=>({line,money:maspoVatMoneyFromLine(line,lines)})).sort((a,b)=>Number(a.line.y)-Number(b.line.y));
      // The `Total in GBP` row is the invoice total itself. Prefer its directly
      // printed VAT cell over a later rate-band duplicate that OCR may have
      // truncated, while still reading the VAT from the document verbatim.
      const totalVatRow=vatRows.find(item=>Math.abs(Number(item.line.y)-Number(label.y))<=20&&item.money?.value!==null&&item.money?.value!==undefined);
      if(totalVatRow)return totalVatRow.money.value;
      if(vatRows.length){const finalVatRow=vatRows.at(-1);return finalVatRow.money?.value??null;}

      // The summary table can break at a page boundary: `Total in GBP` and
      // the net figure may be at the foot of one page while the VAT column is
      // printed on the next. Follow only the immediately following page, and
      // only when it closes this same invoice. Ignore a repeated product grid
      // there so its per-item VAT cannot be mistaken for the summary amount.
      const nextPage=Number(label.page)+1,nextLines=(lines||[]).filter(line=>Number(line.page)===nextPage);
      const closesInvoice=nextLines.some(line=>/^\s*total\s*:/i.test(String(line.text||'')))&&nextLines.some(line=>/\bin\s+words\s*:/i.test(String(line.text||'')));
      const currentId=maspoPageDocumentId((lines||[]).filter(line=>Number(line.page)===Number(label.page))),nextId=maspoPageDocumentId(nextLines);
      const sameInvoice=!currentId||!nextId||currentId.replace(/\W/g,'').toUpperCase()===nextId.replace(/\W/g,'').toUpperCase();
      const hasItemGrid=nextLines.some(line=>Number(line.y)<1400&&(/\bvat\s*rate\b/i.test(String(line.text||''))||/\b(?:item\s+name|item\s+no\.?|quantity\s+unit|net\s+price)\b/i.test(String(line.text||''))));
      if(closesInvoice&&sameInvoice&&!hasItemGrid){
        const totalY=Math.min(...nextLines.filter(line=>/^\s*total\s*:/i.test(String(line.text||''))).map(line=>Number(line.y)));
      const continuationVat=(lines||[]).filter(line=>Number(line.page)===nextPage&&Number(line.y)<totalY&&Number(line.x)>=Number(label.x)+300&&Number(line.x)<=Number(label.x)+390&&/[0-9OoMm]/.test(String(line.text||''))).map(line=>({line,money:maspoVatMoneyFromLine(line,lines)})).sort((a,b)=>Number(a.line.y)-Number(b.line.y));
        if(continuationVat.some(item=>!item.money))return null;
        if(continuationVat.length)return continuationVat.at(-1).money.value;
      }
    }
    return null;
  }
  function maspoClosingSummaryVat(lines){
    // Some scanned closing pages omit their summary labels.
    // In the closing-page summary, identify the printed VAT cell beside net.
    // OCR may lose gross; use its position only and never calculate VAT.
    // If OCR cannot read it, return null so the 5x retry can inspect the cell
    // rather than accepting a nearby line-item VAT.
    const pages=[...new Set((lines||[]).map(line=>Number(line.page)||1))];
    for(const page of pages.sort((a,b)=>b-a)){
      const pageLines=(lines||[]).filter(line=>(Number(line.page)||1)===page),closes=pageLines.some(line=>/^\s*total\s*:/i.test(String(line.text||'')))&&pageLines.some(line=>/\bin\s+words\s*:/i.test(String(line.text||'')));
      if(!closes)continue;
      const itemGrid=pageLines.some(line=>Number(line.y)<1400&&(/\bvat\s*rate\b/i.test(String(line.text||''))||/\b(?:item\s+name|item\s+no\.?|quantity\s+unit|net\s+price)\b/i.test(String(line.text||''))));
      const repeatedProductRates=pageLines.filter(line=>Number(line.y)<1400&&/\b(?:0|5|8|10|20|21|23)\s*%/i.test(String(line.text||''))).length>=3;
      if(itemGrid||repeatedProductRates)continue;
      const rows=pageLines.filter(line=>Number(line.x)>=1600&&Number(line.x)<1755&&Number(line.y)<900&&/^[\s0-9OoMmEe\u00DF\u1E9E.,;:-]+$/.test(String(line.text||''))&&/\d|[OoMm]/.test(String(line.text||''))&&pageLines.some(other=>Math.abs(Number(other.y)-Number(line.y))<=18&&Number(other.x)>=1400&&Number(other.x)<1600&&maspoMoneyLoose(other.text))).sort((a,b)=>Number(a.y)-Number(b.y));
      if(rows.length){
        const raw=String(rows.at(-1).text||'').trim(),money=maspoVatMoneyFromLine(rows.at(-1),pageLines),explicitCents=/[.,;]/.test(raw),zero=/^(?:[ODQ0]{1,3}|[OoMm]{1,3}|0+(?:[.,;]0{1,2})?|[Oo0][Pp][Oo0])$/i.test(raw);
        // Compact OCR like `1757` may mean 17.57, 17.37, or another value;
        // never insert a decimal ourselves. Leave non-zero values without an
        // Keep compact non-zero tokens unreadable unless OCR geometry confirms them.
        const fusedDecimalAndSix=/^\d{1,2}[Ee\u00DF\u1E9E]\d$/i.test(raw);
        return {present:true,value:money&&(explicitCents||zero||/^\d{3,6}$/.test(raw)||fusedDecimalAndSix)?money.value:null};
      }
    }
    return null;
  }
  function maspoFinalRateVat(lines){
    const pages=[...new Set((lines||[]).map(line=>Number(line.page)||1))],rows=[];
    for(const page of pages){
      const pageLines=(lines||[]).filter(line=>(Number(line.page)||1)===page);
      // Some invoices split the product grid across pages without repeating
      // its column headings. Only treat a percentage table as the VAT summary
      // when it sits on the page that closes the invoice (Total + In words).
      // Otherwise a 0% product row on a continuation page can masquerade as
      // the invoice VAT total.
      const closesInvoice=pageLines.some(line=>/^\s*total\s*:/i.test(String(line.text||'')))&&pageLines.some(line=>/\bin\s+words\s*:/i.test(String(line.text||'')));
      if(!closesInvoice)continue;
      // Percentage rates in the long product table describe individual items.
      // Only use a rate table on a page that has no item grid.
      // A continuation page may not repeat the item-grid headings. If the
      // printed summary label is present, its dedicated VAT-column reader is
      // authoritative; never reinterpret nearby 0% product rows as a tax
      // summary when that cell could not be read.
      if(pageLines.some(line=>maspoTotalInGbpLabel(line.text)))continue;
      const itemGridHeader=pageLines.some(line=>Number(line.y)<1400&&(/\bvat\s*rate\b/i.test(String(line.text||''))||/\b(?:item\s+name|item\s+no\.?|quantity\s+unit|net\s+price)\b/i.test(String(line.text||''))));
      const repeatedProductRates=pageLines.filter(line=>Number(line.y)<1400&&/\b(?:0|5|8|10|20|21|23)\s*%/i.test(String(line.text||''))).length>=3;
      if(itemGridHeader||repeatedProductRates)continue;
      for(const rate of pageLines.filter(line=>/\b(?:0|5|8|10|20|21|23)\s*%/i.test(String(line.text||'')))){
        const cells=pageLines.filter(line=>Number(line.x)>Number(rate.x)&&Number(line.x)<=Number(rate.x)+720&&Math.abs(Number(line.y)-Number(rate.y))<=14).map(line=>({line,money:maspoMoneyLoose(line.text)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.x)-Number(b.line.x));
        if(cells.length>=3)rows.push({page,y:Number(rate.y)||0,vat:maspoVatMoney(cells[1].line.text)?.value??null});
      }
    }
    return rows.sort((a,b)=>a.page-b.page||a.y-b.y).at(-1)?.vat??null;
  }
  function maspoPageDocumentId(pageLines){
    const lines=pageLines||[],heading=lines.find(line=>Number(line.y)<1200&&/^\s*invoice(?:\s+(?:correction\s+)?(?:no\.?|number))?\s*[:.]?\s*$/i.test(String(line.text||'')));
    // On correction documents the original invoice reference is printed in
    // the "do dokumentu" line before some OCR reading orders reach the actual
    // correction number. Always identify the number explicitly labelled on
    // the correction heading first.
    for(const line of lines){const match=String(line.text||'').match(/\bcorrection\s+invoice\s+(\d{3,8}\s*\/\s*[A-Z]{2,}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i);if(match)return match[1].replace(/\s+/g,'');}
    // Maspo's invoice number is printed beside the heading, but OCR varies:
    // `2607-SP/02/03737`, `2607-sp/02103737`, and `2607-SP102/02590` all
    // occur on the same supplier form. Keep the document reference intact;
    // the public invoice number is reduced to its last four digits later.
    const candidates=heading?lines.filter(item=>Number(item.y)<1300&&Math.abs(Number(item.y)-Number(heading.y))<120):lines.filter(item=>Number(item.y)<1200);
    for(const line of candidates){const value=String(line.text||''),match=value.match(/\b(\d{5,8}\s*\/\s*[A-Z]{2,}\s*\/\s*\d{1,2}\s*\/\s*\d{4})\b/i)||value.match(/\b(\d{4}\s*[-.]\s*[A-Z][A-Z0-9./-]{4,})\b/i);if(match)return match[1].replace(/\s+/g,'').replace(/\./g,'-');}
    for(const line of lines){const match=String(line.text||'').match(/\bcorrection\s+invoice\s+([A-Z0-9][A-Z0-9./-]{5,})/i);if(match)return match[1].replace(/\s+/g,'');}
    return '';
  }
  function parseMaspoInvoice(flat,source='',ocrLines){
    // The LON table is a distinct supplier layout whether its invoice date
    // appears on the first page or was lost when the scan starts mid-document.
    const footerFormat=maspoFooterInvoice(flat);
    if(!/\bMASPO(?:\s+FOOD)?\s+LTD\b/i.test(flat)&&!footerFormat)return null;
    const lines=Array.isArray(ocrLines)?ocrLines:[],correction=/\b(?:invoice\s+correction\s+no\.?|correction\s+invoice)\b/i.test(flat)||/\b(?:before|after)\s+correction\b/i.test(flat)||/\bKorekta\b/i.test(flat),statement=/\b(?:statement\s+of\s+the\s+account|account\s+statement|remittance\s+advice|payment\s+advice|cash\s+receipt)\b/i.test(flat),hasInvoiceHeader=/\binvoice\s+(?:no\.?|number|correction)\b/i.test(flat)||(/\binvoice\b/i.test(flat)&&Boolean(maspoPageDocumentId(lines)))||footerFormat,headerId=maspoPageDocumentId(lines);
    const correctionId=firstMatch(flat,[/\b(?:invoice\s+correction\s+no\.?|correction\s+invoice)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{5,})/i]);
    const ordinaryId=firstMatch(flat,[/\b(?:invoice\s+no\.?|invoice\s+number)\s*[:#.-]?\s*((?:\d{3,6}\s*[-.]\s*[A-Z0-9]+\s*\/\s*[A-Z0-9]+\s*\/\s*[A-Z0-9]+)|(?:\d{3,6}\s*[-.]\s*[A-Z0-9]+\s*\/\s*\d+\s*\/\s*\d+))/i]);
    const lonId=firstMatch(flat,[/\binvoice\s+(\d{5,8}\s*\/\s*[A-Z]{2,}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i]);
    const number=(headerId||correctionId||ordinaryId||lonId||'').replace(/\s+/g,'').replace(/\./g,'-');
    const dateLabel=lines.filter(line=>/\binvoice\s+date(?:\s*\(taxpoint\))?\b|\bdate\s+of\s+issue\b/i.test(String(line.text||''))).sort((a,b)=>Number(a.y)-Number(b.y))[0],nearbyDate=dateLabel?lines.map(line=>({line,match:String(line.text||'').match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}[./-]\d{2})\b/)})).filter(item=>item.match&&item.line.page===dateLabel.page&&Math.abs(Number(item.line.y)-Number(dateLabel.y))<70).sort((a,b)=>Math.abs(Number(a.line.y)-Number(dateLabel.y))-Math.abs(Number(b.line.y)-Number(dateLabel.y)))[0]?.match?.[1]:'';
    const dateValue=nearbyDate||firstMatch(flat,[/(?:invoice\s+date(?:\s*\(taxpoint\))?|date\s+of\s+issue)\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}[./-]\d{2})/i]);
    const date=parseDate(dateValue),supplier='MASPO';
    const correctsInvoice=firstMatch(flat,[/(?:do\s+dokumentu|applies\s+to\s+the\s+invoice|correct(?:s|ed\s+invoice)\s*(?:invoice)?|invoice\s+being\s+corrected)\s*:?\s*((?:FS\s*)?[A-Z0-9]+(?:[./\-\u2022\u00b7][A-Z0-9]+){1,4})/i]).replace(/\s+/g,'').replace(/[\u2022\u00b7]/g,'.');
    const repaymentLabel=lines.filter(line=>/\btotal\s+to\s+repay\b/i.test(String(line.text||''))).sort((a,b)=>Number(a.y)-Number(b.y))[0]||lines.filter(line=>/\bamount\s+to\s+repay\b/i.test(String(line.text||''))).sort((a,b)=>Number(a.y)-Number(b.y))[0]||null;
    const repaymentValue=repaymentLabel?(lines.filter(line=>line.page===repaymentLabel.page&&Math.abs(Number(line.y)-Number(repaymentLabel.y))<=26&&Number(line.x)>Number(repaymentLabel.x)+80).map(line=>({line,money:maspoMoneyLoose(line.text)})).filter(item=>item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.x)-Number(b.line.x)).at(-1)?.money?.value??null):null;
    const creditNote=Boolean(correction&&repaymentLabel);
    const totalLine=lines.map(line=>({line,money:maspoMoney(line.text)})).filter(item=>/^\s*total\s*:/i.test(String(item.line.text||''))&&item.money&&item.money.value!==null).sort((a,b)=>Number(a.line.y)-Number(b.line.y)).at(-1)?.money.value??null;
    const normalSummary=maspoRow(lines,maspoTotalInGbpLabel),summaryVat=maspoSummaryVat(lines),closingSummaryVat=maspoClosingSummaryVat(lines),finalRateVat=maspoFinalRateVat(lines),columnTotalSummary=maspoColumnTotalRow(lines),compactSummary=maspoCompactSummary(lines),beforeY=Number(lines.find(line=>/\bbefore\s+correction\b/i.test(String(line.text||'')))?.y??-Infinity),afterY=Number(lines.find(line=>/\bafter\s+correction\b/i.test(String(line.text||'')))?.y??-Infinity),beforeSummary=beforeY>-Infinity?maspoRow(lines,maspoTotalInGbpLabel,beforeY):null,afterSummary=afterY>-Infinity?maspoRow(lines,maspoTotalInGbpLabel,afterY):null,correctedSummary=maspoRow(lines,/\brazem\s+po\s+korekcie\b/i)||afterSummary,correctionSummary=maspoRow(lines,/\brazem\s+korekta\b/i);
    const correctionSummaryMismatch=Boolean(correction&&correctedSummary?.vat===0&&correctedSummary?.net!==null&&correctedSummary?.net!==undefined&&correctedSummary?.gross!==null&&correctedSummary?.gross!==undefined&&Number(correctedSummary.net)!==Number(correctedSummary.gross));
    // If the printed zero-VAT corrected summary has OCR-disagreeing net/gross
    // cells, treat the corrected total as unreadable. Never guess one cell from
    // another or apply a potentially truncated correction to the invoice.
    const correctedTotal=correctionSummaryMismatch?null:(correctedSummary?.gross??null),correctedVat=correctedSummary?.vat??null,footerTotal=footerFormat?maspoFooterTotal(flat):null,footerVat=footerFormat?maspoFooterVat(flat,lines):null;
    // Maspo uses several layouts from the same supplier: a normal invoice
    // with a labelled `Total:`, a VAT-summary table, and correction pages with
    // before/after summaries. Select the matching strategy from the page
    // content rather than assuming one fixed layout.
    const layoutId=correction?'maspo-correction':correctionSummary?.gross!==null&&correctionSummary?.gross!==undefined?'maspo-correction-summary':footerFormat?'maspo-lon-item-table':normalSummary?.gross!==null&&normalSummary?.gross!==undefined?'maspo-vat-summary':columnTotalSummary?.gross!==null&&columnTotalSummary?.gross!==undefined?'maspo-column-total':compactSummary?.gross!==null&&compactSummary?.gross!==undefined?'maspo-compact-summary':totalLine!==null?'maspo-labelled-total':'maspo-total-not-found';
    let total=creditNote&&repaymentValue!==null?-Math.abs(repaymentValue):correction?(correctionSummary?.gross??totalLine): (footerFormat?(footerTotal??totalLine??columnTotalSummary?.gross??normalSummary?.gross??null):(totalLine??normalSummary?.gross??columnTotalSummary?.gross??compactSummary?.gross??null));
    // Use the printed invoice summary rows first. Do not let a product line's
    // VAT-rate row win merely because OCR found a summary label elsewhere.
    const hasPrintedGbpSummary=lines.some(line=>maspoTotalInGbpLabel(line.text));
    let vat=correction?(correctedSummary?.vat??correctionSummary?.vat??null):(footerFormat?(footerVat??null):(closingSummaryVat?.present?closingSummaryVat.value:summaryVat??columnTotalSummary?.vat??(hasPrintedGbpSummary?null:(compactSummary?.vat??normalSummary?.vat??finalRateVat??null))));
    let subtotal=correction?(correctionSummary?.net??null):(normalSummary?.net??columnTotalSummary?.net??compactSummary?.net??null);
    // Keep printed invoice values exactly as read. Do not derive VAT, totals,
    // or subtotals by reconciling amounts or subtracting one figure from another.
    const retryOcr=!number||!date||total===null||vat===null||vat===undefined||vat===''||(correction&&!creditNote&&correctedTotal===null);
    if(retryOcr){if(total===null)total='';vat=vat===null?'':vat;subtotal=subtotal===null?'':subtotal;}
    const page=lines.length?Math.min(...lines.map(line=>Number(line.page)||1)):1;
    const nonInvoiceForm=/\b(?:cash\s+receipt|complaint\s+report|pallet\s+note)\b/i.test(flat),isInvoiceDocument=!statement&&!nonInvoiceForm&&hasInvoiceHeader;
    return {invoiceNumber:number,date,supplier:supplier.trim(),subtotal,vat,total,correctsInvoice,documentType:creditNote?'CREDIT NOTE':correction?'CORRECTION':'INVOICE',correctedSubtotal:correction&&!creditNote?(correctedSummary?.net??''):'',correctedVat:correction&&!creditNote?(correctedVat??''):'',correctedTotal:correction&&!creditNote?(correctedTotal??''):'',currency:'GBP',source,page,isInvoiceDocument,nonInvoiceForm,layoutId,confidence:retryOcr?'MASPO values need review':creditNote?'MASPO credit note':correction?'MASPO correction totals':'MASPO printed total and VAT',retryOcr,review:retryOcr||correction,reviewReason:''};
  }
  function invoiceReferenceKeys(value){
    const compact=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!compact)return [];
    const withoutFs=compact.replace(/^FS(?=\d)/,'');
    return [...new Set([compact,withoutFs])];
  }
  function reconcileInvoiceCorrections(inputRows){
    const invoices=[],corrections=[],creditNotes=[];
    for(const sourceRow of inputRows||[]){
      const row={...sourceRow};
      const type=String(row.documentType||'').toUpperCase();
      if(type==='CREDIT NOTE')creditNotes.push(row);else if(type==='CORRECTION')corrections.push(row);else invoices.push(row);
    }
    const byReference=new Map();
    for(const row of invoices){
      for(const reference of [row.originalInvoiceNumber,row.invoiceNumber])for(const key of invoiceReferenceKeys(reference)){
        if(!byReference.has(key))byReference.set(key,[]);
        byReference.get(key).push(row);
      }
    }
    corrections.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    const unmatched=[];
    for(const correction of corrections){
      const targets=new Map();
      for(const key of invoiceReferenceKeys(correction.correctsInvoice))for(const target of byReference.get(key)||[])targets.set(target,target);
      const matches=[...targets.keys()];
      const revisedTotal=Number(correction.correctedTotal),revisedVat=Number(correction.correctedVat);
      const hasRevisedValues=correction.correctedTotal!==''&&correction.correctedTotal!==null&&correction.correctedTotal!==undefined&&Number.isFinite(revisedTotal)&&correction.correctedVat!==''&&correction.correctedVat!==null&&correction.correctedVat!==undefined&&Number.isFinite(revisedVat);
      if(matches.length===1&&hasRevisedValues){
        const target=matches[0],previousReference=String(target.correctionReference||'').trim(),reference=String(correction.invoiceNumber||'').trim();
        target.oldTotal=target.total;
        target.oldVat=target.vat;
        target.total=revisedTotal;
        target.vat=revisedVat;
        target.subtotal=correction.correctedSubtotal!==''&&correction.correctedSubtotal!==null&&correction.correctedSubtotal!==undefined&&Number.isFinite(Number(correction.correctedSubtotal))?Number(correction.correctedSubtotal):'';
        target.documentType='INVOICE (CORRECTED)';
        target.accepted=Boolean(!target.unconfiguredSupplier&&target.invoiceNumber&&target.date&&target.supplier&&Number.isFinite(Number(target.total))&&Number.isFinite(Number(target.vat)));
        target.rejected=!target.accepted;target.status=target.accepted?'ACCEPTED':'REJECTED';
        if(target.accepted)target.rejectedReason='';
        else if(target.unconfiguredSupplier)target.rejectedReason='Supplier profile is not set up. All invoices from this supplier are rejected until a supplier profile is configured.';
        target.correctionReference=[previousReference,reference].filter(Boolean).join('; ');
        target.correctedTotal=revisedTotal;
        target.correctedVat=revisedVat;
        target.review=true;
        target.confidence=`Updated by correction ${reference || '(number unavailable)'}`;
        target.correctionNote=`Updated from correction ${reference || '(number unavailable)'}`;
        continue;
      }
      correction.documentType=matches.length>1?'CORRECTION - MULTIPLE MATCHES':matches.length===1?'CORRECTION - REVISED VALUES UNREADABLE':'CORRECTION - ORIGINAL NOT FOUND';
      correction.correctionNote=matches.length>1?`Correction not applied: more than one invoice matches ${correction.correctsInvoice||'(reference unavailable)'}.`:matches.length===1?`Correction not applied: revised total or VAT could not be read for ${correction.correctsInvoice||'(reference unavailable)'}.`:`Correction not applied: referenced invoice ${correction.correctsInvoice||'(reference unavailable)'} was not found in the imported PDFs.`;
      correction.oldVat='';correction.oldTotal='';
      if(hasRevisedValues){correction.vat=revisedVat;correction.total=revisedTotal;correction.subtotal=correction.correctedSubtotal!==''&&correction.correctedSubtotal!==null&&correction.correctedSubtotal!==undefined&&Number.isFinite(Number(correction.correctedSubtotal))?Number(correction.correctedSubtotal):'';}
      else{correction.vat='';correction.total='';}
      correction.accepted=false;correction.rejected=true;correction.status='REJECTED';correction.confidence='REJECTED';
      correction.review=true;
      unmatched.push(correction);
    }
    return [...invoices,...unmatched,...creditNotes];
  }
  function deduplicateInvoiceRows(inputRows){
    const kept=[],byIdentity=new Map();let duplicates=0;
    const score=row=>(row.accepted?100:0)+(row.total!==''&&row.total!==null&&row.total!==undefined?20:0)+(row.date?5:0)+(row.supplier?5:0)+(row.originalInvoiceNumber?2:0);
    const compact=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    for(const input of inputRows||[]){
      const row={...input},rawReference=String(row.originalInvoiceNumber||row.invoiceNumber||''),maspoSerial=/^\d{4}[-. ]?[A-Z]{2,}/i.test(rawReference),reference=maspoSerial?normalizeMaspoInvoiceNumber(rawReference):(compact(rawReference)||normalizeInvoiceNumber(row.invoiceNumber)),supplier=compact(row.supplier)||compact(row.profileId),date=String(row.date||''),type=String(row.documentType||'INVOICE').toUpperCase(),kind=type==='CREDIT NOTE'?'CREDIT NOTE':type.includes('CORRECTION')?'CORRECTION':'INVOICE';
      if(!reference){kept.push(row);continue;}
      // A repeated header on a continuation page can yield the same invoice
      // number but lose its date. Merge that fragment with its same-file row;
      // keep two dated invoices separate when a supplier legitimately reuses
      // a number in another period.
      const key=`${supplier}|${reference}|${kind}`,indexes=byIdentity.get(key)||[],index=indexes.find(candidateIndex=>{const existing=kept[candidateIndex],existingDate=String(existing.date||''),existingSource=String(existing.source||''),source=String(row.source||''),generatedShahid=existing.profileId==='shahid-halal-poultry'&&existing.invoiceNumberGenerated&&row.profileId==='shahid-halal-poultry'&&row.invoiceNumberGenerated;if(generatedShahid){const sameFile=existing.sourcePath&&row.sourcePath?String(existing.sourcePath)===String(row.sourcePath):!existingSource||!source||existingSource===source;return sameFile&&Number(existing.page)===Number(row.page);}if(existingDate&&date)return existingDate===date;return !existingSource||!source||existingSource===source;});
      if(index===undefined){indexes.push(kept.length);byIdentity.set(key,indexes);kept.push(row);continue;}
      duplicates++;
      const current=kept[index],preferred=score(row)>score(current)?row:current,other=preferred===row?current:row,merged={...preferred};
      for(const field of ['invoiceNumber','originalInvoiceNumber','date','supplier','profileId','source','sourcePath','rejectedReason','confidence'])if((merged[field]===''||merged[field]===null||merged[field]===undefined)&&other[field]!==''&&other[field]!==null&&other[field]!==undefined)merged[field]=other[field];
      if(Number(current.page)>0&&Number(row.page)>0)merged.page=Math.min(Number(current.page),Number(row.page));
      kept[index]=merged;
    }
    return {rows:kept,duplicates};
  }
  function parseInvoiceGeneric(text,source='',ocrLines){
    const flat=String(text||'').replace(/\b[oO][,.][oO]{2}\b/g,'0.00').replace(/\b(\d[\d,]*)[,.][oO]{2}\b/g,'$1.00').replace(/\b(\d[\d,]*)[.,]?[oO]{2}\b/g,'$1.00').replace(/\b(\d[\d,]*)[oO](\d)\b/g,'$1.0$2').replace(/\b(?:1\s*l|I\s*l|1l)th\b/gi,'11th').replace(/\s+/g,' ').trim();
    const date=firstMatch(flat,[/(?:invoice\s+date|date\s+of\s+issue)\s*[.:#-]?\s*((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4}))/i,/(?:invoice|tax invoice|dated|date)\s*(?:no\.?|number)?\s*[.:#-]?\s*((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4}))/i,/\b(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})\b/i,/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/]);
    let number=fourDigitDocumentNumber(extractInvoiceNumber(flat));
    if(number)number=number.replace(/\s+/g,' ').trim();
    if(number&&/^INV[-\/]/i.test(number))number=number.replace(/^(INV[-\/])(.+)$/i,(_,prefix,suffix)=>prefix+suffix.replace(/O/g,'0').replace(/I/g,'1'));
    const money='[^0-9\\s]?\\s*\\(?\\s*(?:(?:\\d{1,3}(?:[\\s,]\\d{3})+)|\\d+)(?:[.,]\\s*\\d{2})?\\s*\\)?';
    const vatRaw=firstMatch(flat,[new RegExp('VAT\\s*@\\s*\\d+(?:[.,]\\d+)?%\\s*(?:\\([^)]*\\)\\s*)?('+money+')','i'),new RegExp('tax\\s+value\\b[^0-9]{0,40}('+money+')','i'),new RegExp('(?:VAT|tax)\\s*(?:amount|value)?\\s*[:#-]?\\s*('+money+')','i')]);
    const discountWindow=flat.match(/total\s+discount\b([\s\S]{0,100}?)amount\s+due/i)?.[1]||'',discountValues=[...discountWindow.matchAll(/\d[\d,.]*/g)].map(match=>invoiceAmount(match[0])).filter(value=>value!==null);
    const totalRaw=firstMatch(flat,[new RegExp('\\b(?:total\\s*(?:due|payable)?|amount\\s*due|grand\\s*total|balance\\s*due)\\s*[:#-]?\\s*('+money+')','i')]);
    const subRaw=firstMatch(flat,[new RegExp('(?:sub\\s*total|net\\s*amount|excl(?:uding)?\\s*VAT)\\s*[:#-]?\\s*('+money+')','i')]);
    const dueWindow=firstMatch(flat,[/(?:amount\s+due|total\s+due)\s*[:#-]?\s*([\s\S]{0,180}?)(?=\bsales\s+person\b|\bbuyer\b|\bstatement\s+of\s+the\s+account\b)/i]);
    const dueValues=[...String(dueWindow).matchAll(/\b\d[\d,]*[.,]\d{2}\b/g)].map(m=>invoiceAmount(m[0])).filter(x=>x!==null&&x>0),netRaw=firstMatch(flat,[new RegExp('(?:net\\s+value|gross\\s+value)\\s*[:#-]?\\s*('+money+')','i')]);
    const hasInvoiceLabel=/\b(?:tax\s+)?invoice\b|\bcredit\s+(?:note|memo)\b/i.test(flat),isStatement=/\b(?:bank|account)\s+statement\b|\bremittance\s+advice\b|\bpayment\s+advice\b/i.test(flat),netCandidate=invoiceAmount(netRaw),polishDocument=isPolishVillageBreadText(flat)||/\bFS\s*\d{3,}\s*\/\s*MAG\s*\/\s*2026\b/i.test(flat),printedTotalRowValues=[...flat.matchAll(/\btotal\s*:\s*([^=]{0,100})/gi)].flatMap(match=>[...match[1].matchAll(/\d[\d\s,]*[.,]\s*\d{2}/g)].map(value=>invoiceAmount(value[0])).filter(value=>value!==null)),printedTotalRow=printedTotalRowValues.at(-1),parsedTotal=invoiceAmount(totalRaw),rawLabeledTotal=dueValues.at(-1)??discountValues.at(-1)??(polishDocument&&parsedTotal===0?(printedTotalRow??parsedTotal):parsedTotal)??null,labeledTotal=hasInvoiceLabel&&!isStatement?rawLabeledTotal:null,vat=hasInvoiceLabel&&!isStatement?invoiceAmount(vatRaw):null,subtotal=hasInvoiceLabel&&!isStatement?(invoiceAmount(subRaw)??netCandidate??null):null,total=labeledTotal;
    const supplier=isPolishVillageBreadText(flat)?'Polish Village Bread LTD':firstMatch(flat,[/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,5}\s+(?:Limited|LTD|PLC|LLP))\b/i,/seller\s*:\s*(?:customer\s*:\s*)?([A-Za-z][A-Za-z0-9 &.' ,-]{2,}?)(?=\s+\d{1,4}(?:[- ]|$)|\s+\d{3,}\b|\s+VAT\s*:|\s+invoice\b|$)/i,/(?:from|supplier|seller|sold\s*by)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &.' ,-]{2,80})/i,/^(?!invoice\b)([A-Z][A-Za-z0-9 &.'-]{2,60}?)\s+(?:tax\s+)?invoice\b/i])||'';
    const currency=/\bEUR\b|\u20ac/.test(flat)?'EUR':/\bUSD\b/.test(flat)?'USD':'GBP',complete=Boolean(hasInvoiceLabel&&!isStatement&&number&&date&&supplier&&total!==null&&vat!==null&&Number.isFinite(Number(vat)));
    const retryOcr=hasInvoiceLabel&&!isStatement&&Boolean(number||date)&&!complete;
    return {invoiceNumber:number,date:parseDate(date),supplier:supplier.trim(),subtotal:subtotal??'',vat:vat??'',total:total??'',currency,source,isInvoiceDocument:hasInvoiceLabel&&!isStatement,accepted:complete,rejected:!complete,rejectedReason:complete?'':!hasInvoiceLabel||isStatement?'This document does not appear to be an invoice.':!number?'Invoice number not found.':!date?'Invoice date not found.':!supplier?'Supplier not identified.':total===null?'Printed invoice total not found.':'VAT amount not found; one 5x OCR retry is required.',confidence:complete?'ACCEPTED':'REJECTED',retryOcr,review:false};
  }
  function isMarionTradingText(value){
    const text=String(value||'');
    return /\b(?:MARION|MARLON|MANION|MARI0N|MAÅION)\s+TRAD(?:ING|IN[GI])\b/i.test(text)||/mariontrad(?:ing|jng)ltd\.co\.uk/i.test(text)||(/\bAWRS\s+NO\s*:\s*XYAW/i.test(text)&&/\bVAT\s+NO\s*:\s*GB\s*295\s*9266\s*44\b/i.test(text));
  }
  function isMonolithText(value){
    const text=String(value||'');
    return /\bMONOLITH\b/i.test(text)||/\bmonolith-uk\.com\b/i.test(text);
  }
  function isDeensProduceText(value){
    const text=String(value||'');
    return /\bDEENS\b/i.test(text)&&/\bPRODUCE\b/i.test(text)||/354\s*695\s*660/.test(text);
  }
  function isPeterboroughBazaarText(value){
    const text=String(value||'');
    return /\bPETERBOROUGH\s+BAZAAR\s+LIMITED\b/i.test(text)||/pbazaar\.co\.uk/i.test(text)||/104\s*2318\s*66/.test(text);
  }
  function isParkersText(value){
    const text=String(value||'');
    return /\bPARKERS\b/i.test(text)||/Parker\s+Motor\s+Services\s+Ltd/i.test(text)||/thepartspeople\.co\.uk/i.test(text);
  }
  function parkersInvoicePage(pageLines,text=''){
    const content=String(text||pageLines.map(line=>String(line.text||'')).join(' '));
    return isParkersText(content)&&/\bINVOICE\b/i.test(content)&&/\bTax\s+Point\b/i.test(content)&&/\bDocument\s+No\.?\b/i.test(content)&&
      pageLines.some(line=>/^\s*GOODS\s*$/i.test(String(line.text||'')))&&pageLines.some(line=>/^\s*VAT\s*$/i.test(String(line.text||'')))&&pageLines.some(line=>/^\s*TOTAL\s*$/i.test(String(line.text||'')));
  }
  function parkersAnchorValue(pageLines,labelPattern,valuePattern,{maxDistance=46,minXGap=6}={}){
    const lines=Array.isArray(pageLines)?pageLines:[],labels=lines.filter(line=>labelPattern.test(String(line.text||'').trim()));
    for(const label of labels){
      const text=String(label.text||'').trim(),inline=text.replace(labelPattern,'').trim();
      const inlineMatch=inline.match(valuePattern);
      if(inlineMatch)return {raw:inlineMatch[0],line:label};
      const right=(Number(label.x)||0)+(Number(label.width)||0),tolerance=Math.max(maxDistance,(Number(label.height)||20)*1.65);
      const candidates=lines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>=right+minXGap&&Math.abs((Number(line.y)||0)-(Number(label.y)||0))<=tolerance)
        .map(line=>({line,match:String(line.text||'').match(valuePattern)})).filter(item=>item.match)
        .sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(label.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(label.y)||0))||Number(a.line.x)-Number(b.line.x));
      if(candidates.length)return {raw:candidates[0].match[0],line:candidates[0].line};
    }
    return null;
  }
  function parkersDocumentNumber(pageLines){
    const found=parkersAnchorValue(pageLines,/^\s*Document\s+No\.?\s*[:#]?\s*/i,/[A-Z0-9][A-Z0-9-]{4,19}/i);
    const raw=String(found?.raw||'').replace(/\s+/g,'').replace(/[^A-Z0-9-]/gi,'');
    return /^[-A-Z0-9]{5,20}$/i.test(raw)&&((raw.match(/\d/g)||[]).length>=5)?raw:'';
  }
  function parkersDate(pageLines){
    const found=parkersAnchorValue(pageLines,/^\s*Tax\s+Point\s*[:#]?\s*/i,/\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}/);
    return parseDate(String(found?.raw||'').replace(/\s+/g,''));
  }
  function parkersPrintedMoney(value){
    const raw=String(value||'').trim().replace(/[\u00A3$\u20AC]/g,'').replace(/\s+/g,'');
    if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)[.,]\d{2}$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function parkersSummaryAmount(pageLines,kind){
    const lines=Array.isArray(pageLines)?pageLines:[],totalLabel=lines.filter(line=>/^\s*TOTAL\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0))[0];
    if(!totalLabel)return null;
    const goodsLabel=lines.filter(line=>/^\s*GOODS\s*$/i.test(String(line.text||''))).sort((a,b)=>Math.abs((Number(a.x)||0)-(Number(totalLabel.x)||0))-Math.abs((Number(b.x)||0)-(Number(totalLabel.x)||0)))[0];
    const vatLabels=lines.filter(line=>/^\s*VAT\s*$/i.test(String(line.text||''))).sort((a,b)=>Math.abs((Number(a.x)||0)-(Number(totalLabel.x)||0))-Math.abs((Number(b.x)||0)-(Number(totalLabel.x)||0)));
    const vatLabel=vatLabels.find(line=>Math.abs((Number(line.x)||0)-(Number(totalLabel.x)||0))<=Math.max(90,(Number(totalLabel.width)||0)*1.4)&&(!goodsLabel||Number(line.y)>Number(goodsLabel.y)&&Number(line.y)<Number(totalLabel.y)));
    const anchors={goods:goodsLabel,vat:vatLabel,total:totalLabel},anchor=anchors[kind];
    if(!anchor&&kind!=='vat')return null;
    if(anchor){
      const inline=String(anchor.text||'').replace(/^\s*(?:GOODS|VAT|TOTAL)\s*[:#]?\s*/i,'').trim(),inlineValue=parkersPrintedMoney(inline);
      if(inlineValue!==null)return inlineValue;
      const y=Number(anchor.y)||0,right=(Number(anchor.x)||0)+(Number(anchor.width)||0),tolerance=Math.max(24,(Number(anchor.height)||20)*1.45);
      const candidates=lines.filter(line=>Number(line.page)===Number(anchor.page)&&Number(line.x)>=right+12&&Math.abs((Number(line.y)||0)-y)<=tolerance)
        .map(line=>({line,value:parkersPrintedMoney(line.text)})).filter(item=>item.value!==null)
        .sort((a,b)=>Math.abs((Number(a.line.y)||0)-y)-Math.abs((Number(b.line.y)||0)-y)||Number(a.line.x)-Number(b.line.x));
      if(candidates.length)return candidates[0].value;
    }
    if(kind==='vat'){
      // Windows OCR occasionally drops the VAT heading from the rightmost
      // TOTAL table while retaining the invoice's adjacent Goods/Vat summary.
      // Use that printed VAT cell only when both labels share a row and their
      // printed amounts align on the same row; never derive VAT from a rate.
      const leftGoods=lines.filter(line=>/^\s*Goods\s*$/i.test(String(line.text||''))&&Number(line.x)<Number(totalLabel.x)-20),leftVat=lines.filter(line=>/^\s*Vat\s*$/i.test(String(line.text||''))&&Number(line.x)<Number(totalLabel.x)-20);
      for(const goods of leftGoods)for(const vat of leftVat){
        const labelTolerance=Math.max(16,Math.max(Number(goods.height)||20,Number(vat.height)||20)*0.8);
        if(Number(vat.x)<=Number(goods.x)||Math.abs((Number(vat.y)||0)-(Number(goods.y)||0))>labelTolerance)continue;
        const paired=(label)=>lines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>Number(label.x)+8&&Number(line.x)<Number(totalLabel.x)-12&&(Number(line.y)||0)>=(Number(label.y)||0)&&((Number(line.y)||0)-(Number(label.y)||0))<=Math.max(90,(Number(label.height)||20)*4.2)).map(line=>({line,value:parkersPrintedMoney(line.text)})).filter(item=>item.value!==null);
        const goodsValues=paired(goods),vatValues=paired(vat),matches=[];
        for(const goodsValue of goodsValues)for(const vatValue of vatValues){
          const rowTolerance=Math.max(14,((Number(goodsValue.line.height)||20)+(Number(vatValue.line.height)||20))*0.65),rowGap=Math.abs((Number(goodsValue.line.y)||0)-(Number(vatValue.line.y)||0));
          if(rowGap<=rowTolerance)matches.push({value:vatValue.value,score:rowGap+Math.abs((Number(goodsValue.line.y)||0)-(Number(goods.y)||0))/4+Math.abs((Number(vatValue.line.y)||0)-(Number(vat.y)||0))/4});
        }
        if(matches.length)return matches.sort((a,b)=>a.score-b.score)[0].value;
      }
    }
    return null;
  }
  function parseParkersInvoice(flat,source='',ocrLines){
    const allLines=Array.isArray(ocrLines)?ocrLines:[],page=Number(allLines[0]?.page)||1,lines=allLines.filter(line=>(Number(line.page)||1)===page),text=String(flat||lines.map(line=>String(line.text||'')).join(' '));
    const fullNumber=parkersDocumentNumber(lines),number=fullNumber?normalizeInvoiceNumber(fullNumber):'',date=parkersDate(lines),vat=parkersSummaryAmount(lines,'vat'),total=parkersSummaryAmount(lines,'total');
    const credit=lines.some(line=>/^\s*CREDIT(?:\s+NOTE)?\s*$/i.test(String(line.text||'')))||Number(total)<0,documentType=credit?'CREDIT NOTE':'INVOICE',complete=Boolean(number&&date&&vat!==null&&total!==null);
    const rejectedReason=complete?'':!number?'Parkers Document No. could not be confirmed from the invoice.':!date?'Parkers Tax Point date could not be confirmed; a 5x OCR retry is required.':total===null?'Printed Parkers TOTAL could not be confirmed from the invoice summary.':'Printed Parkers VAT amount could not be confirmed from the invoice summary.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Parker Motor Services Ltd',subtotal:'',vat:vat??'',total:total??'',documentType,isInvoiceDocument:parkersInvoicePage(lines,text),currency:'GBP',source,accepted:complete,rejected:!complete,rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false,layoutId:'parkers-tax-point-document-summary'};
  }
  function isShahidHalalText(value){
    const text=String(value||'');
    return /\bSHAH[I]D\s+HALAL\s+POULTRY\b/i.test(text)||/\bSHAHD\s+HALAL\s+POULTRY\b/i.test(text)||/\bSAAHID\s+HALAL\s+POULTRY\b/i.test(text)||/07973\s*658\s*417/.test(text)||/159\s*5722\s*76/.test(text);
  }
  function isIsaacWholesaleText(value){const text=String(value||'');return /\bISAAC\s+WHOLESALE\b/i.test(text)||/isaacwholesale\.co\.uk/i.test(text)||/885\s*230\s*414/.test(text);}
  function isEagleFoodsText(value){const text=String(value||'');return /\bEAGLE\s*FOODS?\s*(?:LTD|LIMITED)\b/i.test(text)||/\bEAGLEFOODS\b/i.test(text)||/sales\s*@\s*eaglefoods\.co\.uk/i.test(text)||/823\s*9589\s*88/.test(text);}
  function isEagleNonInvoicePage(value){const text=String(value||'');return /\bstatement\s+of\s+account\b/i.test(text)||/\b(?:interpretation|force\s+majeure|intellectual\s+property\s+rights|business\s+day)\b/i.test(text)||/\bterms\s+and\s+conditions\b/i.test(text)&&(/\bEagle\s*Foods?\b/i.test(text)||/04994847/.test(text));}
  function eagleDate(value){
    const text=String(value||'').trim().replace(/\b(?:0CR|ACR)\b/ig,'OCT').replace(/\b0(?=[A-Z0-9]{2,3}\b)/i,'O').replace(/(\b\d{1,2}\s*[-/. _]{1,3})(?:UG|U6)(?=[-/. _]{1,3}\d)/i,'$1AUG').replace(/(\b\d{1,2}\s*[-/. _]{1,3})UL(?=[-/. _]{1,3}\d)/i,'$1JUL').replace(/\b([0-9]{1,2})\s*[-/. _]{1,3}\s*([A-Za-z0-9]{3})\s*[-/. _]{1,3}\s*(\d{2,4})\b/,(match,day,month,year)=>`${day}-${month.toUpperCase().replace(/^5EP$/,'SEP').replace(/^0CT$/,'OCT')}-${year}`);
    const monthDate=text.match(/\b(\d{1,2})\s*[-/. _]{1,3}\s*([A-Z]{3})\s*[-/. _]{1,3}\s*(\d{2,4})\b/i);
    if(monthDate){const months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12},month=months[monthDate[2].toUpperCase()];if(month)return parseDate(`${monthDate[1]}/${month}/${monthDate[3]}`);}
    const numeric=text.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/);return parseDate(numeric?.[0]||'');
  }
  function eaglePrintedAmount(value){
    let raw=String(value??'').trim().replace(/[£$€]/g,'').replace(/\bGBP\b/ig,'').trim();
    if(/^\d{1,3}[.,]\d{3}[.,]\d{2}$/.test(raw))raw=raw.replace(/[.,](?=\d{3}[.,]\d{2}$)/,'');
    if(!/^[+-]?\s*\(?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\)?$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function eagleAnchoredValue(lines,labelPattern,valuePattern){
    const items=Array.isArray(lines)?lines.filter(line=>line&&String(line.text||'').trim()):[],choices=[];
    const capture=text=>{const match=String(text||'').match(valuePattern);return match?(match[1]??match[0]).trim():'';};
    for(const label of items){
      const text=String(label.text||''),labelMatch=text.match(labelPattern);if(!labelMatch)continue;
      const inline=capture(text.slice((labelMatch.index||0)+labelMatch[0].length));
      if(inline)choices.push({raw:inline,score:0});
      const labelX=Number(label.x)||0,labelY=Number(label.y)||0,labelHeight=Number(label.height)||Math.max(1,text.length*0.45),labelWidth=Number(label.width)||text.length*labelHeight*0.45,labelRight=labelX+labelWidth,toleranceY=labelHeight*4.5,toleranceX=labelHeight*1.4;
      for(const candidate of items){
        if(candidate===label)continue;
        if(label.page!==undefined&&candidate.page!==undefined&&Number(label.page)!==Number(candidate.page))continue;
        const raw=capture(candidate.text);if(!raw)continue;
        const x=Number(candidate.x)||0,y=Number(candidate.y)||0,height=Number(candidate.height)||labelHeight,width=Number(candidate.width)||String(candidate.text||'').length*height*0.45,right=x+width;
        const vertical=Math.abs(y-labelY);if(vertical>toleranceY)continue;
        if(right<labelX-toleranceX||x>labelRight+labelHeight*10)continue;
        const horizontalGap=Math.max(0,x-labelRight)+Math.max(0,labelX-right);
        choices.push({raw,score:(vertical/Math.max(labelHeight,1))*3+horizontalGap/Math.max(labelHeight,1)});
      }
    }
    return choices.sort((a,b)=>a.score-b.score)[0]?.raw||'';
  }
  function eagleInvoiceReference(lines,flat=''){
    const refs=[];
    const add=value=>{const digits=String(value||'').toUpperCase().replace(/[SOBIL]/g,char=>({S:'5',O:'0',B:'8',I:'1',L:'1'}[char])).replace(/\D/g,'');if(digits.length>=2&&digits.length<=12)refs.push(digits);};
    const anchored=eagleAnchoredValue(lines,/\binvoice\s*(?:no\.?|number|#)\s*:?\s*/i,/\b[\dSOBIL]{2,11}\b/i);
    if(anchored)add(anchored);
    if(!refs.length&&!(Array.isArray(lines)&&lines.some(line=>String(line?.text||'').trim()))){const match=String(flat||'').match(/\binvoice\s*(?:no\.?|number|#)\s*:?\s*(\d[\d]{1,11})\b/i);if(match)add(match[1]);}
    return refs.sort((a,b)=>b.length-a.length)[0]||'';
  }
  function eagleInvoiceDate(lines,flat=''){
    const pattern=/\b\d{1,2}\s*[-/.]\s*[A-Z0-9]{3}\s*[-/.]\s*\d{2,4}\b|\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/i;
    const items=Array.isArray(lines)?lines:[],labels=items.filter(line=>/\b(?:invoice|order)\s+date\s*:?/i.test(String(line.text||'')));
    if(labels.length){
      const choices=[];
      for(const label of labels){
        const labelText=String(label.text||''),match=labelText.match(/\b(?:invoice|order)\s+date\s*:?/i),inline=labelText.slice((match?.index||0)+(match?.[0]?.length||0)).match(pattern);
        if(inline&&eagleDate(inline[0]))choices.push({date:eagleDate(inline[0]),distance:0});
        const x=Number(label.x)||0,y=Number(label.y)||0,height=Number(label.height)||20;
        for(const candidate of items){
          if(candidate===label||label.page!==undefined&&candidate.page!==undefined&&Number(label.page)!==Number(candidate.page))continue;
          const candidateX=Number(candidate.x)||0,candidateY=Number(candidate.y)||0,raw=String(candidate.text||'').match(pattern)?.[0],date=eagleDate(raw);
          if(date&&candidateX>=x&&candidateX<=x+height*20&&Math.abs(candidateY-y)<=height*1.1)choices.push({date,distance:Math.abs(candidateY-y)});
        }
      }
      return choices.sort((a,b)=>a.distance-b.distance)[0]?.date||'';
    }
    const match=String(flat||'').match(/\b(?:invoice|order)\s+date\s*:?\s*(\d{1,2}\s*[-/.]\s*[A-Z0-9]{3}\s*[-/.]\s*\d{2,4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i);
    return eagleDate(match?.[1]||'');
  }
  function eagleDateField(lines,labelPattern,verticalTolerance=2){
    const items=Array.isArray(lines)?lines:[],pattern=/\b\d{1,2}\s*[-/.]\s*[A-Z0-9]{2,5}\s*[-/.]\s*\d{2,4}\b|\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b|\b[A-Z0-9]{2,5}\s*[-/. ]*\s*\d{2,4}\b/i,choices=[];
    for(const label of items){const text=String(label.text||''),match=text.match(labelPattern);if(!match)continue;const inline=text.slice((match.index||0)+match[0].length).match(pattern);if(inline)choices.push({raw:inline[0],distance:0});const x=Number(label.x)||0,y=Number(label.y)||0,height=Number(label.height)||20,width=Number(label.width)||text.length*height*0.45,right=x+width;
      for(const candidate of items){if(candidate===label||label.page!==undefined&&candidate.page!==undefined&&Number(label.page)!==Number(candidate.page))continue;const candidateX=Number(candidate.x)||0,candidateY=Number(candidate.y)||0,raw=String(candidate.text||'').match(pattern)?.[0];if(!raw||candidateX<right-height*0.5||candidateX>right+height*18||Math.abs(candidateY-y)>height*verticalTolerance)continue;choices.push({raw,distance:Math.abs(candidateY-y)});}
      const fieldItems=items.filter(candidate=>candidate!==label&&(label.page===undefined||candidate.page===undefined||Number(label.page)===Number(candidate.page))&&Number(candidate.x)>=right-height*0.5&&Number(candidate.x)<=right+height*18&&Math.abs((Number(candidate.y)||0)-y)<=height*2.5),dayItems=fieldItems.filter(candidate=>/^\s*\d{1,2}\s*$/.test(String(candidate.text||''))),monthItems=fieldItems.filter(candidate=>/^\s*[A-Z0-9]{2,5}\s*[-/. ]*\s*\d{2,4}\s*$/i.test(String(candidate.text||'')));
      for(const day of dayItems)for(const month of monthItems){const dayText=String(day.text||'').trim(),monthText=String(month.text||'').trim(),dayY=Number(day.y)||0,monthY=Number(month.y)||0;if(Math.abs(dayY-monthY)>height*3)continue;choices.push({raw:`${dayText}-${monthText}`,distance:(Math.abs(dayY-y)+Math.abs(monthY-y))/2});}
    }
    return choices.sort((a,b)=>a.distance-b.distance)[0]?.raw||'';
  }
  function eagleDatePeriod(value){
    const text=String(value||'').toUpperCase().replace(/\b(?:0CR|ACR)\b/g,'OCT').replace(/0(?=CT\b)/g,'O').replace(/\bUL(?=[-/. ]*\d{2,4}\b)/g,'JUL').replace(/\bUG(?=[-/. ]*\d{2,4}\b)/g,'AUG'),months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};let match=null;
    for(const name of Object.keys(months)){const found=text.match(new RegExp(`${name}[^A-Z0-9]{0,5}(\\d{2,4})|${name}(\\d{2,4})`));if(found){match={month:months[name],year:Number(found[1]||found[2])};break;}}
    if(!match){const legacy=text.match(/\b([A-Z0-9]{2,3})\s*[-/. ]*\s*(\d{2,4})\b/);if(!legacy)return null;const monthName=legacy[1].replace(/^0(?=CT$)/,'O');if(!months[monthName])return null;match={month:months[monthName],year:Number(legacy[2])};}
    let year=match.year;if(!year)return null;if(year<100)year+=year>=70?1900:2000;return {year,month:match.month};
  }
  function eagleDateHints(lines){
    const orderLabel=/\b(?:invoice|order)\s+date\s*:?/i,deliveryLabel=/\bdelivery\s+date\s*:?/i,orderRaw=eagleDateField(lines,orderLabel),deliveryRaw=eagleDateField(lines,deliveryLabel),periodRaws=[eagleDateField(lines,orderLabel,2.5),eagleDateField(lines,deliveryLabel,2.5)],orderDate=eagleDate(orderRaw),deliveryDate=eagleDate(deliveryRaw),periods=periodRaws.map(eagleDatePeriod).filter(Boolean),uniquePeriods=[...new Map(periods.map(item=>[`${item.year}-${item.month}`,item])).values()];return {orderDate,deliveryDate,periods:uniquePeriods};
  }
  function eagleFooterAmounts(lines){
    const items=Array.isArray(lines)?lines:[],anchors=items.filter(line=>/^\s*(?:Total\s+Credit|New\s+Invoice\s+Total)\s*:?\s*$/i.test(String(line.text||'')));
    let partial=null;
    for(const anchor of anchors){
      const x=Number(anchor.x)||0,y=Number(anchor.y)||0,height=Number(anchor.height)||20;
      const nearby=items.filter(line=>Number(line.page)===Number(anchor.page)&&Number(line.x)>=x-height*30&&Number(line.x)<=x+height*4&&y-(Number(line.y)||0)>=height*4&&y-(Number(line.y)||0)<=height*15);
      for(const gross of nearby.filter(line=>eaglePrintedAmount(line.text)!==null).sort((a,b)=>(Number(b.x)||0)-(Number(a.x)||0))){
        const row=nearby.filter(line=>Math.abs((Number(line.y)||0)-(Number(gross.y)||0))<=height*1.5).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0));
        const grossIndex=row.indexOf(gross);if(grossIndex<1)continue;
        const precedingAmounts=row.slice(0,grossIndex).filter(line=>eaglePrintedAmount(line.text)!==null),netLine=precedingAmounts.length>=2?precedingAmounts.at(-2):null,vatLine=precedingAmounts.length>=2?precedingAmounts.at(-1):null,net=eaglePrintedAmount(netLine?.text),vat=eaglePrintedAmount(vatLine?.text),total=eaglePrintedAmount(gross.text);
        if(total!==null){if(net!==null&&vat!==null){const totalX=Number(gross.x)||0,vatX=Number(vatLine?.x)||0,vatWidth=Number(vatLine?.width)||String(vatLine?.text||'').length*height*0.45,splitPrefix=items.some(line=>line!==gross&&Number(line.x)>vatX+vatWidth*0.6&&Number(line.x)<totalX+height*2&&Math.abs((Number(line.y)||0)-(Number(gross.y)||0))<=height*1.5&&(/^\s*[+-]?\d{1,3}[,.]\s*$/.test(String(line.text||''))||/^\s*[+-]?\d{1,3}[,.]\s+\d{1,3}[,.]\s*\d{2}\s*$/.test(String(line.text||''))));return {net,vat,total,totalOcrIncomplete:splitPrefix};}partial??={vat:null,total};}
      }
    }
    return partial;
  }
  function eagleAccountCode(lines){
    const items=Array.isArray(lines)?lines.filter(line=>line&&String(line.text||'').trim()):[],labels=items.filter(line=>/^\s*account\s+no\.?\s*:?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){const text=String(label.text||''),inline=text.match(/:\s*([A-Z][A-Z0-9]{1,5})\s*$/i);if(inline)return inline[1].toUpperCase();const x=Number(label.x)||0,y=Number(label.y)||0,height=Number(label.height)||16,width=Number(label.width)||text.length*height*0.45,right=x+width,candidates=items.filter(line=>line!==label&&Number(line.x)>=right-height*0.5&&Number(line.x)<=right+height*10&&Math.abs((Number(line.y)||0)-y)<=height*4.5).map(line=>({line,match:String(line.text||'').match(/^\s*([A-Z][A-Z0-9]{1,5})\s*$/i)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-y)-Math.abs((Number(b.line.y)||0)-y)||Number(a.line.x)-Number(b.line.x));if(candidates.length)return candidates[0].match[1].toUpperCase();}
    return '';
  }
  function eagleInvoicePage(lines,text=''){
    const flat=String(text||'').replace(/\s+/g,' ').trim(),lineText=(Array.isArray(lines)?lines:[]).map(line=>String(line?.text||'')).join(' '),value=`${flat} ${lineText}`;
    if(/\bstatement\s+of\s+account\b/i.test(value))return false;
    return /\binvoice\s+to\b/i.test(value)&&/\binvoice\s*(?:no\.?|number|#)\b/i.test(value)&&/\b(?:order|invoice)\s+date\b/i.test(value);
  }
  function parseEagleFoodsInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],isStatement=/\bstatement\s+of\s+account\b/i.test(String(flat||''));
    if(isStatement||!eagleInvoicePage(lines,flat))return {invoiceNumber:'',originalInvoiceNumber:'',date:'',supplier:'Eagle Foods Ltd',subtotal:'',vat:'',total:'',documentType:'INVOICE',currency:'GBP',source,isInvoiceDocument:false,accepted:false,rejected:true,rejectedReason:'This Eagle Foods page is a statement, terms sheet, or other non-invoice page.',retryOcr:false};
    const fullNumber=eagleInvoiceReference(lines,flat),dateHints=eagleDateHints(lines),date=dateHints.orderDate||eagleInvoiceDate(lines,flat),accountCode=eagleAccountCode(lines),vatRaw=eagleAnchoredValue(lines,/^\s*VAT\s+Total\s*:?\s*/i,/\(?\s*[+-]?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\)?/i),totalRaw=eagleAnchoredValue(lines,/^\s*(?:Invoice\s+Total|Total\s+Credit)\s*:?\s*/i,/\(?\s*[+-]?\s*\d[\d\s,]*[.,]\s*\d{2}\s*\)?/i),footer=eagleFooterAmounts(lines),vat=eaglePrintedAmount(vatRaw)??footer?.vat??null,total=eaglePrintedAmount(totalRaw)??footer?.total??null,complete=Boolean(fullNumber&&date&&vat!==null&&total!==null);
    const rejectedReason=complete?'':!fullNumber?'Eagle Foods invoice number could not be confirmed.':!date?'Eagle Foods invoice date could not be confirmed.':total===null?'Printed Eagle Foods invoice total could not be confirmed.':'Printed Eagle Foods VAT could not be confirmed.';
    return {invoiceNumber:normalizeInvoiceNumber(fullNumber),originalInvoiceNumber:fullNumber,date,eagleDeliveryDate:dateHints.deliveryDate,eagleDatePeriods:dateHints.periods,accountCode,eagleInvoiceNet:footer?.net??null,eagleTotalOcrIncomplete:Boolean(footer?.totalOcrIncomplete),supplier:'Eagle Foods Ltd',subtotal:'',vat:vat??'',total:total??'',documentType:'INVOICE',currency:'GBP',source,isInvoiceDocument:true,accepted:complete,rejected:!complete,rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false,profileId:'eagle-foods',layoutId:'eagle-foods-invoice'};
  }
  function eagleStatementRows(lines){
    const items=Array.isArray(lines)?lines.filter(line=>line&&String(line.text||'').trim()):[],text=items.map(line=>String(line.text||'')).join(' ');
    if(!/\bstatement\s+of\s+account\b/i.test(text))return [];
    const headerStatementDate=items.filter(line=>/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}\b/.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0],statementDate=eagleDate(eagleAnchoredValue(items,/^\s*Statement\s+Date\s*:?\s*/i,/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}\b/)||headerStatementDate?.text||text.match(/\bStatement\s+Date\s*:?\s*(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4})/i)?.[1]||'');
    const labels=[['date',/\bdocument\s+date\b/i],['type',/\bdocument\s+type\b/i],['number',/\bdocument\s+no\b/i],['net',/^\s*net\s*$/i],['vat',/^\s*vat\s*$/i],['total',/^\s*total\s*$/i],['balance',/^\s*balance\s*$/i],['dueDate',/^\s*due\s+date\s*$/i],['daysOld',/^\s*days\s+old\s*$/i],['amountDue',/^\s*amount\s+due\s*$/i]],headers={};
    const dateHeader=items.find(line=>/\bdocument\s+date\b/i.test(String(line.text||''))),headerY=Number(dateHeader?.y)||0,headerTolerance=Math.max(8,(Number(dateHeader?.height)||16)*1.5);
    for(const [key,pattern] of labels){const found=items.filter(line=>pattern.test(String(line.text||''))&&Math.abs((Number(line.y)||0)-headerY)<=headerTolerance).sort((a,b)=>Math.abs((Number(a.y)||0)-headerY)-Math.abs((Number(b.y)||0)-headerY));if(found.length)headers[key]=Number(found[0].x)||0;}
    const required=['date','type','number','net','vat','total'];if(required.some(key=>headers[key]===undefined))return [];
    const columns=Object.keys(headers).map(key=>({key,x:headers[key]})).sort((a,b)=>a.x-b.x),heights=items.map(line=>Number(line.height)||0).filter(value=>value>0).sort((a,b)=>a-b),rowTolerance=Math.max(4,(heights[Math.floor(heights.length/2)]||16)*0.7);
    const columnFor=x=>{let best=columns[0],distance=Infinity;for(const column of columns){const candidate=Math.abs(x-column.x);if(candidate<distance){best=column;distance=candidate;}}return best.key;};
    const clusters=[];
    for(const line of items.filter(item=>(Number(item.y)||0)>headerY+rowTolerance*1.5).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0))){const y=Number(line.y)||0,last=clusters.at(-1);if(last&&Math.abs(y-last.y)<=rowTolerance){last.items.push(line);last.y=last.items.reduce((sum,item)=>sum+(Number(item.y)||0),0)/last.items.length;}else clusters.push({y,items:[line]});}
    const customerLabel=items.find(line=>/^\s*customer\s*:?\s*$/i.test(String(line.text||''))),customerValue=customerLabel?items.filter(line=>line!==customerLabel&&Math.abs((Number(line.y)||0)-(Number(customerLabel.y)||0))<=Math.max(14,(Number(customerLabel.height)||16)*1.2)&&Number(line.x)>Number(customerLabel.x)).sort((a,b)=>Number(a.x)-Number(b.x))[0]:null,accountCode=String(customerValue?.text||'').match(/^\s*([A-Z]{2,6})\s*[-–]/i)?.[1]?.toUpperCase()||'';
    const result=[];
    for(const cluster of clusters){const cells={};for(const line of cluster.items){const key=columnFor(Number(line.x)||0);cells[key]=cells[key]?`${cells[key]} ${line.text}`:String(line.text||'');}
      if(!/\bsales\s+invoice\b/i.test(cells.type||''))continue;
      const documentNumber=String(cells.number||'').replace(/\D/g,''),total=eaglePrintedAmount(cells.total),vat=eaglePrintedAmount(cells.vat),date=eagleDate(cells.date);
      if(documentNumber.length<4||total===null||vat===null)continue;
      result.push({documentNumber,date,total,vat,net:eaglePrintedAmount(cells.net),accountCode,statementDate,documentType:'Sales Invoice'});
    }
    return result;
  }
  function eagleStatementRowsFromOcr(lines){
    const items=Array.isArray(lines)?lines.filter(line=>line&&String(line.text||'').trim()):[],pages=new Map();
    for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    return [...pages].flatMap(([page,pageItems])=>eagleStatementRows(pageItems).map(row=>({...row,summaryPage:page})));
  }
  function eagleAccountCodesCompatible(a,b){const left=String(a||'').replace(/[^A-Z0-9]/gi,'').toUpperCase(),right=String(b||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();return !left||!right||left===right||left.endsWith(right)||right.endsWith(left);}
  function newestEagleStatementMatch(matches,row){
    if(!matches.length)return null;
    const allMatches=[...matches];
    if(row.date){const byDocumentDate=matches.filter(item=>!item.date||item.date===row.date);if(!byDocumentDate.length)return null;matches=byDocumentDate;}
    const dated=matches.filter(item=>item.statementDate);
    if(dated.length){const latest=dated.reduce((max,item)=>item.statementDate>max?item.statementDate:max,'');matches=dated.filter(item=>item.statementDate===latest);}
    const unique=new Map(matches.map(item=>[`${item.documentNumber}|${item.date}|${Math.round(item.total*100)}|${Math.round(item.vat*100)}`,item]));
    matches=[...unique.values()];
    const withKnownDate=selected=>{if(selected?.date)return selected;const sameAmounts=allMatches.filter(item=>item.date&&Math.round(Number(item.total)*100)===Math.round(Number(selected.total)*100)&&Math.round(Number(item.vat)*100)===Math.round(Number(selected.vat)*100)),dates=new Set(sameAmounts.map(item=>item.date));return dates.size===1?{...selected,date:[...dates][0]}:selected;};
    if(matches.length===1)return withKnownDate(matches[0]);
    const documents=new Set(matches.map(item=>item.documentNumber)),amounts=new Set(matches.map(item=>`${Math.round(item.total*100)}|${Math.round(item.vat*100)}`)),dates=new Set(matches.map(item=>item.date).filter(Boolean));
    if(documents.size===1&&amounts.size===1&&(row.date||dates.size<=1))return withKnownDate(matches.find(item=>row.date&&item.date===row.date)||matches[0]);
    return null;
  }
  function eagleSummaryMatchByPrintedAmounts(row,statementRows){
    const total=Number(row?.total),vat=Number(row?.vat);if(!Number.isFinite(total)||!Number.isFinite(vat)||row?.vatUnverified)return null;
    let matches=(statementRows||[]).filter(item=>Math.round(Number(item.total)*100)===Math.round(total*100)&&Math.round(Number(item.vat)*100)===Math.round(vat*100)&&eagleSummaryMatchesDateEvidence(item,row));
    const accountMatches=matches.filter(item=>eagleAccountCodesCompatible(row.accountCode,item.accountCode));if(accountMatches.length)matches=accountMatches;
    if(new Set(matches.map(item=>String(item.documentNumber||''))).size!==1)return null;
    return newestEagleStatementMatch(matches,row);
  }
  function eagleGeneratedReference(row,usedNumbers){
    const date=String(row?.date||'').match(/^\d{4}-(\d{2})-(\d{2})$/),prefix=date?`${date[2]}${date[1]}`:'99',limit=date?99:9999;
    for(let sequence=1;sequence<=limit;sequence++){
      const candidate=prefix+(date?String(sequence).padStart(2,'0'):String(sequence).padStart(4,'0'));
      if(!usedNumbers.has(candidate))return candidate;
    }
    if(date){for(let sequence=1;sequence<=9999;sequence++){const candidate=`99${String(sequence).padStart(4,'0')}`;if(!usedNumbers.has(candidate))return candidate;}}
    return '';
  }
  function eagleInvoicePageInfo(lines){
    const text=(Array.isArray(lines)?lines:[]).map(line=>String(line?.text||'')).join(' ').replace(/\bpa[qg]e\b/ig,'page').replace(/\bpa\s*ge\b/ig,'page').replace(/\bpa\s*e\s*[vV]?\s*2\s*(?:th|of)?\b/ig,'page 2'),reference=eagleInvoiceReference(lines,text),dateHints=eagleDateHints(lines),date=dateHints.orderDate||eagleInvoiceDate(lines,text),accountCode=eagleAccountCode(lines),pageMarker=text.match(/\bpage\s*([1-9]\d?)\s*(?:of\s*([1-9]\d?))?\b/i);
    return {reference,date,deliveryDate:dateHints.deliveryDate,datePeriods:dateHints.periods,accountCode,pageNumber:pageMarker?Number(pageMarker[1]):0,pageCount:pageMarker?.[2]?Number(pageMarker[2]):0};
  }
  function sameEagleInvoiceReference(a,b){return Boolean(a&&b&&a===b);}
  function eagleSummaryMatchesDateEvidence(item,row){
    if(!item?.date)return true;
    const printedDates=[row?.date,row?.eagleDeliveryDate].filter(Boolean);if(printedDates.includes(item.date))return true;
    const periods=row?.eagleDatePeriods||[];if(!row?.date&&!row?.eagleDeliveryDate&&!periods.length)return true;const [year,month]=String(item.date).split('-').map(Number);return periods.some(period=>period.year===year&&period.month===month);
  }
  function eagleShortReferenceDocuments(row,statementRows){
    const digits=String(row?.originalInvoiceNumber||'').replace(/\D/g,'');if(digits.length<2||digits.length>=6)return new Set();
    let candidates=statementRows.filter(item=>item.documentNumber.endsWith(digits)&&eagleSummaryMatchesDateEvidence(item,row));const accountMatches=candidates.filter(item=>eagleAccountCodesCompatible(row.accountCode,item.accountCode));if(accountMatches.length)candidates=accountMatches;
    return new Set(candidates.map(item=>item.documentNumber));
  }
  function eagleRowsDateEvidenceOverlaps(left,right){
    const periods=row=>{const evidence=[...(row?.eagleDatePeriods||[])];for(const value of [row?.date,row?.eagleDeliveryDate])if(value){const [year,month]=String(value).split('-').map(Number);if(year&&month)evidence.push({year,month});}return [...new Map(evidence.map(item=>[`${item.year}-${item.month}`,item])).values()];},a=periods(left),b=periods(right);return !a.length||!b.length||a.some(x=>b.some(y=>x.year===y.year&&x.month===y.month));
  }
  function applyEagleStatementConfirmation(row,statementRows){
    const originalDigits=String(row.originalInvoiceNumber||'').replace(/\D/g,'');
    if(row.eagleTotalOcrIncomplete){row.total='';row.accepted=false;row.rejected=true;row.status='REJECTED';row.confidence='REJECTED';row.rejectedReason='The printed Eagle Foods total was split across OCR fragments and must be confirmed from a matching invoice summary.';row.retryOcr=false;}
    if(originalDigits.length<2)return row;
    const suffixMatches=statementRows.filter(item=>item.documentNumber.endsWith(originalDigits)&&eagleSummaryMatchesDateEvidence(item,row)),accountMatches=suffixMatches.filter(item=>eagleAccountCodesCompatible(row.accountCode,item.accountCode));if(accountMatches.length)suffixMatches.splice(0,suffixMatches.length,...accountMatches);const matchedDocuments=new Set(suffixMatches.map(item=>item.documentNumber));row.eagleSummaryAmbiguousReference=false;
    if(originalDigits.length<6&&matchedDocuments.size>1){row.eagleSummaryAmbiguousReference=true;row.eagleSummaryConflictReason=`The ${originalDigits.length}-digit Eagle Foods invoice reference matches more than one document number in the summaries.`;row.accepted=false;row.rejected=true;row.status='REJECTED';row.rejectedReason=row.eagleSummaryConflictReason;row.retryOcr=true;return row;}
    const linkedDocument=originalDigits.length>=6?originalDigits:[...matchedDocuments][0]||'';
    if(!linkedDocument)return row;
    let matches=statementRows.filter(item=>item.documentNumber===linkedDocument&&eagleAccountCodesCompatible(row.accountCode,item.accountCode));if(!matches.length&&originalDigits.length<6)matches=statementRows.filter(item=>item.documentNumber===linkedDocument);if(!matches.length)return row;
    const dateCompatible=matches.filter(item=>eagleSummaryMatchesDateEvidence(item,row));if(!dateCompatible.length)return row;
    const summaryDate=row.date&&dateCompatible.some(item=>item.date===row.date)?row.date:row.eagleDeliveryDate&&dateCompatible.some(item=>item.date===row.eagleDeliveryDate)?row.eagleDeliveryDate:'';
    const match=newestEagleStatementMatch(dateCompatible,{...row,date:summaryDate});
    if(!match){
      if(!row.date||row.total===''||row.vat===''){row.eagleSummaryConflict=true;row.eagleSummaryConflictReason='Matching Eagle Foods summaries contain conflicting details, so missing invoice values could not be confirmed.';row.accepted=false;row.rejected=true;row.status='REJECTED';row.confidence='REJECTED';row.rejectedReason=row.eagleSummaryConflictReason;row.retryOcr=false;}
      return row;
    }
    row.originalInvoiceNumber=match.documentNumber;row.invoiceNumber=originalDigits.length<4?originalDigits:normalizeInvoiceNumber(match.documentNumber);if(!row.accountCode)row.accountCode=match.accountCode;
    if(!row.date)row.date=match.date;
    const summaryConfirmsSplitTotal=Boolean(row.eagleTotalOcrIncomplete&&row.eagleInvoiceNet!==null&&row.eagleInvoiceNet!==undefined&&match.net!==null&&match.net!==undefined&&Math.round(Number(row.eagleInvoiceNet)*100)===Math.round(Number(match.net)*100)&&row.vat!==''&&row.vat!==null&&row.vat!==undefined&&Math.round(Number(row.vat)*100)===Math.round(Number(match.vat)*100));
    if(summaryConfirmsSplitTotal){row.total=match.total;row.eagleSummaryReplacedSplitTotal=true;}
    if((row.total===''||row.total===null||row.total===undefined)&&(!row.eagleTotalOcrIncomplete||summaryConfirmsSplitTotal))row.total=match.total;
    if(row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified)row.vat=match.vat;
    row.vatUnverified=false;
    row.eagleSummaryConfirmed=true;row.eagleSummaryAmbiguousReference=false;row.eagleSummaryConflict=false;row.eagleSummaryDocumentNumber=match.documentNumber;row.eagleSummaryPageReference=true;
    const complete=Boolean(row.invoiceNumber&&row.date&&row.total!==''&&row.total!==null&&Number.isFinite(Number(row.total))&&row.vat!==''&&row.vat!==null&&Number.isFinite(Number(row.vat)));
    row.accepted=complete;row.rejected=!complete;row.status=complete?'ACCEPTED':'REJECTED';row.confidence=row.status;row.retryOcr=!complete;
    row.rejectedReason=complete?'':!row.invoiceNumber?'Eagle Foods invoice number could not be confirmed.':!row.date?'Eagle Foods invoice date could not be confirmed.':row.total===''?'Printed Eagle Foods invoice total could not be confirmed.':'Printed Eagle Foods VAT could not be confirmed.';
    return row;
  }
  function confirmEagleInvoiceRows(rows,additionalStatementRows=[]){
    const allRows=Array.isArray(rows)?rows:[],collected=[...additionalStatementRows,...allRows.filter(row=>row?.profileId==='eagle-foods').flatMap(row=>Array.isArray(row.eagleStatementRows)?row.eagleStatementRows:[])],summaries=[...new Map(collected.filter(item=>item?.documentNumber).map(item=>[`${item.documentNumber}|${item.date||''}|${item.statementDate||''}|${item.accountCode||''}|${Math.round(Number(item.total)*100)}|${Math.round(Number(item.vat)*100)}`,item])).values()];
    const eagleRows=allRows.filter(row=>row?.profileId==='eagle-foods');
    for(const row of eagleRows)if(row.invoiceNumberGenerated){row.invoiceNumber='';row.originalInvoiceNumber='';row.invoiceNumberGenerated=false;row.invoiceNumberGeneratedReason='';row.eagleSummaryNoMatch=false;}
    for(const row of eagleRows){row.eagleStatementRows=summaries;applyEagleStatementConfirmation(row,summaries);}
    const usedNumbers=new Set();for(const row of allRows){for(const value of [row.invoiceNumber,row.originalInvoiceNumber,row.eagleSummaryDocumentNumber]){const digits=String(value||'').replace(/\D/g,'');if(digits){usedNumbers.add(digits);if(digits.length>=4)usedNumbers.add(normalizeInvoiceNumber(digits));}}}for(const summary of summaries){const digits=String(summary.documentNumber||'').replace(/\D/g,'');if(digits)usedNumbers.add(digits);}
    for(const row of eagleRows){if(row.invoiceNumber||row.originalInvoiceNumber||row.documentType!=='INVOICE'||row.eagleSummaryConflict||row.eagleTotalOcrIncomplete||row.total===''||row.total===null||row.total===undefined||row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified||!Number.isFinite(Number(row.total))||!Number.isFinite(Number(row.vat)))continue;
      const match=eagleSummaryMatchByPrintedAmounts(row,summaries);
      if(match){row.originalInvoiceNumber=match.documentNumber;row.invoiceNumber=normalizeInvoiceNumber(match.documentNumber);row.eagleSummaryConfirmed=true;row.eagleSummaryMatchedByAmounts=true;row.eagleSummaryDocumentNumber=match.documentNumber;row.eagleSummaryPageReference=true;if(!row.date)row.date=match.date||'';if(!row.accountCode)row.accountCode=match.accountCode||'';row.accepted=Boolean(row.invoiceNumber&&row.date);row.rejected=!row.accepted;row.status=row.accepted?'ACCEPTED':'REJECTED';row.confidence=row.status;row.retryOcr=!row.accepted;row.rejectedReason=row.accepted?'':!row.date?'Eagle Foods invoice date could not be confirmed.':'Eagle Foods invoice number could not be confirmed from its summary.';usedNumbers.add(String(row.originalInvoiceNumber));usedNumbers.add(String(row.invoiceNumber));continue;}
      const generated=eagleGeneratedReference(row,usedNumbers);if(!generated)continue;row.invoiceNumber=generated;row.originalInvoiceNumber=generated;row.invoiceNumberGenerated=true;row.eagleSummaryNoMatch=true;row.invoiceNumberGeneratedReason=row.date?'No invoice number could be read and no unique matching Eagle Foods summary row was found. A unique DDMM sequence reference was generated.':'No invoice number could be read and no unique matching Eagle Foods summary row was found. A unique sequential reference was generated.';usedNumbers.add(generated);const complete=Boolean(row.date&&Number.isFinite(Number(row.total))&&Number.isFinite(Number(row.vat))&&!row.vatUnverified);row.accepted=complete;row.rejected=!complete;row.status=complete?'ACCEPTED':'REJECTED';row.confidence=row.status;row.retryOcr=false;row.rejectedReason=complete?'':!row.date?'Eagle Foods invoice date could not be confirmed.':'Eagle Foods invoice amount details could not be confirmed.';
    }
    for(const row of eagleRows){const digits=String(row.originalInvoiceNumber||'').replace(/\D/g,'');if(digits.length<2||digits.length>=6||row.eagleSummaryConfirmed||row.eagleSummaryConflict)continue;const summaryDocuments=eagleShortReferenceDocuments(row,summaries),rowMatches=eagleRows.filter(other=>other!==row&&String(other.originalInvoiceNumber||'').replace(/\D/g,'').endsWith(digits)&&eagleRowsDateEvidenceOverlaps(row,other));if(summaryDocuments.size>1||!summaryDocuments.size&&rowMatches.length){row.eagleSummaryAmbiguousReference=true;row.accepted=false;row.rejected=true;row.status='REJECTED';row.confidence='REJECTED';row.rejectedReason=`The ${digits.length}-digit Eagle Foods invoice reference is not unique in the selected PDFs. Verify it against the invoice summary.`;row.retryOcr=false;}}
    return allRows;
  }
  function parseEagleFoodsBatch(pageLines,source=''){
    const summaries=eagleStatementRowsFromOcr([...pageLines.values()].flat());
    const canonicalReference=(reference,accountCode,page,datePeriods=[])=>{
      const digits=String(reference||'').replace(/\D/g,'');if(digits.length<2)return '';
      if(digits.length>=6)return digits;
      let candidates=summaries.filter(item=>item.documentNumber.endsWith(digits)&&eagleAccountCodesCompatible(accountCode,item.accountCode));if(datePeriods.length)candidates=candidates.filter(item=>!item.date||datePeriods.some(period=>{const [year,month]=item.date.split('-').map(Number);return period.year===year&&period.month===month;}));
      const documents=new Set(candidates.map(item=>item.documentNumber));
      return documents.size===1?[...documents][0]:documents.size>1?`ambiguous:${digits}:${page}`:`short:${digits}`;
    };
    const groups=[];
    for(const [page,lines] of [...pageLines].sort((a,b)=>Number(a[0])-Number(b[0]))){const text=lines.map(line=>String(line.text||'')).join(' ');if(!eagleInvoicePage(lines,text))continue;const info=eagleInvoicePageInfo(lines),referenceKey=canonicalReference(info.reference,info.accountCode,page,info.datePeriods);let group=null;
      if(referenceKey){group=groups.find(candidate=>candidate.referenceKey===referenceKey&&eagleAccountCodesCompatible(candidate.accountCode,info.accountCode)&&(!candidate.dates.length||!info.date||candidate.dates.includes(info.date))&&(!candidate.datePeriods.length||!info.datePeriods.length||candidate.datePeriods.some(left=>info.datePeriods.some(right=>left.year===right.year&&left.month===right.month))));}
      if(!group&&info.pageNumber===2&&(!info.pageCount||info.pageCount===2)){const previous=groups.at(-1),previousPage=previous?.pages.at(-1),priorReference=previous?.references.filter(Boolean).sort((a,b)=>b.length-a.length)[0]||'';if(previous&&previousPage&&Number(previousPage.page)===Number(page)-1&&eagleAccountCodesCompatible(previous.accountCode,info.accountCode)&&(!priorReference||!info.reference||priorReference.endsWith(info.reference)||info.reference.endsWith(priorReference)))group=previous;}
      if(!group){group={pages:[],references:[],dates:[],datePeriods:[],pageCount:0,referenceKey,accountCode:info.accountCode};groups.push(group);}
      group.pages.push({page,lines,pageNumber:info.pageNumber,pageCount:info.pageCount});if(info.reference)group.references.push(info.reference);if(info.date)group.dates.push(info.date);group.datePeriods.push(...info.datePeriods);group.pageCount=Math.max(group.pageCount,info.pageCount);
    }
    const records=[];
    for(const group of groups){const recordLines=group.pages.flatMap(item=>item.lines),recordText=recordLines.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n');let row=parseInvoiceRobust(recordText,source,recordLines);row.profileId='eagle-foods';row.page=group.pages[0].page;row.sourcePages=group.pages.map(item=>item.page);row.eagleStatementRows=summaries;records.push(row);}
    for(const row of records)applyEagleStatementConfirmation(row,summaries);
    for(const row of records){const digits=String(row.originalInvoiceNumber||'').replace(/\D/g,'');if(digits.length<2||digits.length>=6||row.eagleSummaryConfirmed||row.eagleSummaryConflict)continue;
      const summaryDocuments=eagleShortReferenceDocuments(row,summaries),rowMatches=records.filter(other=>other!==row&&String(other.originalInvoiceNumber||'').replace(/\D/g,'').endsWith(digits)&&eagleRowsDateEvidenceOverlaps(row,other));
      if(summaryDocuments.size>1||!summaryDocuments.size&&rowMatches.length){row.eagleSummaryAmbiguousReference=true;row.accepted=false;row.rejected=true;row.status='REJECTED';row.confidence='REJECTED';row.rejectedReason=`The ${digits.length}-digit Eagle Foods invoice reference is not unique in this batch. Verify it against the invoice summary.`;row.retryOcr=true;}
    }
    const unique=[];for(const row of records.sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0))){const digits=String(row.eagleSummaryDocumentNumber||row.originalInvoiceNumber||'').replace(/\D/g,''),key=digits.length>=6?`${digits}|${row.date||''}`:'';if(!key){unique.push(row);continue;}const previous=unique.find(item=>String(item.eagleSummaryDocumentNumber||item.originalInvoiceNumber||'').replace(/\D/g,'').length>=6&&`${String(item.eagleSummaryDocumentNumber||item.originalInvoiceNumber||'').replace(/\D/g,'')}|${item.date||''}`===key&&eagleAccountCodesCompatible(item.accountCode,row.accountCode));if(!previous){unique.push(row);continue;}previous.sourcePages=[...new Set([...(previous.sourcePages||[previous.page]),...(row.sourcePages||[row.page])])].sort((a,b)=>a-b);for(const field of ['invoiceNumber','originalInvoiceNumber','date','accountCode','vat','total'])if((previous[field]===''||previous[field]===null||previous[field]===undefined)&&row[field]!==''&&row[field]!==null&&row[field]!==undefined)previous[field]=row[field];if(row.eagleSummaryConflict||previous.eagleSummaryConflict||(previous.total!==''&&row.total!==''&&Number(previous.total)!==Number(row.total))||(previous.vat!==''&&row.vat!==''&&Number(previous.vat)!==Number(row.vat))){previous.eagleSummaryConflict=true;previous.eagleSummaryConflictReason='Duplicate Eagle Foods invoice pages contain conflicting printed details. Verify this invoice before importing.';previous.rejectedReason=previous.eagleSummaryConflictReason;previous.accepted=false;previous.rejected=true;previous.status='REJECTED';previous.retryOcr=false;}else{const complete=Boolean(previous.invoiceNumber&&previous.date&&previous.total!==''&&previous.vat!=='');previous.accepted=complete;previous.rejected=!complete;previous.status=complete?'ACCEPTED':'REJECTED';previous.confidence=previous.status;previous.retryOcr=!complete;previous.rejectedReason=complete?'':row.rejectedReason||previous.rejectedReason;}}
    return unique;
  }
  function peterboroughPrintedMoney(value){
    let raw=String(value||'').trim().replace(/[£$€]/g,'').replace(/(?<=\d)\s*[•·●]\s*(?=\d{2}\s*$)/u,'.').trim();
    // A damaged decimal mark is accepted only in an otherwise complete,
    // printed two-decimal amount. Never join separated digits into pounds.
    if(!/^-?(?:(?:\d{1,3}(?:[ ,]\d{3})+)|\d+)[.,;]\s*\d{2}$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function peterboroughHeader(pageLines,text=''){
    const items=Array.isArray(pageLines)?pageLines:[],numberLabel=items.filter(line=>/\binvoice\s*(?:no\.?|number|#)\s*:?\s*$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    let fullNumber='';
    if(numberLabel){
      fullNumber=String(numberLabel.text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*:?\s*[^0-9]*(\d{6,8})\s*$/i)?.[1]||'';
      if(!fullNumber){
        const numberRight=(Number(numberLabel.x)||0)+(Number(numberLabel.width)||0),candidates=items.filter(line=>Number(line.page)===Number(numberLabel.page)&&Number(line.x)>=numberRight+8&&Math.abs((Number(line.y)||0)-(Number(numberLabel.y)||0))<=38).map(line=>({line,digits:String(line.text||'').replace(/\D/g,'')})).filter(item=>/^\d{6,8}$/.test(item.digits)).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(numberLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(numberLabel.y)||0))||Number(a.line.x)-Number(b.line.x));
        fullNumber=candidates[0]?.digits||'';
      }
    }
    if(!fullNumber){
      const label=String(text||'').match(/\binvoice\s*(?:no\.?|number|#)\b/i),tail=label?String(text||'').slice(label.index):'';
      fullNumber=tail.match(/\binvoice\s*(?:no\.?|number|#)\b[\s\S]{0,70}?(\d{6,8})\b/i)?.[1]||'';
    }
    const dateLabel=items.filter(line=>/^\s*date\s*:?\s*$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    let dateText='';
    if(dateLabel){
      dateText=String(dateLabel.text||'').match(/^\s*date\s*:?\s*([^\s].*)$/i)?.[1]||'';
      if(!/\d{1,2}[./-]\d{1,2}[./-]\d{4}/.test(dateText)){
        const dateRight=(Number(dateLabel.x)||0)+(Number(dateLabel.width)||0),candidates=items.filter(line=>Number(line.page)===Number(dateLabel.page)&&Number(line.x)>=dateRight+8&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))<=42).map(line=>({line,match:String(line.text||'').match(/\b(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})\b/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(dateLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(dateLabel.y)||0))||Number(a.line.x)-Number(b.line.x));
        dateText=candidates[0]?.match[1]||'';
      }
    }
    if(!dateText)dateText=String(text||'').match(/\bdate\s*:?\s*[^0-9]{0,8}(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})\b/i)?.[1]||'';
    return {fullNumber,date:parseDate(dateText.replace(/\s+/g,''))};
  }
  function peterboroughFooterValue(pageLines,kind){
    const isVat=kind==='vat',labelPattern=isVat?/^\s*VAT\s+Total\s*:?\s*$/i:/^\s*Total\s*:?\s*$/i;
    const labels=(Array.isArray(pageLines)?pageLines:[]).filter(line=>labelPattern.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0));
    for(const label of labels){
      const inline=String(label.text||'').match(/:\s*(.*?)\s*$/),inlineValue=inline?peterboroughPrintedMoney(inline[1]):null;
      if(inlineValue!==null)return inlineValue;
      const y=Number(label.y)||0,x=Number(label.x)||0;
      const right=x+(Number(label.width)||0),candidates=pageLines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>=right+8&&Math.abs((Number(line.y)||0)-y)<=32).map(line=>({line,value:peterboroughPrintedMoney(line.text)})).filter(item=>item.value!==null).sort((a,b)=>Math.abs((Number(a.line.y)||0)-y)-Math.abs((Number(b.line.y)||0)-y)||Number(a.line.x)-Number(b.line.x));
      if(candidates.length)return candidates[0].value;
    }
    return null;
  }
  function parsePeterboroughBazaarInvoice(flat,source='',ocrLines){
    const allLines=Array.isArray(ocrLines)?ocrLines:[],pages=[...new Set(allLines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),pageGroups=new Map(pages.map(page=>[page,allLines.filter(line=>(Number(line.page)||1)===page)]));
    const candidates=pages.map(page=>({page,lines:pageGroups.get(page)||[],text:(pageGroups.get(page)||[]).map(line=>String(line.text||'')).join(' ')})).filter(item=>isPeterboroughBazaarText(item.text)&&/\binvoice\b/i.test(item.text)).map(item=>({page:item.page,...peterboroughHeader(item.lines,item.text)}));
    const header=candidates.find(item=>item.fullNumber)||candidates[0]||peterboroughHeader(allLines,flat),fullNumber=header.fullNumber,number=fullNumber?normalizeInvoiceNumber(fullNumber):'',date=header.date||parseDate(String(flat||'').match(/\bdate\s*:?\s*[^0-9]{0,8}(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i)?.[1]||''),firstPage=header.page||pages[0]||1;
    const matching=candidates.filter(item=>item.fullNumber&&fullNumber?item.fullNumber===fullNumber:item.page===firstPage),documentPages=matching.length?matching.map(item=>item.page):[firstPage];
    const totals=documentPages.map(page=>peterboroughFooterValue(pageGroups.get(page)||[],'total')).filter(value=>value!==null),vats=documentPages.map(page=>peterboroughFooterValue(pageGroups.get(page)||[],'vat')).filter(value=>value!==null);
    const consensus=values=>{const unique=[...new Set(values.map(value=>Math.round(Number(value)*100)))];return unique.length===1?unique[0]/100:null;},total=consensus(totals),vat=consensus(vats),complete=Boolean(number&&date&&isPeterboroughBazaarText(flat)&&total!==null&&vat!==null),reason=complete?'':!number?'Peterborough Bazaar invoice number could not be confirmed.':!date?'Peterborough Bazaar invoice date could not be confirmed.':total===null?'Printed Peterborough Bazaar Total could not be confirmed from the invoice footer.':'Printed Peterborough Bazaar VAT Total could not be confirmed from the invoice footer; a focused 5x OCR retry is required.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Peterborough Bazaar Limited',subtotal:'',vat:vat??'',total:total??'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,rejectedReason:reason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false,layoutId:'peterborough-bazaar-footer-summary'};
  }
  function shahidMoney(value){
    let raw=String(value||'').trim().replace(/[£$€]/g,'').replace(/^\s*[Ee]\s*/,'').replace(/\s+/g,' ');
    raw=raw.replace(/^([lI|])\s*(?=,)/,'1').replace(/^([Oo])\s*(?=,)/,'0').replace(/\s+([,.;])/g,'$1').replace(/([,.;])\s+(?=\d)/g,'$1').replace(/([.,])\s*([Oo])(?=\d)/g,'$10');
    if(!/^-?(?:(?:\d{1,3}(?:[\s,]\d{3})+)|\d+)[.,]\s*\d{2}$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function shahidSuspiciousPoundPrefix(value){
    // On these scans Windows OCR sometimes reads the printed "£1" as "21".
    // This is ambiguous with a real 21-thousand amount, so require a focused
    // 5x reread rather than silently removing a digit.
    return /^\s*2\d{1,2}\s*,\s*\d{3}[.,]\s*\d{2}\s*$/.test(String(value||''));
  }
  function shahidFooterTotal(pageLines){
    const labels=(Array.isArray(pageLines)?pageLines:[]).filter(line=>/^\s*TOTAL\s*:?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){
      const inline=String(label.text||'').match(/:\s*(.*?)\s*$/),inlineValue=inline?shahidMoney(inline[1]):null;
      if(inlineValue!==null)return {value:inlineValue,raw:inline[1],line:label,suspicious:shahidSuspiciousPoundPrefix(inline[1])};
      const candidates=pageLines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>Number(label.x)+100&&Math.abs((Number(line.y)||0)-(Number(label.y)||0))<=28).map(line=>({line,value:shahidMoney(line.text),raw:String(line.text||''),verified:Boolean(line.shahidTotalVerified)})).filter(item=>item.value!==null||shahidSuspiciousPoundPrefix(item.raw)).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(label.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(label.y)||0))||Number(a.line.x)-Number(b.line.x));
      if(candidates.length){const chosen=candidates[0],suspicious=!chosen.verified&&shahidSuspiciousPoundPrefix(chosen.raw);return {value:suspicious?null:chosen.value,raw:chosen.raw,line:chosen.line,suspicious};}
    }
    return {value:null,raw:'',line:null,suspicious:false};
  }
  function shahidInvoiceDate(pageLines,flat){
    const all=Array.isArray(pageLines)?pageLines:[],supplierHeading=all.filter(line=>isShahidHalalText(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0],headingY=supplierHeading?Number(supplierHeading.y)||0:-Infinity;
    // The issue date is the first date printed below the supplier heading. A
    // later DATE field belongs to the delivery/payment section, so do not use
    // that field when the header date is available.
    const dateLines=all.filter(line=>(Number(line.y)||0)>=headingY&&/\d{1,2}\s*[./-]\s*\d{1,2}/.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0));
    for(const line of dateLines){
      const y=Number(line.y)||0,x=Number(line.x)||0,band=all.filter(item=>Number(item.page)===Number(line.page)&&Number(item.x)>=x&&Number(item.x)<=x+190&&Math.abs((Number(item.y)||0)-y)<=12).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0));
      const joined=band.map(item=>String(item.text||'')).join('').replace(/\s+/g,'').replace(/([./-]20)[^0-9](?=\d)/g,(_,prefix)=>prefix+'2'),lineText=String(line.text||'').replace(/\s+/g,'').replace(/([./-]20)[^0-9](?=\d)/g,(_,prefix)=>prefix+'2'),match=joined.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/)||lineText.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/),date=match?parseDate(match[0]):'';
      if(date)return date;
    }
    // The upper-left date is the document date. If OCR misses or fragments
    // it, use the date directly below the invoice's DATE table heading.
    return parseDate(String(flat||'').match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/)?.[1]||'');
  }
  function parseShahidHalalInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines:[],pages=[...new Set(lines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),page=pages[0]||1,pageLines=lines.filter(line=>(Number(line.page)||1)===page),totalCell=shahidFooterTotal(pageLines),date=shahidInvoiceDate(pageLines,flat);
    const numberMatch=String(flat||'').match(/\b(?:invoice\s*(?:no\.?|number|#)|inv\.?\s*no\.?)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i),fullNumber=numberMatch?.[1]||'',number=fullNumber?normalizeInvoiceNumber(fullNumber):date?`${date.slice(8,10)}${date.slice(5,7)}`:'';
    const total=totalCell.suspicious?'':totalCell.value??'',retryOcr=Boolean(totalCell.suspicious||total===''||!date);
    const rejectedReason=!date?'Shahid Halal Poultry invoice date could not be confirmed.':total===''?'Printed Shahid Halal Poultry TOTAL could not be confirmed; one focused 5x OCR retry is required.':'';
    // This supplier's scanned documents list raw poultry products, show no VAT
    // charge, and do not print a VAT summary. Treat that supplier profile as
    // zero-rated; never derive VAT from the line items or account balance.
    // When the supplier omits its invoice number, use the printed date as a
    // transparent reference (DDMM). The batch parser adds a suffix only when
    // multiple invoices share the same date.
    const accepted=Boolean(date&&total!==''&&Number.isFinite(Number(total)));
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber||number,date,supplier:'Shahid Halal Poultry Ltd',subtotal:'',vat:0,total,documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted,rejected:!accepted,rejectedReason,confidence:accepted?'ACCEPTED':'REJECTED',retryOcr,review:false,layoutId:'shahid-halal-footer-total',invoiceNumberGenerated:!fullNumber&&Boolean(number)};
  }
  function deensHeader(lines,text=''){
    const items=Array.isArray(lines)?lines:[],invoiceLabel=items.filter(line=>/\binvoice\s*(?:no\.?|number|#)\s*:?\s*$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    let fullNumber='';
    if(invoiceLabel){
      fullNumber=String(invoiceLabel.text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*:?\s*(\d{5,8})\b/i)?.[1]||'';
      if(!fullNumber){const right=(Number(invoiceLabel.x)||0)+(Number(invoiceLabel.width)||0),candidates=items.filter(line=>Number(line.page)===Number(invoiceLabel.page)&&Number(line.x)>=right+8&&Math.abs((Number(line.y)||0)-(Number(invoiceLabel.y)||0))<=32).map(line=>({line,match:String(line.text||'').match(/^\s*(\d{5,8})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(invoiceLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(invoiceLabel.y)||0))||Number(a.line.x)-Number(b.line.x));fullNumber=candidates[0]?.match[1]||'';}
    }
    if(!fullNumber)fullNumber=String(text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*:?\s*(\d{5,8})\b/i)?.[1]||'';
    const dateLabel=items.filter(line=>/^\s*date\s*:?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    let dateText='';
    if(dateLabel){
      dateText=String(dateLabel.text||'').match(/^\s*date\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*$/i)?.[1]||'';
      if(!dateText){const right=(Number(dateLabel.x)||0)+(Number(dateLabel.width)||0),candidates=items.filter(line=>Number(line.page)===Number(dateLabel.page)&&Number(line.x)>=right+8&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))<=34).map(line=>({line,match:String(line.text||'').match(/^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(dateLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(dateLabel.y)||0))||Number(a.line.x)-Number(b.line.x));dateText=candidates[0]?.match[1]||'';}
    }
    if(!dateText)dateText=String(text||'').match(/\bdate\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i)?.[1]||'';
    return {fullNumber,date:parseDate(dateText)};
  }
  function deensMoneyCandidates(value,pageLines=[]){
    let raw=String(value||'').trim().replace(/\b(?:GBP|GBR)\b/gi,'').replace(/[£$€ÂÆæZzCcGgSs]/g,'').trim();
    // Windows OCR commonly turns the printed pound sign into `5`. Preserve
    // both readings until another printed footer value confirms which one is
    // correct; an unresolved pair is rejected instead of guessed.
    const normalized=raw.replace(/[oO]/g,'0').replace(/[IiLl|]/g,'1').replace(/;(?=\s*\d{2}$)/,'.').replace(/\s+/g,' ').trim();
    const parse=token=>{
      const cleaned=String(token||'').trim();
      if(!/^-?(?:(?:\d{1,3}(?:[\s,]\d{3})+)|\d+)[.,]\s*\d{2}$/.test(cleaned))return null;
      return invoiceAmount(cleaned);
    };
    const values=[parse(normalized)];
    if(/^5\d+[.,]\s*\d{2}$/.test(normalized))values.push(parse(normalized.slice(1)));
    return [...new Set(values.filter(value=>value!==null))];
  }
  function deensFooterCell(pageLines,labelPattern){
    const labels=pageLines.filter(line=>labelPattern.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){
      const inline=String(label.text||'').match(/:\s*([^:]+)$/),inlineValues=inline?deensMoneyCandidates(inline[1],pageLines):[];
      if(inlineValues.length)return {label,values:inlineValues};
      const right=(Number(label.x)||0)+(Number(label.width)||0),candidates=pageLines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>=right+8&&Math.abs((Number(line.y)||0)-(Number(label.y)||0))<=28).map(line=>({line,values:deensMoneyCandidates(line.text,pageLines)})).filter(item=>item.values.length).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(label.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(label.y)||0))||Number(a.line.x)-Number(b.line.x));
      if(candidates.length)return {label,values:candidates[0].values};
    }
    return null;
  }
  function parseDeensProduceInvoice(flat,source='',ocrLines){
    const allLines=Array.isArray(ocrLines)?ocrLines:[],pages=[...new Set(allLines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),pageGroups=new Map(pages.map(page=>[page,allLines.filter(line=>(Number(line.page)||1)===page)]));
    const invoicePages=pages.filter(page=>deensHeader(pageGroups.get(page),pageGroups.get(page).map(line=>line.text).join(' ')).fullNumber),headers=invoicePages.map(page=>({page,...deensHeader(pageGroups.get(page),pageGroups.get(page).map(line=>line.text).join(' '))}));
    const header=headers[0]||deensHeader(allLines,flat),fullNumber=header.fullNumber,number=fullNumber?fullNumber.slice(-4):'',date=header.date||parseDate(String(flat).match(/\bdate\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i)?.[1]||'');
    const firstPage=header.page||pages[0]||1,nextInvoicePage=headers.find(item=>item.page>firstPage&&item.fullNumber!==fullNumber)?.page,documentPages=pages.filter(page=>page>=firstPage&&(!nextInvoicePage||page<nextInvoicePage));
    const footerPages=documentPages.map(page=>({page,lines:pageGroups.get(page)||[]})).filter(item=>deensFooterCell(item.lines,/^total\s*:?$/i));
    const finalFooter=footerPages.at(-1),totalCell=finalFooter?deensFooterCell(finalFooter.lines,/^total\s*:?$/i):null,subtotalCell=finalFooter?deensFooterCell(finalFooter.lines,/^subtotal\s*:?$/i):null,balanceCell=finalFooter?deensFooterCell(finalFooter.lines,/^balance\s+due\s*:?$/i):null;
    let total=null;
    if(totalCell?.values.length===1)total=totalCell.values[0];
    else if(totalCell?.values.length>1){const corroborating=[...(subtotalCell?.values||[]),...(balanceCell?.values||[])],matching=totalCell.values.filter(value=>corroborating.includes(value));if(matching.length===1)total=matching[0];}
    // Deens Produce invoices in this supplier profile are zero-rated. VAT is
    // supplier-level data, so do not reject an otherwise complete invoice just
    // because OCR misses the non-taxable note or there is no VAT field printed.
    const vat=0;
    const complete=Boolean(number&&date&&total!==null&&isDeensProduceText(flat));
    const rejectedReason=complete?'':!number?'Deens Produce invoice number could not be confirmed.':!date?'Deens Produce invoice date could not be confirmed.':total===null?'Printed Deens Produce Total could not be confirmed without ambiguity.':'Deens Produce supplier identity could not be confirmed.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Deens Produce Ltd',subtotal:'',vat,total:total??'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false,layoutId:'deens-produce-footer-total'};
  }
  function isDairyFreshText(value){
    const text=String(value||'');
    if(/\bDAIRY\s*FRESH\s*(?:LTD|LIMITED)?\b/i.test(text)||/1408634\s*[-.:]?\s*22/i.test(text)||/GB\s*1408634\s*22/i.test(text))return true;
    const words=text.toUpperCase().match(/[A-Z]{6,14}/g)||[];
    return words.some(word=>{for(let start=0;start<word.length;start++)for(let length=8;length<=12&&start+length<=word.length;length++)if(receiptLevenshtein(word.slice(start,start+length),'DAIRYFRESH')<=2)return true;return false;});
  }
  function dairyDigits(value){return String(value||'').replace(/[OoQ]/g,'0').replace(/[Il|]/g,'1').replace(/\D/g,'');}
  function dairyDateCandidates(value){
    const text=String(value||'').replace(/(?<=\d)\s*[/.-]\s*(?=\d)/g,'/'),matches=[...text.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(20\d{2})\b/g)];
    return [...new Set(matches.map(match=>parseDate(match[1]+'/'+match[2]+'/'+match[3])).filter(Boolean))];
  }
  function dairyNormalizedLabel(value){
    return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/gi,'').toUpperCase().replace(/0/g,'O').replace(/1/g,'I');
  }
  function dairyHeader(lines,text=''){
    const items=Array.isArray(lines)?lines:[],top=items.filter(line=>(Number(line.y)||0)<720),numberLabel=top.find(line=>{
      const label=dairyNormalizedLabel(line.text);
      return /ORDER\s*(?:NO|NUMBER)/i.test(String(line.text||''))||receiptLevenshtein(label,'ORDERNO')<=3||receiptLevenshtein(label,'ORDERNUMBER')<=3;
    });
    const numberCandidates=top.map(line=>({line,digits:dairyDigits(line.text)})).filter(item=>item.digits.length>=4&&item.digits.length<=12&&Number(item.line.x)>250&&Number(item.line.x)<1000&&Number(item.line.y)<520);
    numberCandidates.sort((a,b)=>{
      const score=item=>Math.abs(item.digits.length-10)*70+(numberLabel?Math.abs((Number(item.line.y)||0)-(Number(numberLabel.y)||0))*4:Math.abs((Number(item.line.y)||0)-260)*4)+Math.abs((Number(item.line.x)||0)-400)*0.03;
      return score(a)-score(b);
    });
    const numberCandidate=numberCandidates[0],digits=numberCandidate?.digits||'',fullNumber=digits.length===10?digits:'',suffix=digits.length>=4?digits.slice(-4):'';
    const dateLabel=top.find(line=>{
      const label=dairyNormalizedLabel(line.text);
      return /ORDER\s*DATE/i.test(String(line.text||''))||receiptLevenshtein(label,'ORDERDATE')<=3;
    });
    const dates=[];
    for(const line of top){
      if(Number(line.x)<250||Number(line.x)>1000||Number(line.y)<260||Number(line.y)>540)continue;
      if(dateLabel&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))>80)continue;
      dates.push(...dairyDateCandidates(line.text));
    }
    if(!dates.length)for(const line of top)if(Number(line.x)>250&&Number(line.x)<800)dates.push(...dairyDateCandidates(line.text));
    const dateCounts=new Map();for(const date of dates)dateCounts.set(date,(dateCounts.get(date)||0)+1);
    const date=[...dateCounts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
    const pageLines=items.filter(line=>(Number(line.y)||0)>2400).map(line=>String(line.text||''));
    const pageRef=pageLines.join(' ').match(/(?:page|rage|vepage)?\s*(\d{1,2})?\s*of\s*(\d{1,2})/i);
    return {fullNumber,numberDigits:digits,suffix,date,pageNumber:pageRef?.[1]?Number(pageRef[1]):0,pageCount:pageRef?.[2]?Number(pageRef[2]):0,numberLine:numberCandidate?.line};
  }
  function dairyPrintedMoney(value){
    let raw=String(value||'').trim().replace(/[£$€]/g,'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/(?<=\d)\s*[·•]\s*(?=\d{2}\s*$)/u,'.').replace(/;(?=\s*\d{2}\s*$)/,'.').replace(/\s+/g,' ').trim();
    if(!/^-?(?:(?:\d{1,3}(?:[ ,]\d{3})+)|\d+)[.,]\s*\d{2}$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function dairyMoneyCandidates(value){
    const text=String(value||'').replace(/[£$€]/g,' '),matches=[...text.matchAll(/-?\d[\d, ]*[.,;]\s*[\dOoIl]{2}/g)],values=[];
    for(const match of matches){const parsed=dairyPrintedMoney(match[0]);if(parsed!==null)values.push({value:parsed,index:match.index,raw:match[0]});}
    return values;
  }
  function dairyFooterLabel(line,kind){
    const x=Number(line?.x)||0,y=Number(line?.y)||0,label=dairyNormalizedLabel(line?.text);
    if(x<1100||y<650)return false;
    if(kind==='vat'){
      const at=Math.max(label.indexOf('VAT'),label.indexOf('YAT'));
      return at>=0&&receiptLevenshtein(label.slice(0,at),'TOTAL')<=3;
    }
    if(kind==='net')return label.includes('NET')&&(/AMT|AMOUNT/.test(label)||label==='NET'||receiptLevenshtein(label,'NETAMT')<=2);
    if(kind==='total')return !label.includes('VAT')&&receiptLevenshtein(label,'TOTAL')<=2;
    return false;
  }
  function dairyFooterValue(lines,label){
    const sameLine=dairyMoneyCandidates(label.text||'');
    if(sameLine.length===1)return sameLine[0].value;
    const x=Number(label.x)||0,y=Number(label.y)||0,nearby=lines.filter(line=>Number(line.page)===Number(label.page)&&(!Number.isFinite(Number(label.dairyVariant))||Number(line.dairyVariant)===Number(label.dairyVariant))&&Number(line.x)>x+70&&Math.abs((Number(line.y)||0)-y)<=42).map(line=>({line,values:dairyMoneyCandidates(line.text)})).filter(item=>item.values.length).sort((a,b)=>Math.abs((Number(a.line.y)||0)-y)-Math.abs((Number(b.line.y)||0)-y)||Number(b.line.x)-Number(a.line.x));
    const candidates=nearby.flatMap(item=>item.values.map(value=>({line:item.line,...value}))),unique=[...new Set(candidates.map(item=>Math.round(item.value*100)))];
    return unique.length===1?unique[0]/100:null;
  }
  function dairyFooterSummary(pageLines){
    const source=pageLines||[],variants=new Map();
    for(const line of source){const key=Number.isFinite(Number(line.dairyVariant))?String(line.dairyVariant):'base';if(!variants.has(key))variants.set(key,[]);variants.get(key).push(line);}
    const summaries=[];
    for(const lines of variants.values()){
      const ordered=[...lines].sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0)),vatLabels=ordered.filter(line=>dairyFooterLabel(line,'vat'));
      for(const vatLabel of vatLabels){
        const y=Number(vatLabel.y)||0,following=ordered.filter(line=>line.page===vatLabel.page&&Number(line.y)>y&&Number(line.y)<y+650),net=following.find(line=>dairyFooterLabel(line,'net')),totalLabels=following.filter(line=>dairyFooterLabel(line,'total')&&(!net||Number(line.y)>Number(net.y))),totalLabel=totalLabels.at(-1);
        if(!totalLabel)continue;
        const vat=dairyFooterValue(ordered,vatLabel),total=dairyFooterValue(ordered,totalLabel);
        if(vat!==null&&total!==null)summaries.push({vat,total,layoutId:'dairy-fresh-footer-summary'});
      }
    }
    if(!summaries.length)return null;
    const counts=new Map();for(const summary of summaries){const key=`${Math.round(summary.vat*100)}:${Math.round(summary.total*100)}`;counts.set(key,(counts.get(key)||0)+1);}
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]),top=ranked[0],next=ranked[1];if(next&&top[1]===next[1])return null;
    const [vat,total]=top[0].split(':').map(value=>Number(value)/100);
    // A single exact label/value pair is usable when no other variant offers
    // a conflicting printed figure. When OCR variants disagree, accept only
    // the unique majority and leave ties for manual correction.
    return {vat,total,layoutId:'dairy-fresh-footer-summary'};
  }
  function parseDairyFreshFooterRetryTargets(pageLines,page){
    const lines=(pageLines||[]).filter(line=>Number(line.page)===Number(page)&&Number(line.x)>1100&&Number(line.y)>650),products=(pageLines||[]).filter(line=>Number(line.page)===Number(page)&&Number(line.x)>=200&&Number(line.x)<1200&&Number(line.y)>700&&Number(line.y)<2450&&/[A-Za-z]{3}/.test(String(line.text||''))),lastProductY=products.length?Math.max(...products.map(line=>Number(line.y)||0)):0;
    const vatMarkers=lines.filter(line=>dairyFooterLabel(line,'vat')&&(!lastProductY||Number(line.y)>lastProductY)).sort((a,b)=>Number(a.y)-Number(b.y)),discountMarkers=lines.filter(line=>{const label=dairyNormalizedLabel(line.text);return /INVOICE/.test(label)&&receiptLevenshtein(label.replace(/[^A-Z]/g,''),'INVOICEDISC')<=3;}).sort((a,b)=>Number(a.y)-Number(b.y)),netMarkers=lines.filter(line=>dairyFooterLabel(line,'net')).sort((a,b)=>Number(a.y)-Number(b.y)),totalMarkers=lines.filter(line=>dairyFooterLabel(line,'total')).sort((a,b)=>Number(a.y)-Number(b.y));
    const vatMarker=vatMarkers[0],discount=discountMarkers.find(line=>!lastProductY||Number(line.y)>lastProductY),net=netMarkers.find(line=>!vatMarker||Number(line.y)>Number(vatMarker.y)),vatY=vatMarker?Number(vatMarker.y):discount?Number(discount.y)-58:lastProductY?lastProductY+135:0;
    const totalMarker=totalMarkers.filter(line=>Number(line.y)>vatY+60).at(-1),totalY=totalMarker?Number(totalMarker.y):net?Number(net.y)+120:vatY?vatY+230:0;
    if(!(vatY>650&&totalY>vatY&&totalY<3100))return null;
    return {page:Number(page),vatY,totalY};
  }
  function dairyNumberDistance(left,right){
    const a=String(left||''),b=String(right||'');if(!a||!b)return 99;
    const row=Array.from({length:b.length+1},(_,index)=>index);
    for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const current=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=current;}}
    return row[b.length];
  }
  function parseDairyFreshBatch(pageGroups,source=''){
    const pages=[...pageGroups.keys()].sort((a,b)=>a-b),pageInfo=pages.map(page=>{
      const lines=pageGroups.get(page)||[],text=lines.map(line=>String(line.text||'')).join(' '),header=dairyHeader(lines,text);
      const orderTitle=lines.filter(line=>(Number(line.y)||0)<260).some(line=>{const label=dairyNormalizedLabel(line.text);return receiptLevenshtein(label,'ORDERINVOICE')<=5;});
      // A pale supplier watermark sometimes obscures Dairy Fresh on
      // continuation pages. Keep invoice-shaped pages as candidates, then
      // require a positively identified Dairy Fresh page in each group.
      return {page,lines,text,header,orderTitle,supplierMatch:isDairyFreshText(text),isInvoice:orderTitle&&Boolean(header.numberDigits||header.suffix)};
    }).filter(item=>item.isInvoice),groups=[];
    for(const item of pageInfo){
      const header=item.header,candidates=groups.map(group=>({group,score:Math.min(...group.items.map(other=>{
        const prior=other.header,sameDate=!header.date||!prior.date||header.date===prior.date;
        if(header.fullNumber&&prior.fullNumber&&header.fullNumber===prior.fullNumber)return 0;
        if(sameDate&&header.suffix&&prior.fullNumber&&header.suffix===prior.fullNumber.slice(-4))return 0;
        if(sameDate&&header.fullNumber&&prior.suffix&&header.fullNumber.slice(-4)===prior.suffix)return 0;
        if(header.date&&prior.date&&header.date===prior.date&&header.numberDigits&&prior.numberDigits&&dairyNumberDistance(header.numberDigits,prior.numberDigits)<=1&&(header.numberDigits.length!==10||prior.numberDigits.length!==10))return 1;
        if(sameDate&&header.suffix&&prior.suffix&&header.suffix===prior.suffix)return 1;
        if(header.numberDigits&&prior.numberDigits&&(header.numberDigits.length!==10||prior.numberDigits.length!==10)&&header.numberDigits.slice(0,6)===prior.numberDigits.slice(0,6)&&dairyNumberDistance(header.numberDigits,prior.numberDigits)<=1)return 2;
        return 99;
      }))})).filter(candidate=>candidate.score<99).sort((a,b)=>a.score-b.score);
      if(candidates.length)candidates[0].group.items.push(item);else groups.push({items:[item]});
    }
    return groups.filter(group=>group.items.some(item=>item.supplierMatch)).map(group=>{
      const items=group.items.sort((a,b)=>a.page-b.page),numberCounts=new Map(),dateCounts=new Map();
      for(const item of items){if(item.header.fullNumber)numberCounts.set(item.header.fullNumber,(numberCounts.get(item.header.fullNumber)||0)+1);if(item.header.date)dateCounts.set(item.header.date,(dateCounts.get(item.header.date)||0)+1);}
      const fullCandidates=[...numberCounts].sort((a,b)=>b[1]-a[1]),fullNumber=fullCandidates[0]?.[0]||items.map(item=>item.header.numberDigits).find(Boolean)||'',date=[...dateCounts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'',page=items[0].page;
      const finalItem=items.find(item=>item.header.pageCount&&item.header.pageNumber===item.header.pageCount)||items.at(-1),summary=dairyFooterSummary(finalItem.lines),number=fullNumber.slice(-4),vat=summary?.vat??'',total=summary?.total??'',complete=Boolean(fullNumber.length>=7&&number.length===4&&date&&vat!==''&&total!==''&&Number.isFinite(Number(vat))&&Number.isFinite(Number(total)));
      const documentPages=items.map(item=>item.page),reason=complete?'':number.length!==4?'Dairy Fresh order number could not be confirmed from the printed header.':!date?'Dairy Fresh order date could not be confirmed.':total===''?'Printed Dairy Fresh Total could not be confirmed from its final-page footer; one 5x OCR retry is required.':'Printed Dairy Fresh Total VAT Amt could not be confirmed from its final-page footer; one 5x OCR retry is required.';
      return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Dairy Fresh Ltd',subtotal:'',vat,total,documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,page,footerPage:finalItem.page,sourcePages:documentPages,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false,layoutId:summary?.layoutId||'dairy-fresh-footer-summary',profileId:'dairy-fresh'};
    });
  }
  function parseDairyFreshInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines:[];
    if(lines.length){
      const groups=new Map();for(const line of lines){const page=Number(line.page)||1;if(!groups.has(page))groups.set(page,[]);groups.get(page).push(line);}
      return parseDairyFreshBatch(groups,source)[0]||{invoiceNumber:'',originalInvoiceNumber:'',date:'',supplier:'Dairy Fresh Ltd',subtotal:'',vat:'',total:'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:false,rejected:true,status:'REJECTED',rejectedReason:'Dairy Fresh invoice details could not be confirmed from the printed header and footer.',retryOcr:true,review:false,layoutId:'dairy-fresh-footer-summary',profileId:'dairy-fresh'};
    }
    const text=String(flat||''),number=text.match(/order\s*(?:no|number)\s*[:#.-]?\s*(20\d{8})/i)?.[1]||'',dateText=text.match(/order\s*date\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]20\d{2})/i)?.[1]||'',rows=text.split(/\r?\n/),vatLine=rows.find(line=>/total\s+vat\s+amt/i.test(line)),totalLine=rows.find(line=>/^\s*total\s*:?\s*[-\d]/i.test(line)),vat=dairyMoneyCandidates(vatLine||'').at(-1)?.value??'',total=dairyMoneyCandidates(totalLine||'').at(-1)?.value??'',fullNumber=number,date=parseDate(dateText),complete=Boolean(fullNumber&&date&&vat!==''&&total!=='');
    return {invoiceNumber:fullNumber.slice(-4),originalInvoiceNumber:fullNumber,date,supplier:'Dairy Fresh Ltd',subtotal:'',vat,total,documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',rejectedReason:complete?'':!fullNumber?'Dairy Fresh order number could not be confirmed.':!date?'Dairy Fresh order date could not be confirmed.':total===''?'Printed Dairy Fresh Total could not be confirmed.':'Printed Dairy Fresh Total VAT Amt could not be confirmed; a focused 5x OCR retry is required.',retryOcr:!complete,review:false,layoutId:'dairy-fresh-footer-summary',profileId:'dairy-fresh'};
  }  function monolithHeader(text,ocrLines=[]){
    const source=String(text||''),number=source.match(/\bAUTO\s+INVOICE\s*[-–—]?\s*A\s*([0-9]{5,8})\b/i),page=source.match(/\bPage\s*(\d+)\s+of\s+(\d+)\s*[-–—]?\s*Original\b/i);
    const lines=Array.isArray(ocrLines)?ocrLines:[],dateLabel=lines.filter(line=>/^\s*Date\s*:?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    const dateCandidate=dateLabel?lines.filter(line=>(Number(line.page)||1)===(Number(dateLabel.page)||1)&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))<=70).map(line=>({line,match:String(line.text||'').match(/^\s*[:#.-]?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(dateLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(dateLabel.y)||0))||Number(a.line.x)-Number(b.line.x))[0]:null;
    const dateRaw=dateCandidate?.match[1]||source.match(/\bDate\s*:?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[-/.]\s*\d{4})\b/i)?.[1]||source.match(/\bPaid\s+by\s+(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})\b/i)?.[1]||'';
    return {number:number?.[1]||source.match(/\bUK26FAC2A(\d{6})\b/i)?.[1]||'',pageNumber:page?Number(page[1]):0,pageCount:page?Number(page[2]):0,date:parseDate(dateRaw.replace(/\s/g,''))};
  }
  function monolithPrintedMoney(value){
    let raw=String(value||'').trim().replace(/\b(?:GBR|GBP)\b/gi,'').replace(/[£$€]/g,'').trim();
    if(/^(?:[mM]?[Oo]{2,4}|[Oo]{1,2}[.,;][Oo]{2})$/i.test(raw))return 0;
    raw=raw.replace(/([.,;])\s*[Oo]{2}$/i,(_,separator)=>separator+'00').replace(/([.,;])[Oo](?=\d)/gi,(_,separator)=>separator+'0').replace(/;(?=\s*\d{2}$)/,'.');
    if(!/^-?(?:(?:\d{1,3}(?:[\s,]\d{3})+)|\d+)[.,]\s*\d{2}$/.test(raw.trim()))return null;
    return invoiceAmount(raw);
  }
  function monolithFooterCell(pageLines,kind){
    const isVat=kind==='vat',vatAnchor=pageLines.filter(line=>/\bTOTAL\s+VAT\b/i.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0))[0],labels=pageLines.filter(line=>{
      const text=String(line.text||'').trim(),y=Number(line.y)||0;
      if(isVat)return /\bTOTAL\s+VAT\b/i.test(text);
      return (/^\s*T\s*O?TAL\s*:?\s*$/i.test(text)||/\bCONTINUING\b[\s\S]*\bT\s*O?TAL\s*:?\s*$/i.test(text))&&(!vatAnchor||y>=(Number(vatAnchor.y)||0)-20);
    }).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0));
    for(const label of labels){
      const inline=String(label.text||'').match(/:\s*(.*?)\s*$/),inlineValue=inline?monolithPrintedMoney(inline[1]):null;
      if(inlineValue!==null)return inlineValue;
      const y=Number(label.y)||0,x=Number(label.x)||0,candidates=pageLines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>x+300&&Math.abs((Number(line.y)||0)-y)<=36).map(line=>({line,value:monolithPrintedMoney(line.text)})).filter(item=>item.value!==null).sort((a,b)=>Math.abs((Number(a.line.y)||0)-y)-Math.abs((Number(b.line.y)||0)-y)||Number(a.line.x)-Number(b.line.x));
      if(candidates.length)return candidates[0].value;
    }
    // The `Total` caption can be faint on these scans, but its amount is
    // printed alone below the VAT/transport summary at the foot of the page.
    if(!isVat){
      const transport=pageLines.filter(line=>/\bTOTAL\s+TRANSPORT\b/i.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0))[0],anchorY=Number(transport?.y)||0,anchorX=Number(transport?.x)||0,candidates=pageLines.filter(line=>transport&&Number(line.page)===Number(transport.page)&&Number(line.x)>anchorX+300&&(Number(line.y)||0)>anchorY+20&&(Number(line.y)||0)<=anchorY+250&&monolithPrintedMoney(line.text)!==null).map(line=>({line,value:monolithPrintedMoney(line.text)})).sort((a,b)=>(Number(b.line.y)||0)-(Number(a.line.y)||0));
      if(candidates.length)return candidates[0].value;
    }
    return null;
  }
  function parseMonolithInvoice(flat,source='',ocrLines){
    const allLines=Array.isArray(ocrLines)?ocrLines:[],pages=[...new Set(allLines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),pageGroups=new Map(pages.map(page=>[page,allLines.filter(line=>(Number(line.page)||1)===page)]));
    const invoicePages=pages.map(page=>({page,lines:pageGroups.get(page)||[],text:(pageGroups.get(page)||[]).map(line=>String(line.text||'')).join(' ')})).filter(item=>isMonolithText(item.text)&&!/\bDelivery\s+Note\b|\bReclamation\b/i.test(item.text)&&monolithHeader(item.text,item.lines).number);
    const first=invoicePages.find(item=>monolithHeader(item.text,item.lines).pageNumber===1)||invoicePages[0],header=first?monolithHeader(first.text,first.lines):monolithHeader(flat),fullNumber=header.number,number=fullNumber?fullNumber.slice(-4):'',date=header.date||invoicePages.map(item=>monolithHeader(item.text,item.lines).date).find(Boolean)||'';
    const matching=invoicePages.filter(item=>monolithHeader(item.text,item.lines).number===fullNumber),last=matching.find(item=>{const parsed=monolithHeader(item.text,item.lines);return parsed.pageNumber>0&&parsed.pageNumber===parsed.pageCount;})||matching.at(-1),vat=last?monolithFooterCell(last.lines,'vat'):null,total=last?monolithFooterCell(last.lines,'total'):null,complete=Boolean(number&&date&&vat!==null&&total!==null);
    const rejectedReason=complete?'':!number?'Monolith invoice number could not be confirmed from the printed invoice header.':!date?'Monolith invoice date could not be confirmed.':total===null?'Printed Monolith invoice total could not be confirmed from its final invoice page.':'Printed Monolith VAT could not be confirmed from its final invoice page.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Monolith',subtotal:'',vat:vat??'',total:total??'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false};
  }
  function marionHeader(lines,text=''){
    const items=Array.isArray(lines)?lines:[],numberLabel=items.filter(line=>/\binvoice\s*(?:no\.?|number|#)\b/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    let fullNumber='';
    if(numberLabel){
      fullNumber=String(numberLabel.text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*[:#.-]?\s*(\d{8})\b/i)?.[1]||'';
      if(!fullNumber){const candidate=items.filter(line=>Number(line.page)===Number(numberLabel.page)&&Number(line.x)>Number(numberLabel.x)+80&&Math.abs((Number(line.y)||0)-(Number(numberLabel.y)||0))<=28).map(line=>({line,match:String(line.text||'').match(/^\s*(?:[:#.]\s*)?(\d{8})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(numberLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(numberLabel.y)||0))||Number(a.line.x)-Number(b.line.x));
        fullNumber=candidate[0]?.match[1]||'';
      }
    }
    if(!fullNumber)fullNumber=String(text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*[:#.-]?\s*(\d{8})\b/i)?.[1]||'';
    const dateLabel=items.filter(line=>/^\s*date\s*:?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    let dateText='';
    if(dateLabel){
      dateText=String(dateLabel.text||'').match(/^\s*date\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*$/i)?.[1]||'';
      if(!dateText){const candidate=items.filter(line=>Number(line.page)===Number(dateLabel.page)&&Number(line.x)>Number(dateLabel.x)+50&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))<=30).map(line=>({line,match:String(line.text||'').match(/^\s*[:#.•·]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(dateLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(dateLabel.y)||0))||Number(a.line.x)-Number(b.line.x));
        dateText=candidate[0]?.match[1]||'';
      }
    }
    if(!dateText)dateText=String(text||'').match(/\bdate\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i)?.[1]||'';
    return {fullNumber,date:parseDate(dateText)};
  }
  function marionPrintedMoney(value){
    const raw=String(value||'').trim().replace(/[£$€]/g,'').replace(/\s/g,'');
    if(/^(?:0+(?:[.,]0{1,2})?|[Oo][.,]?[Oo]{0,2})$/i.test(raw))return 0;
    if(!/^-?(?:(?:\d{1,3}(?:[, ]\d{3})+)|\d+)[.,]\d{2}$/.test(String(value||'').replace(/[£$€]/g,'').trim()))return null;
    return invoiceAmount(value);
  }
  function marionFooterCell(pageLines,labelPattern){
    const labels=pageLines.filter(line=>labelPattern.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0));
    for(const label of labels){
      const inline=String(label.text||'').match(/:\s*([^:]+)$/),inlineValue=inline?marionPrintedMoney(inline[1]):null;
      if(inlineValue!==null)return inlineValue;
      const candidates=pageLines.filter(line=>Number(line.page)===Number(label.page)&&Number(line.x)>Number(label.x)+100&&Math.abs((Number(line.y)||0)-(Number(label.y)||0))<=24).map(line=>({line,value:marionPrintedMoney(line.text)})).filter(item=>item.value!==null).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(label.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(label.y)||0))||Number(a.line.x)-Number(b.line.x));
      if(candidates.length)return candidates[0].value;
    }
    return null;
  }
  function marionConsensus(values){
    const counts=new Map();
    for(const value of values.filter(value=>value!==null&&value!==undefined)){const cents=Math.round(Number(value)*100);counts.set(cents,(counts.get(cents)||0)+1);}
    if(!counts.size)return null;
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
    if(ranked.length>1&&ranked[0][1]===ranked[1][1])return null;
    return ranked[0][0]/100;
  }
  function marionAllItemVatRatesAreZero(pageLines){
    let itemPages=0;
    for(const lines of pageLines.values()){
      const hasItemTable=lines.some(line=>/^\s*(?:product\s+qty|product\s+code|code\s+description)\b/i.test(String(line.text||'')));
      const vatHeader=lines.filter(line=>(Number(line.y)||0)<1200&&Number(line.x)>1000&&/^\s*VAT\s*%?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
      if(!vatHeader){if(hasItemTable)return false;continue;}
      const rowCodes=lines.filter(line=>Number(line.x)<160&&Number(line.y)>Number(vatHeader.y)+15&&Number(line.y)<2150&&/^\s*\d{3,6}\s*$/.test(String(line.text||'')));
      if(!rowCodes.length){if(hasItemTable)return false;continue;}
      const rateCells=lines.filter(line=>Number(line.x)>=Number(vatHeader.x)+15&&Number(line.x)<Number(vatHeader.x)+85&&Number(line.y)>Number(vatHeader.y)+15&&Number(line.y)<2150&&/^\s*[0-9Oo]+(?:[.,][0-9Oo]+)?\s*%?\s*$/.test(String(line.text||'')));
      if(rateCells.length<rowCodes.length)return false;
      const allZero=rateCells.every(line=>/^0+(?:[.,]0+)?%?$/.test(String(line.text||'').trim().replace(/[Oo]/g,'0')));
      if(!allZero)return false;
      itemPages++;
    }
    return itemPages>0;
  }
  function parseMarionInvoice(flat,source='',ocrLines){
    const allLines=Array.isArray(ocrLines)?ocrLines:[],pages=[...new Set(allLines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),pageGroups=new Map(pages.map(page=>[page,allLines.filter(line=>(Number(line.page)||1)===page)]));
    const invoicePages=pages.filter(page=>marionHeader(pageGroups.get(page),pageGroups.get(page).map(line=>line.text).join(' ')).fullNumber),headers=invoicePages.map(page=>({page,...marionHeader(pageGroups.get(page),pageGroups.get(page).map(line=>line.text).join(' '))}));
    const header=headers[0]||marionHeader(allLines,flat),fullNumber=header.fullNumber,number=fullNumber?fullNumber.slice(-4):'',date=header.date||parseDate(String(flat).match(/\bdate\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i)?.[1]||'');
    const documentPages=fullNumber?invoicePages.filter(page=>headers.some(item=>item.page===page&&item.fullNumber===fullNumber)):pages;
    const vatValues=[],totalValues=[];
    for(const page of documentPages){const lines=pageGroups.get(page)||[],vat=marionFooterCell(lines,/^\s*VAT\s+Total\s*:?\s*$/i),total=marionFooterCell(lines,/^\s*Total\s*:?\s*$/i);if(vat!==null)vatValues.push(vat);if(total!==null)totalValues.push(total);}
    let vat=marionConsensus(vatValues);
    if(vat===null&&documentPages.length&&marionAllItemVatRatesAreZero(new Map(documentPages.map(page=>[page,pageGroups.get(page)||[]]))))vat=0;
    const total=marionConsensus(totalValues),complete=Boolean(number&&date&&vat!==null&&total!==null),retryOcr=!complete;
    const rejectedReason=complete?'':!number?'Marion Trading invoice number could not be confirmed.':!date?'Marion Trading invoice date could not be confirmed.':total===null?'Printed Marion Trading invoice total could not be confirmed from its footer.':'Printed Marion Trading VAT total could not be confirmed from its footer.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Marion Trading',subtotal:'',vat:vat??'',total:total??'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr,review:false};
  }
  function isMarionSummaryPage(pageLines){
    const text=pageLines.map(line=>String(line.text||'')).join(' '),hasInvoiceNumber=pageLines.some(line=>/\binvoice\s*(?:no\.?|number|#)\b/i.test(String(line.text||'')));
    return !hasInvoiceNumber&&/\bTOTAL\b/i.test(text)&&/\bINVOICE\s*[1-4]\s*:/i.test(text)&&/\bSOLD\b/i.test(text)&&/\bBALANCE\b/i.test(text);
  }
  const receiptProfiles=[
    {id:'tesco',name:'Tesco',category:'Fuel receipts',detect:text=>/\bTESCO\b/i.test(text)&&/\b(?:PUMP|PETROL|FUEL|TOTAL|UNLEADED|SALE|LITRE|LITER|RECEIPT\s+SUMMARY)\b/i.test(text)},
    {id:'esso',name:'Esso',category:'Fuel receipts',detect:text=>/\bESSO\b/i.test(text)||/239\s*088\s*635|218\s*001\s*105/.test(text)},
    // BP receipts in these scans often lose the red BP logo in OCR. Their
    // registered VAT number is a stable content identifier across layouts.
    {id:'bp',name:'BP',category:'Fuel receipts',detect:text=>/\b(?:BP|LITTLE HAMPTON)\b/i.test(text)||/663\s*139\s*630/.test(text)},
    {id:'shell',name:'Shell',category:'Fuel receipts',detect:text=>{const words=String(text||'').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean),knownSite=/\b(?:HUNTINGDON\s+ROAD|FENGATE|WESTWOOD|STANGROUND|NORTHMEAD|WESTSIDE)\b/i.test(text),shellWord=words.some(word=>word.length>=4&&word.length<=7&&receiptLevenshtein(word,'SHELL')<=2);return (shellWord||knownSite)&&/\b(?:PUMP|ARTICLE|CUSTOMER|TOTAL|MASTERCARD|AMOUNT|FUEL|UNLEADED|EFT|RECEIPT)\b/i.test(text);}},
    {id:'mfg',name:'MFG',category:'Fuel receipts',detect:text=>/\b(?:MFG|MOTOR FUEL)\b/i.test(text)&&/\b(?:PUMP|TOTAL|SALE|UNLEADED|POS)\b/i.test(text)},
    // OCR commonly mangles the header (`EG ON THE MijVb`) but reads the
    // company name or VAT number in the footer more reliably.
    {id:'eg-on-the-move',name:'EG On The Move',category:'Fuel receipts',detect:text=>/\bEG\s+ON\s+THE\s+(?:MOVE|MI[JV]V?B)\b/i.test(text)||/\bEIG\s+on\s+the\s+Move\s+Ltd\b/i.test(text)||/473\s*949\s*343/.test(text)},
    {id:'saxon-autopoint',name:'Saxon AutoPoint',category:'Fuel receipts',detect:text=>/\bSAXON\s+AUTO\s*POINT\b/i.test(text)&&/\b(?:PUMP|TOTAL|SALE|UNLEADED)\b/i.test(text)},
    {id:'other-forecourt',name:'Other forecourt',category:'Fuel receipts',detect:text=>/\b(?:UNLEADED|PETROL|PUMP|FUEL)\b/i.test(text)&&/\b(?:VAT|TOTAL|POS|RECEIPT)\b/i.test(text)},
    {id:'unidentified-forecourt',name:'Unidentified forecourt',category:'Fuel receipts',detect:()=>false}
  ];
  function compatibleCompanies(){return [
    {id:'monzo-bank',name:'Monzo',category:'Bank statements',description:'Digital PDF statements with ISO dates and CR/DR transactions'},
    {id:'barclays-bank',name:'Barclays',category:'Bank statements',description:'OCR-supported statements with day and month transaction dates'},
    {id:'metro-bank',name:'Metro Bank',category:'Bank statements',description:'Column-based statements and online transaction reports with separate money out, money in and balance columns'},
    {id:'hsbc-bank',name:'HSBC',category:'Bank statements',description:'OCR-supported statements with labelled date, paid out, paid in and balance columns'},
    ...receiptProfiles.map(({id,name,category})=>({id,name,category})),
    ...invoiceProfiles.filter(profile=>!['generic','wz-delivery'].includes(profile.id)).map(({id,name,status})=>({id,name,category:'Invoices',...(status?{status}:{})}))
  ];}
  function receiptLevenshtein(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const current=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=current;}}return row[b.length];}
  function receiptTotalLabel(value){const letters=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I');return !['TOTALS','TODAY'].includes(letters)&&letters.length>=4&&letters.length<=6&&receiptLevenshtein(letters,'TOTAL')<=2;}
  function receiptFaintTotalLabel(line,fuelY){const x=Number(line?.x)||0,y=Number(line?.y)||0,letters=String(line?.text||'').toUpperCase().replace(/[^A-Z]/g,'');return x<260&&y>=(Number(fuelY)||0)+70&&y<=(Number(fuelY)||0)+320&&letters.length>=2&&letters.length<=3&&receiptLevenshtein(letters,'TOTAL')<=3;}
  function receiptMfgTotalLabel(line){const text=String(line?.text||''),letters=text.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I').replace(/I/g,'L'),x=Number(line?.x)||0,y=Number(line?.y)||0;if(receiptLevenshtein(letters,'TOTALS')<receiptLevenshtein(letters,'TOTAL'))return false;return x<300&&y>500&&y<1050&&letters.length>=4&&letters.length<=7&&receiptLevenshtein(letters,'TOTAL')<=2;}
  function receiptMoneyTokens(value){
    const text=String(value||'').replace(/[\u00A3\u20AC$]/g,' ').replace(/(^|[^\p{L}\d])[eEcCyY]\s*[aAgG]\s*[oO](?=[\s.,;-]*\d{2}(?:\s|$|[^\p{L}]))/gu,(_,lead)=>lead+'30').replace(/(^|[^\p{L}\d])[nN]\s*[oO](?=[\s.,;-]*\d{2}(?:\s|$|[^\p{L}]))/gu,(_,lead)=>lead+'20').replace(/([.,]\s*\d)\s*[bB](?=\s|$|[^\p{L}])/gu,(_,digit)=>digit+'6'),pattern=/\(?-?[\dOoIl]{1,4}(?:[\s,.'\u2019][\dOoIl]{3})*(?:\s*[.,;-]\s*[\dOoIl]{2})\)?/g,matches=[...text.matchAll(pattern)],values=[];
    for(const match of text.matchAll(/(?<![\d/])\d{1,4}\s+\d{2}(?!\d)/g))matches.push(match);
    matches.sort((a,b)=>a.index-b.index);
    for(const match of matches){const normalized=match[0].replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/[\u2019']/g,'').replace(/(\d)\s*-\s*(?=\d{2}\b)/g,'$1.').replace(/(?<=\d)\s+(?=\d{2}\b)/g,'.').replace(/\s+/g,' ').replace(/[;,]/g,'.'),parsed=invoiceAmount(normalized);if(parsed!==null&&Math.abs(parsed)<=100000&&!values.some(item=>item.index===match.index))values.push({raw:match[0],value:parsed,index:match.index});}
    return values;
  }
  function receiptDateFromText(value){
    const text=String(value||'').replace(/\b0[bB](?=\s+20\d{2}\b)/g,'05').replace(/(\d{1,2}[./-]\s*\d{1,2})\s+(20\d{2})\b/g,'$1/$2').replace(/(?<=\d)\s+([./-])\s+(?=\d)/g,'$1').replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\b[:,]?\s*/ig,'');
    const numeric=[...text.matchAll(/\b(?:\d{1,2}[./-]\s*\d{1,2}[./-]\s*\d{2,4}|20\d{2}[./-]\d{1,2}[./-]\d{1,2})\b/g)].map(match=>parseDate(match[0].replace(/\s+/g,''))).filter(Boolean);
    const monthNames={jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec'};
    const word=[...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s,.:/-]+([A-Za-z]{3,9})[\s,.:/-]+(20\d{2})\b/ig)].map(match=>parseDate(`${match[1]} ${monthNames[match[2].slice(0,3).toLowerCase()]||match[2]} ${match[3]}`)).filter(Boolean);
    return [...new Set([...numeric,...word])];
  }
  function receiptDateValuesFromLines(lines){
    const eligible=lines.filter(line=>!/(?:expiry|expires|valid\s+from|start\s+date)/i.test(line.text||'')),values=eligible.flatMap(line=>receiptDateFromText(line.text));
    // OCR sometimes puts the day and the remainder of a date on adjacent
    // lines within the same printed row. Rejoin only a short numeric fragment
    // with a nearby line containing a four-digit year.
    for(const fragment of eligible){const text=String(fragment.text||'').trim();if(!/^\d{1,2}[./-]?$/.test(text))continue;for(const continuation of eligible){if(continuation===fragment||! /20\d{2}/.test(String(continuation.text||'')))continue;const dy=Math.abs((Number(fragment.y)||0)-(Number(continuation.y)||0)),dx=(Number(continuation.x)||0)-(Number(fragment.x)||0);if(dy<=18&&dx>=0&&dx<=240)values.push(...receiptDateFromText(`${text} ${continuation.text}`));}}
    return [...new Set(values)];
  }
  function receiptFuelDescription(value){
    const letters=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/UN[I1]/g,'UNL');if(letters.includes('PETROLEUM'))return false;
    for(const target of ['UNLEADED','DIESEL','PETROL']){const allowance=target.length>=8?2:1;for(let length=Math.max(5,target.length-allowance);length<=target.length+allowance;length++)for(let start=0;start+length<=letters.length;start++)if(receiptLevenshtein(letters.slice(start,start+length),target)<=allowance)return true;}
    return false;
  }
  function looksLikeUnidentifiedReceipt(lines){
    const possibleTotals=lines.filter(line=>{const x=Number(line.x)||0,y=Number(line.y)||0,letters=String(line.text||'').toUpperCase().replace(/[^A-Z]/g,'');return x<260&&y>100&&y<1100&&letters.length>=4&&letters.length<=8&&receiptLevenshtein(letters,'TOTAL')<=3;});
    return possibleTotals.some(label=>{const y=Number(label.y)||0,numberLike=lines.some(line=>{const lineY=Number(line.y)||0,x=Number(line.x)||0,text=String(line.text||'');return x>250&&Math.abs(lineY-y)<=320&&/\d/.test(text)&&/[.,]/.test(text);}),vatLike=lines.some(line=>{const text=String(line.text||'').toUpperCase(),letters=text.replace(/[^A-Z]/g,'');return /\bVAT\b|V[\W_]{0,3}A?[\W_]{0,2}T/i.test(text)||/^V.{0,2}T/.test(letters);});return numberLike&&vatLike;});
  }
  function isReceiptBackPage(pageLines){
    const text=(Array.isArray(pageLines)?pageLines:[]).map(line=>String(line.text||'')).join(' ').replace(/\s+/g,' ').trim();
    return /should you change your mind about your purchase|please return the product with your proof of purchase|thank you for using pay at pump/i.test(text)&&!/\b(?:UNLEADED|DIESEL|LITRE|LITER|VAT\s+RECEIPT\s+SUMMARY|MASTERCARD|SALE|CARD\s+PAYMENT)\b/i.test(text);
  }
  function mfgMoneyTokens(value){
    const tokens=receiptMoneyTokens(value);if(tokens.length)return tokens;
    // MFG's small Sagaa subtotal can render as `I .25` when OCR merges the
    // pound sign with a single leading 1. Accept that glyph only in the
    // tightly identified MFG subtotal cell, never as a general money rule.
    const match=String(value||'').match(/^\s*[Il|]\s*[.,]\s*(\d{2})\s*$/);if(!match)return [];
    const parsed=invoiceAmount(`1.${match[1]}`);return parsed===null?[]:[{raw:match[0],value:parsed,index:0}];
  }
  function mfgReceiptBreakdown(lines,total){
    const sellers=lines.filter(line=>{const key=String(line.text||'').toUpperCase().replace(/[^A-Z]/g,'');return key.includes('MOTORFUEL')||key.includes('SAGAARETAIL');}).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));let fuelAmount='',drawingsAmount='';
    for(let index=0;index<sellers.length;index++){
      const seller=sellers[index],sellerText=String(seller.text||''),y=Number(seller.y)||0,nextY=Number(sellers[index+1]?.y)||Infinity;
      const footer=lines.filter(line=>{const lineY=Number(line.y)||0,label=String(line.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return lineY>y&&lineY<nextY&&lineY-y<230&&label.length>=4&&label.length<=7&&receiptLevenshtein(label,'TOTALS')<=2;}).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
      const footerY=Number(footer?.y)||0,values=footer?lines.filter(line=>Math.abs((Number(line.y)||0)-footerY)<=14&&(Number(line.x)||0)>=450).flatMap(line=>mfgMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=0&&value<=200):[],unique=[...new Set(values.map(value=>Math.round(value*100)))],sellerKey=sellerText.toUpperCase().replace(/[^A-Z]/g,'');let value=unique.length===1?unique[0]/100:null;
      // The MFG summary prints the gross amount under the "Inc. VAT" heading
      // immediately above its Totals row. OCR occasionally loses digits in
      // that repeated footer row (for example `20 coo`), while the printed
      // gross above it remains clear. Read that printed cell as a fallback;
      // never derive fuel from the receipt total when a shop seller is present.
      if(value===null&&sellerKey.includes('MOTORFUEL')){
        const grossHeaders=lines.filter(line=>{const label=String(line.text||'').toUpperCase().replace(/[^A-Z]/g,'').replace(/1/g,'I').replace(/0/g,'O');return (Number(line.y)||0)>y&&(Number(line.y)||0)<nextY&&receiptLevenshtein(label,'INCVAT')<=2&&(Number(line.x)||0)>=450;}),grossValues=[];
        for(const header of grossHeaders){const hx=Number(header.x)||0,hy=Number(header.y)||0;for(const line of lines){const lx=Number(line.x)||0,ly=Number(line.y)||0;if(ly<=hy+14||ly>hy+55||lx<hx-15||lx>hx+170)continue;for(const token of mfgMoneyTokens(line.text)){const amount=Math.abs(token.value);if(amount>=0&&amount<=200)grossValues.push(Math.round(amount*100));}}}
        const grossUnique=[...new Set(grossValues)];if(grossUnique.length===1)value=grossUnique[0]/100;
      }
      if(value===null)continue;
      if(sellerKey.includes('MOTORFUEL'))fuelAmount=value;else if(sellerKey.includes('SAGAARETAIL'))drawingsAmount=value;
    }
    if(/\bTAXI\s+DRIVER\b/i.test(lines.map(line=>String(line.text||'')).join(' '))&&total!=='')return {fuelAmount:Number(total),drawingsAmount:''};
    if(fuelAmount===''&&total!==''&&!sellers.some(line=>String(line.text||'').toUpperCase().replace(/[^A-Z]/g,'').includes('SAGAARETAIL')))fuelAmount=Number(total);
    return {fuelAmount,drawingsAmount};
  }
  function receiptAmountCounts(lines,anchorY,maximum){
    const counts=new Map(),minimumY=Number.isFinite(anchorY)?anchorY-100:0,maximumY=Number.isFinite(anchorY)?anchorY+700:1300;
    for(const line of lines){const y=Number(line.y)||0,x=Number(line.x)||0,text=String(line.text||'');if(y<minimumY||y>maximumY||x<280||/\b(?:VAT|NET|RATE|LITRE|LITER|P\/L|POINTS?|BALANCE|CHANGE|AUTH|MERCHANT|TERMINAL|TRANSACTION|EXPIR(?:Y|ES))\b/i.test(text))continue;for(const token of receiptMoneyTokens(text)){const cents=Math.round(Math.abs(token.value)*100);if(cents>=200&&cents<=maximum*100)counts.set(cents,(counts.get(cents)||0)+1);}}
    return counts;
  }
  function receiptTenderTotal(lines,maximum){
    const labels=lines.filter(line=>{const x=Number(line.x)||0,y=Number(line.y)||0,text=String(line.text||'');return x<500&&y>180&&y<2400&&!/\bVAT\b/i.test(text)&&/\b(?:SALE|PAID\s+BY|CARD\s+PAYMENT|MASTERCARD|VISA|EFT|AMOUNT)\b/i.test(text);}),candidates=[];
    const confirmedCents=new Set();for(const anchor of lines.filter(line=>receiptTotalLabel(line.text))){const ax=Number(anchor.x)||0,ay=Number(anchor.y)||0;for(const line of lines){const x=Number(line.x)||0,y=Number(line.y)||0,fragment=String(line.text||'').match(/(?<![\d/])[.,]\s*(\d{2})(?=\s|$|[^A-Za-z])/);if(x>=ax+180&&Math.abs(y-ay)<=45&&fragment)confirmedCents.add(fragment[1]);}}
    for(const label of labels){const x=Number(label.x)||0,y=Number(label.y)||0,text=String(label.text||'').toUpperCase(),rank=/\bSALE\b/.test(text)?0:/\bPAID\s+BY\b|\bCARD\s+PAYMENT\b|\bAMOUNT\b/.test(text)?1:2;for(const line of lines){const lx=Number(line.x)||0,ly=Number(line.y)||0;if(Math.abs(ly-y)>58||lx<x+150)continue;const tokens=receiptMoneyTokens(line.text);for(const token of tokens){const value=Math.abs(token.value);if(value<2||value>maximum)continue;candidates.push({value,score:rank*100+Math.abs(ly-y)+Math.max(0,x+300-lx)*0.04});}
        // On faint Shell slips OCR can collapse the two penny digits into a
        // letter (for example `30.c.`), while the printed TOTAL row still
        // yields its two cents. Reuse only that directly observed cents pair;
        // never infer the amount from VAT or fuel calculations.
        if(!tokens.length&&/\bAMOUNT\b/.test(text)&&confirmedCents.size===1){const partial=String(line.text||'').match(/^\s*[£€$]?\s*(\d{1,3})\s*[.,]\s*[cC]\.??\s*$/);if(partial){const value=Number(`${partial[1]}.${[...confirmedCents][0]}`);if(value>=2&&value<=maximum)candidates.push({value,score:rank*100+Math.abs(ly-y)+Math.max(0,x+300-lx)*0.04});}}
      }}
    if(!candidates.length)return '';
    const counts=receiptAmountCounts(lines,Math.min(...labels.map(line=>Number(line.y)||0)),maximum);candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],sameBand=candidates.filter(item=>item.score<=best.score+20),distinct=[...new Set(sameBand.map(item=>Math.round(item.value*100)))];if(distinct.length===1)return best.value;
    const frequent=[...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]);return frequent.length?frequent[0][0]/100:best.value;
  }
  function receiptFuelAmount(lines,maximum){
    const anchors=lines.filter(line=>receiptFuelDescription(line.text)).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));if(!anchors.length)return '';
    const candidates=[];for(const anchor of anchors){const x=Number(anchor.x)||0,y=Number(anchor.y)||0;for(const line of lines){const lx=Number(line.x)||0,ly=Number(line.y)||0,dy=Math.abs(ly-y);if(dy>55||lx<x+170)continue;for(const token of receiptMoneyTokens(line.text)){const value=Math.abs(token.value);if(value<2||value>maximum)continue;candidates.push({value,score:dy+Math.max(0,x+300-lx)*0.03});}}}
    if(!candidates.length)return '';candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],sameBand=candidates.filter(item=>item.score<=best.score+8),distinct=[...new Set(sameBand.map(item=>Math.round(item.value*100)))];return distinct.length===1?best.value:'';
  }
  function receiptOtherPurchases(lines,fuelY,totalY,maximum){
    const knownFuelY=Number(fuelY)||0,knownTotalY=Number(totalY)||0,start=Math.max(180,knownFuelY-120),end=knownTotalY>start?knownTotalY+18:knownFuelY+360,ignored=/\b(?:TOTAL|TOTALS|MASTERCARD|VISA|CARD|SALE|PAYMENT|PAID|PUMP|UNLEADED|DIESEL|PETROL|FUEL|LITRE|LITER|VAT|NET|RATE|RECEIPT|CHANGE|AUTH|MERCHANT|TERMINAL|TRANSACTION|AMOUNT|AID|PAN|SEQUENCE|POINTS?|CLUBCARD|QUALIFYING|EXPIR|DATE|TIME|CUSTOMER|THANK|PLEASE|COPY|NO\s+CHANGE|CASH|CREDIT|DEBIT|PENALTY|DISCOUNT|SAVING|LOYALTY|PROMOTION|ARTICLE|QTY|QUANTITY|PRICE|GBP|APPROVED|NO\s+TAXI\s+DRIVER)\b/i,items=[],faintTotalLabels=lines.filter(line=>receiptFaintTotalLabel(line,knownFuelY));
    for(const line of lines){const x=Number(line.x)||0,y=Number(line.y)||0,text=String(line.text||'').trim(),compact=text.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/UN[I1]/g,'UNLEADED'),letters=text.toUpperCase().replace(/[^A-Z]/g,'');const totalLabelContinuation=faintTotalLabels.some(label=>{const labelText=String(label.text||'').toUpperCase().replace(/[^A-Z]/g,'');return Math.abs(y-(Number(label.y)||0))<=42&&x>(Number(label.x)||0)&&x<(Number(label.x)||0)+220&&labelText.length>=2&&letters.length>=labelText.length&&letters.startsWith(labelText);});if(x>500||y<start||y>end||Math.abs(y-knownFuelY)<=22||totalLabelContinuation||!/\p{L}{3}/u.test(text)||ignored.test(text)||receiptTotalLabel(text)||receiptFaintTotalLabel(line,knownFuelY)||receiptFuelDescription(text)||/^(?:PUMP\d*|TOTALS?|MASTERCARD|VISA|CARD|SALE|PAYMENT|UNLEADED|DIESEL|PETROL|FUEL|PFS|POS\d*)/.test(compact))continue;
      const amounts=[];for(const candidate of lines){const lx=Number(candidate.x)||0,ly=Number(candidate.y)||0,dy=Math.abs(ly-y);if(dy>42||lx<x+150)continue;for(const token of receiptMoneyTokens(candidate.text)){const value=Number(token.value);if(Number.isFinite(value)&&Math.abs(value)>=0.01&&Math.abs(value)<=maximum)amounts.push(value);}}
      if(amounts.length)items.push({line,text,amounts:[...new Set(amounts.map(value=>Math.round(value*100)))].map(value=>value/100)});
    }
    return items;
  }
  function receiptHasOtherPurchase(lines,fuelY,totalY,maximum){return receiptOtherPurchases(lines,fuelY,totalY,maximum).length>0;}
  const maximumReceiptAmount=10000;
  function inferredReceiptSupplier(flat){
    const text=String(flat||'');if(/\b(?:TESCO|ESSO)\b|239\s*088\s*635|218\s*001\s*105/i.test(text))return {supplier:'Tesco',profileId:'tesco',category:'Fuel receipts'};
    if(/\b(?:MFG|MOTOR\s+FUEL|MOTORFUELGROUP)\b/i.test(text))return {supplier:'MFG',profileId:'mfg',category:'Fuel receipts'};
    if(/\b(?:SHELL|SHELL\s+UK)\b/i.test(text))return {supplier:'Shell',profileId:'shell',category:'Fuel receipts'};
    if(/\b(?:BP|LITTLE\s+HAMPTON)\b|663\s*139\s*630/i.test(text))return {supplier:'BP',profileId:'bp',category:'Fuel receipts'};
    return {supplier:'Unidentified forecourt',profileId:'unidentified-forecourt',category:'Fuel receipts'};
  }
  function parseReceiptPage(pageLines,source='',profileHint=''){
    const ordered=[...pageLines].sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)),text=ordered.map(line=>String(line.text||'')).join(' '),flat=text.replace(/\s+/g,' ').trim();let profile=receiptProfiles.find(item=>item.detect(flat))||receiptProfiles.find(item=>item.id===profileHint);if(!profile&&looksLikeUnidentifiedReceipt(ordered))profile=receiptProfiles.find(item=>item.id==='unidentified-forecourt');
    if(!profile)return null;
    // Receipt backs and marketing pages can repeat the retailer name. Only
    // treat a page as a receipt when its transaction area has money and date
    // evidence as well as a fuel/POS marker.
    const hasReceiptMarker=['eg-on-the-move','unidentified-forecourt'].includes(profile.id)||/\b(?:PUMP|UNLEADED|PETROL|FUEL|SALE|CASHSLIP|ARTICLE|AMOUNT|MASTERCARD|LITRE|LITER|P\/L|CARD\s+PAYMENT|TRANSACTION|RECEIPT\s+SUMMARY)\b/i.test(flat),hasMoney=ordered.some(line=>receiptMoneyTokens(line.text).length),dateValues=receiptDateValuesFromLines(ordered),hasTenderAmount=receiptTenderTotal(ordered,profile.category==='Vehicle expense receipts'?10000:200)!=='';
    const termsBack=['tesco','esso'].includes(profile.id)&&/thank you for using pay at pump/i.test(flat)&&!/\b(?:UNLEADED|LITRE|LITER|VAT\s+RECEIPT\s+SUMMARY|MASTERCARD|SALE)\b/i.test(flat);
    if(termsBack||!hasReceiptMarker||(!hasMoney&&!dateValues.length&&!hasTenderAmount&&!['eg-on-the-move','unidentified-forecourt'].includes(profile.id)&&!/\b(?:RECEIPT\s+SUMMARY|CUSTOMER\s+RECEIPT|CASHSLIP)\b/i.test(flat)))return null;
    const maximum=profile.category==='Vehicle expense receipts'?10000:200,anchorLines=ordered.filter(line=>profile.id==='mfg'?receiptMfgTotalLabel(line):receiptTotalLabel(line.text));
    const candidates=[];
    for(const anchor of anchorLines){
      const ax=Number(anchor.x)||0,ay=Number(anchor.y)||0;
      // Totals are printed beside their label on these receipts. A wide search
      // window can pick up pump volume/price rows or VAT tables instead.
      for(const line of ordered){const x=Number(line.x)||0,y=Number(line.y)||0,dy=Math.abs(y-ay);if(dy>50)continue;for(const token of receiptMoneyTokens(line.text)){const value=Math.abs(token.value);if(value<2||value>maximum)continue;if(line===anchor&&token.index<Math.max(0,String(anchor.text||'').search(/[\d\u00A3\u20AC$]/)))continue;if(x<ax-10&&dy<30)continue;candidates.push({value,score:dy+Math.max(0,ax-x)*0.02+(x<ax?35:0),anchorY:ay,anchorX:ax});}}
    }
    let total='';
    if(candidates.length){candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],sameBand=candidates.filter(item=>Math.abs(item.anchorY-best.anchorY)<1&&item.score<=best.score+8);const distinct=[...new Set(sameBand.map(item=>Math.round(item.value*100)))];if(distinct.length===1)total=best.value;}
    // Some Shell slips have a broken/missing TOTAL label in OCR. Use only the
    // printed amount column beneath its AMOUNT heading, never a VAT amount or
    // a reconstructed sum.
    if(total===''&&profile.id==='shell'){
      const headers=ordered.filter(line=>receiptLevenshtein(String(line.text||'').toUpperCase().replace(/[^A-Z]/g,''),'AMOUNT')<=1&&Number(line.x)>350),header=headers[0];
      if(header){const x=Number(header.x)||0,y=Number(header.y)||0,values=ordered.filter(line=>(Number(line.x)||0)>=x-20&&(Number(line.y)||0)>y+80&&(Number(line.y)||0)<y+500).flatMap(line=>receiptMoneyTokens(line.text).map(token=>({value:Math.abs(token.value),distance:(Number(line.y)||0)-y}))).filter(item=>item.value<=10000).sort((a,b)=>a.distance-b.distance);if(values.length)total=values[0].value;}
    }
    if(profile.id==='bp'){
      const labels=ordered.filter(line=>/^\s*AMOUNT\s*:?\s*$/i.test(String(line.text||'')));
      for(const label of labels){const x=Number(label.x)||0,y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=45&&(Number(line.x)||0)>=x+80).flatMap(line=>receiptMoneyTokens(line.text).map(token=>({value:Math.abs(token.value),score:Math.abs((Number(line.y)||0)-y)}))).filter(item=>item.value<=10000).sort((a,b)=>a.score-b.score);if(values.length){total=values[0].value;break;}}
    }
    // EG On The Move prints a small VAT summary at the foot of the receipt.
    // Read the printed gross value from the far-right cell on the row labelled
    // Totals; do not infer the total from the pump or net/VAT columns.
    if(total===''&&profile.id==='eg-on-the-move'){
      const labels=ordered.filter(line=>{const value=String(line.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I');return value.length>=4&&value.length<=7&&receiptLevenshtein(value,'TOTALS')<=2;});
      for(const label of labels){const y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=12&&(Number(line.x)||0)>=500).flatMap(line=>{const tokens=receiptMoneyTokens(line.text);if(tokens.length)return tokens.map(token=>Math.abs(token.value));const integer=String(line.text||'').match(/^\s*[£€]?\s*([\dOoIl]{1,4})\s*$/);if(!integer)return [];const value=invoiceAmount(integer[1].replace(/[Oo]/g,'0').replace(/[Il]/g,'1'));return value===null?[]:[Math.abs(value)];}).filter(value=>value>=2&&value<=200);if(values.length===1){total=values[0];break;}}
    }
    // MFG receipts repeat a fuel-only VAT table beneath the receipt total. Use
    // that printed gross only when there is exactly one VAT-summary footer and
    // no additional purchased item between the fuel row and the total. When a
    // shop item is present, its footer has separate totals and we leave the
    // receipt rejected if the actual receipt total is unreadable.
    if(total===''&&profile.id==='mfg'){
      const receiptTotal=ordered.find(line=>receiptTotalLabel(line.text)&&(Number(line.y)||0)>500&&(Number(line.y)||0)<1050),footerTotals=ordered.filter(line=>{const value=String(line.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I');return (value==='TOTALS'||receiptLevenshtein(value,'TOTALS')<=1)&&(Number(line.x)||0)<220&&(Number(line.y)||0)>(Number(receiptTotal?.y)||0)+40;});
      if(receiptTotal&&footerTotals.length===1){const fy=Number(footerTotals[0].y)||0,ty=Number(receiptTotal.y)||0,fuel=ordered.find(line=>/\b(?:UNLEADED|DIESEL)\b/i.test(String(line.text||''))&&(Number(line.y)||0)<ty),fuelY=Number(fuel?.y)||0,extraItem=ordered.some(line=>{const y=Number(line.y)||0,x=Number(line.x)||0,t=String(line.text||'').trim();return y>fuelY+35&&y<ty-10&&x<500&&/[A-Za-z]{3}/.test(t)&&!/^\s*(?:pump\s*\d*|sale|master ?card|visa|card|total|unleaded|diesel)\b/i.test(t);});const values=ordered.filter(line=>Math.abs((Number(line.y)||0)-fy)<=12&&(Number(line.x)||0)>=500).flatMap(line=>receiptMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=200);if(!extraItem&&values.length===1)total=values[0];}
    }
    if(total===''&&profile.id==='tesco'){
      const labels=ordered.filter(line=>/\bMASTERCARD\s+SALE\b/i.test(String(line.text||'')));
      for(const label of labels){const x=Number(label.x)||0,y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=40&&(Number(line.x)||0)>=x+220).flatMap(line=>receiptMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=200);if(values.length===1){total=values[0];break;}}
    }
    if(total===''&&profile.id==='tesco'){
      // Faded Tesco slips can reduce TOTAL to a fragment such as `AL`. Only
      // accept it below the fuel line when one printed amount aligns to it.
      const fuel=ordered.find(line=>receiptFuelDescription(line.text)),fuelY=Number(fuel?.y)||0,labels=ordered.filter(line=>receiptFaintTotalLabel(line,fuelY));
      for(const label of labels){const y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=30&&(Number(line.x)||0)>=400).flatMap(line=>receiptMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=200),unique=[...new Set(values.map(value=>Math.round(value*100)))];if(unique.length===1){total=unique[0]/100;break;}}
    }
    if(total===''&&profile.id==='tesco'){
      const fuelLines=ordered.filter(line=>/\b(?:PUMP|LITRE|LITER)\b/i.test(String(line.text||'')));
      for(const anchor of fuelLines){const x=Number(anchor.x)||0,y=Number(anchor.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=55&&(Number(line.x)||0)>=x+220).flatMap(line=>receiptMoneyTokens(line.text).map(token=>({value:Math.abs(token.value),score:Math.abs((Number(line.y)||0)-y)}))).filter(item=>item.value>=2&&item.value<=10000).sort((a,b)=>a.score-b.score);if(values.length){total=values[0].value;break;}}
    }
    const tenderTotal=receiptTenderTotal(ordered,maximum);if(tenderTotal!=='')total=tenderTotal;
    const filteredDates=[...new Set(dateValues)].sort(),date=filteredDates.length===1?filteredDates[0]:'';
    const fuelLine=ordered.find(line=>receiptFuelDescription(line.text)),fuelY=Number(fuelLine?.y)||0,totalLine=ordered.find(line=>receiptTotalLabel(line.text))||(profile.id==='tesco'?ordered.find(line=>receiptFaintTotalLabel(line,fuelY)):undefined),totalY=Number(totalLine?.y)||0,otherPurchases=receiptOtherPurchases(ordered,fuelY,totalY,maximum),hasTaxiDriver=/\bTAXI\s+DRIVER\b/i.test(flat);
    let breakdown=hasTaxiDriver?{fuelAmount:total===''?'':Number(total),drawingsAmount:''}:profile.id==='mfg'?mfgReceiptBreakdown(ordered,total):{fuelAmount:total===''?'':Number(total),drawingsAmount:''};
    if(!hasTaxiDriver&&otherPurchases.length){
      const mfgSplit=profile.id==='mfg'&&Number.isFinite(Number(breakdown.fuelAmount))&&breakdown.drawingsAmount!==''&&breakdown.drawingsAmount!==null&&breakdown.drawingsAmount!==undefined;
      if(!mfgSplit){
        const printedFuel=receiptFuelAmount(ordered,maximum),totalCents=total===''?null:Math.round(Number(total)*100),fuelCents=printedFuel===''?null:Math.round(printedFuel*100);
        if(totalCents!==null&&fuelCents!==null&&fuelCents>0&&fuelCents<totalCents){breakdown={fuelAmount:fuelCents/100,drawingsAmount:(totalCents-fuelCents)/100};}
        else if(totalCents!==null&&fuelCents===null){const itemCents=otherPurchases.map(item=>item.amounts.length===1?Math.round(item.amounts[0]*100):null);if(itemCents.every(Number.isInteger)){const drawingsCents=itemCents.reduce((sum,value)=>sum+value,0),remainder=totalCents-drawingsCents;if(drawingsCents>0&&remainder>0)breakdown={fuelAmount:remainder/100,drawingsAmount:drawingsCents/100};else breakdown={fuelAmount:'',drawingsAmount:''};}else breakdown={fuelAmount:'',drawingsAmount:''};}
      }
    }
    const plausibleTotal=total!==''&&Number.isFinite(Number(total))&&Number(total)>=2&&Number(total)<=maximum,fuelCents=Number.isFinite(Number(breakdown.fuelAmount))?Math.round(Number(breakdown.fuelAmount)*100):null,drawingsCents=breakdown.drawingsAmount===''||breakdown.drawingsAmount===null||breakdown.drawingsAmount===undefined?0:Number.isFinite(Number(breakdown.drawingsAmount))?Math.round(Number(breakdown.drawingsAmount)*100):null,totalCents=plausibleTotal?Math.round(Number(total)*100):null,splitComplete=totalCents!==null&&fuelCents!==null&&drawingsCents!==null&&fuelCents>=0&&drawingsCents>=0&&fuelCents+drawingsCents===totalCents&&(hasTaxiDriver||!otherPurchases.length||drawingsCents>0),accepted=Boolean(date&&plausibleTotal&&splitComplete),reason=accepted?'':!date?'Receipt date could not be confirmed from this page.':!plausibleTotal?'Printed receipt total is missing or outside the expected receipt range.':!splitComplete?'Fuel and other purchase amounts could not be separated confidently.':'Receipt values were ambiguous.';
    return {date,total,fuelAmount:breakdown.fuelAmount,drawingsAmount:breakdown.drawingsAmount,supplier:profile.name,profileId:profile.id,category:profile.category,source,page:Number(ordered[0]?.page)||1,status:accepted?'ACCEPTED':'REJECTED',accepted,rejected:!accepted,rejectedReason:reason};
  }
  function parseReceiptBatch(text,source='',ocrLines,options={}){
    const grouped=new Map();
    for(const line of Array.isArray(ocrLines)?ocrLines:[]){const page=Math.max(1,Number(line.page)||1);if(!grouped.has(page))grouped.set(page,[]);grouped.get(page).push(line);}
    let parsed=[];
    if(grouped.size)parsed=[...grouped.entries()].sort((a,b)=>a[0]-b[0]).map(([page,items])=>parseReceiptPage(items,source,options.profileHintByPage?.[page]||options.profileHint||'')).filter(Boolean);
    else{const flat=String(text||''),parts=flat.split(/\n\s*(?:PAGE\s*[:#-]?\s*\d+)\s*\n/ig);parsed=parts.map((part,index)=>{const lines=part.split(/\r?\n/).map(text=>({text,page:index+1,x:0,y:index*30,width:0,height:0}));return parseReceiptPage(lines,source);}).filter(Boolean);}
    if(!options.auditUnmatchedPages||!Number.isFinite(Number(options.pageCount)))return parsed;
    const byPage=new Map(parsed.map(row=>[Number(row.page)||1,row])),visual=new Set((options.visualPages||[]).map(Number));
    for(let page=1;page<=Number(options.pageCount);page++){
      if(byPage.has(page))continue;const lines=grouped.get(page)||[],flat=lines.map(line=>String(line.text||'')).join(' ').replace(/\s+/g,' ').trim(),hasVisibleContent=visual.has(page)||lines.some(line=>String(line.text||'').trim());
      if(!hasVisibleContent||isReceiptBackPage(lines))continue;
      const inferred=inferredReceiptSupplier(flat),row={date:'',total:'',fuelAmount:'',drawingsAmount:'',supplier:inferred.supplier,profileId:inferred.profileId,category:inferred.category,source,page,status:'REJECTED',accepted:false,rejected:true,auditPlaceholder:true,rejectedReason:'Receipt page could not be read confidently. Enter the date and total manually.'};
      parsed.push(row);byPage.set(page,row);
    }
    return parsed.sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function sortReceiptRowsByPdfPage(receipts,selectedSources=[]){
    const byPath=new Map(),byName=new Map();
    selectedSources.forEach((entry,index)=>{const source=typeof entry==='string'?{source:entry}:entry||{};if(source.sourcePath)byPath.set(String(source.sourcePath),index);if(source.source)byName.set(String(source.source),index);});
    return (receipts||[]).map((row,index)=>({row,index,order:byPath.get(String(row.sourcePath||''))??byName.get(String(row.source||''))??Number.MAX_SAFE_INTEGER,page:Number(row.page)||0})).sort((a,b)=>a.order-b.order||a.page-b.page||a.index-b.index).map(item=>item.row);
  }
  function isLibertyFrozenFoodsText(value){
    const text=String(value||'');
    // On scanned copies Windows OCR sometimes drops the first stroke of the
    // Liberty logo and reads "LIBERTY" as "IBERTY". If that header is lost
    // entirely, the registered VAT/company number plus a MAP invoice number
    // still identifies this supplier without relying on a filename.
    return /\b(?:LIBERTY|IBERTY)\s+(?:FROZEN\s+)?FOODS?\b/i.test(text)||
      /\bLIBERTYFOODS\.CO\.UK\b/i.test(text)||
      (/\b(?:383\s*5525\s*77|13440899)\b/i.test(text)&&/\bMAP\s*-\s*\d{6}\s*-\s*\d+\b/i.test(text));
  }
  function libertyMoneyValues(value){
    const matches=String(value||'').match(/(?<![\d/])(?:\d{1,3}(?:[ ,]\d{3})+|\d+)[.,]\d{2}(?!\d)/g)||[];
    return [...new Set(matches.map(token=>invoiceAmount(token)).filter(number=>number!==null&&number>=0))];
  }
  function libertyPositionedValue(lines,labelPattern,{maxDistance=85}={}){
    const anchors=lines.filter(line=>/\b(?:this\s+bill|amount\s+due)\b/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)),summaryY=anchors.length?Number(anchors[0].y)||0:null;
    const labels=lines.filter(line=>labelPattern.test(String(line.text||''))&&(summaryY===null||Math.abs((Number(line.y)||0)-summaryY)<=600)),values=[];
    for(const label of labels){
      const lx=Number(label.x)||0,ly=Number(label.y)||0,valueStartX=lx+Math.max(24,Math.min(Number(label.width)||0,75));
      for(const value of libertyMoneyValues(label.text))values.push({value,distance:0});
      for(const line of lines){
        const x=Number(line.x)||0,y=Number(line.y)||0;
        if(x<valueStartX||Math.abs(y-ly)>maxDistance)continue;
        for(const value of libertyMoneyValues(line.text))values.push({value,distance:Math.abs(y-ly)});
      }
    }
    if(!values.length)return {value:null,ambiguous:false};
    const nearest=values.reduce((best,item)=>Math.min(best,item.distance),Infinity),nearestValues=[...new Set(values.filter(item=>item.distance<=nearest+8).map(item=>item.value))];
    return nearestValues.length===1?{value:nearestValues[0],ambiguous:false}:{value:null,ambiguous:true};
  }
  function libertyDateValue(lines,text){
    const monthNames={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'},toDate=value=>{const match=String(value||'').match(/\b(\d{1,2})[-/. ]([A-Za-z]{3})[-/. ](\d{2,4})\b/);if(!match)return '';const month=monthNames[match[2].slice(0,3).toLowerCase()],year=Number(match[3])<100?2000+Number(match[3]):Number(match[3]);return month?parseDate(`${match[1]}/${month}/${year}`):'';};
    const orderLabel=lines.filter(line=>/\border\s+date\b/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    if(orderLabel){const inline=toDate(String(orderLabel.text||'').replace(/^.*?\border\s+date\b/i,''));if(inline)return inline;const x=Number(orderLabel.x)||0,y=Number(orderLabel.y)||0,valueX=x+Math.max(24,Math.min(Number(orderLabel.width)||0,100)),nearby=lines.filter(line=>Number(line.page)===Number(orderLabel.page)&&Number(line.x)>valueX&&Math.abs((Number(line.y)||0)-y)<=32).map(line=>({date:toDate(line.text),distance:Math.abs((Number(line.y)||0)-y)})).filter(item=>item.date).sort((a,b)=>a.distance-b.distance)[0];if(nearby)return nearby.date;}
    const positioned=lines.filter(line=>!/\bdelivery\s+date\b/i.test(String(line.text||''))).map(line=>({date:toDate(line.text),y:Number(line.y)||0})).filter(item=>item.date).sort((a,b)=>a.y-b.y);
    return positioned[0]?.date||(()=>{const match=String(text||'').match(/\border\s+date\b[\s\S]{0,100}?(\d{1,2}[-/. ][A-Za-z]{3}[-/. ]\d{2,4})/i);return toDate(match?.[1]||'');})();
  }
  function parseLibertyFrozenFoodsInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],text=String(flat||'').replace(/\s+/g,' ');
    const reference=text.match(/\b(MAP\s*-\s*\d{6}\s*-\s*\d+)\b/i)?.[1]?.replace(/\s+/g,'').toUpperCase()||'';
    const date=libertyDateValue(lines,text);
    const isInvoiceDocument=Boolean(reference||(/\binvoice\s+no\.?\b/i.test(text)&&date&&/\bMAP\b/i.test(text)&&isLibertyFrozenFoodsText(text)));
    const invoiceTotal=libertyPositionedValue(lines,/\binvoice\s+tot[a-z]{0,2}\b/i,{maxDistance:95}),thisBill=libertyPositionedValue(lines,/\bthis\s+bill\b/i,{maxDistance:45}),netValue=libertyPositionedValue(lines,/\bnet\s+va[a-z]{0,3}\b/i,{maxDistance:70});
    let total=invoiceTotal.value??thisBill.value??netValue.value??null,rejectedReason='',retryOcr=false;
    const observed=[invoiceTotal.value,thisBill.value,netValue.value].filter(value=>value!==null);
    if(invoiceTotal.ambiguous||thisBill.ambiguous||netValue.ambiguous||new Set(observed).size>1){
      total=null;retryOcr=true;rejectedReason='Printed invoice total and current bill values do not agree; possible handwritten amendment needs manual checking.';
    }else if(total===null){retryOcr=true;rejectedReason='The printed invoice total is incomplete or unreadable; manual checking is required.';}
    if(!date)rejectedReason=rejectedReason||'Order date was not readable on the invoice.';
    return {invoiceNumber:reference,originalInvoiceNumber:reference,date,supplier:'Liberty Frozen Foods Ltd',subtotal:'',vat:0,total:total===null?'':total,documentType:'INVOICE',isInvoiceDocument,currency:'GBP',source,accepted:false,rejected:true,status:'REJECTED',rejectedReason,retryOcr,review:false,layoutId:'liberty-frozen-foods-current-total',profileId:'liberty-frozen-foods'};
  }
  function isBestwayText(value){return /\bBESTWAY\b/i.test(String(value||''));}
  function bestwayMoneyValues(value){
    let text=String(value||'').trim().replace(/[Â££$€]/g,'').replace(/^[Ee]\s*/,'').replace(/^[lI|](?=\s*[,\d.])/,'1').replace(/[Oo]/g,'0').replace(/\s+(?=,)/g,'');
    const matches=text.match(/-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)[.,]\s*\d{2}/g)||[];
    return matches.map(token=>invoiceAmount(token)).filter(number=>number!==null&&number>=0);
  }
  function bestwayAdjacentText(lines,label,{maxY=34,minGap=12}={}){
    if(!label)return '';
    const text=String(label.text||''),page=Number(label.page)||1,y=Number(label.y)||0,x=(Number(label.x)||0)+(Number(label.width)||0),inline=text.replace(/^[\s\S]*?\b(?:invoice\s+no\.?|date\s*(?:I|\/)?\s*time|total\s*:?)\b/i,'').trim();
    if(/\d/.test(inline))return inline;
    const candidates=(lines||[]).filter(line=>(Number(line.page)||1)===page&&Math.abs((Number(line.y)||0)-y)<=maxY&&(Number(line.x)||0)>=x+minGap).sort((a,b)=>Math.abs((Number(a.y)||0)-y)-Math.abs((Number(b.y)||0)-y)||(Number(a.x)||0)-(Number(b.x)||0));
    return String(candidates[0]?.text||'').trim();
  }
  function bestwayHeader(lines){
    const top=(lines||[]).filter(line=>line&&String(line.text||'').trim()).slice().sort((a,b)=>(Number(a.page)||1)-(Number(b.page)||1)||(Number(a.y)||0)-(Number(b.y)||0)),label=(pattern)=>top.find(line=>pattern.test(String(line.text||'')));
    const numberLabel=label(/\binvoice\s+no\.?\b/i),dateLabel=label(/\bdate\s*(?:I|\/)?\s*time\b/i),totalLabel=label(/^\s*total\s*:/i);
    const rawNumber=bestwayAdjacentText(top,numberLabel),numberText=String(rawNumber||'').toUpperCase().replace(/[OQ]/g,'0').replace(/[IL|]/g,'1').replace(/[\s-]/g,''),numberMatch=numberText.match(/\d{9}/),fullNumber=numberMatch?.[0]||'';
    const rawDate=bestwayAdjacentText(top,dateLabel),dateMatch=String(rawDate||'').match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/),date=dateMatch?parseDate(dateMatch[0]):'';
    const rawTotal=bestwayAdjacentText(top,totalLabel),total=bestwayMoneyValues(rawTotal)[0]??null;
    return {fullNumber,invoiceNumber:fullNumber.slice(-4),date,total};
  }
  function bestwayPageSequence(lines){
    const items=(lines||[]).filter(line=>line&&String(line.text||'').trim()),anchors=items.filter(line=>/\binvoice\s+no\.?\b|\bdate\s*(?:I|\/)?\s*time\b/i.test(String(line.text||'')));
    const sequences=items.map(line=>({line,match:String(line.text||'').match(/([1Il])\s*(?:of|0f|[oO]f)\s*([1-9])/i)||String(line.text||'').match(/([1-9])\s*0[fF]\s*([1-9])/)})).filter(item=>item.match);
    if(!sequences.length)return {page:0,count:0};
    // The printed sequence is part of the invoice header. Anchor it to nearby
    // invoice/date labels rather than assuming the header occupies a fixed y band.
    const selected=sequences.sort((a,b)=>{
      const distance=item=>anchors.length?Math.min(...anchors.filter(anchor=>(Number(anchor.page)||1)===(Number(item.line.page)||1)).map(anchor=>Math.abs((Number(anchor.y)||0)-(Number(item.line.y)||0)))):0;
      return distance(a)-distance(b)||(Number(a.line.y)||0)-(Number(b.line.y)||0);
    })[0],match=selected.match;
    const page=Number(String(match[1]).replace(/[Il]/gi,'1'))||0;
    return {page,count:Number(match[2])||0};
  }
  function bestwayPositionedValue(lines,labelPattern,{minY=-Infinity,maxY=Infinity,rowTolerance=30,minGap=8}={}){
    const labels=(lines||[]).filter(line=>{const y=Number(line.y)||0;return y>=minY&&y<=maxY&&labelPattern.test(String(line.text||''));}).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){
      const text=String(label.text||''),match=text.match(labelPattern),inline=match?text.slice(match.index+match[0].length):text;
      const inlineValues=bestwayMoneyValues(inline);if(inlineValues.length===1)return {value:inlineValues[0],ambiguous:false};if(inlineValues.length>1)return {value:null,ambiguous:true};
      const page=Number(label.page)||1,y=Number(label.y)||0,right=(Number(label.x)||0)+(Number(label.width)||0),near=(lines||[]).filter(line=>(Number(line.page)||1)===page&&Math.abs((Number(line.y)||0)-y)<=rowTolerance&&(Number(line.x)||0)>=right+minGap).sort((a,b)=>Math.abs((Number(a.y)||0)-y)-Math.abs((Number(b.y)||0)-y));
      const values=[];for(const line of near)for(const value of bestwayMoneyValues(line.text))values.push({value,distance:Math.abs((Number(line.y)||0)-y)});
      if(values.length){const nearest=Math.min(...values.map(item=>item.distance)),distinct=[...new Set(values.filter(item=>item.distance<=nearest+4).map(item=>item.value))];return distinct.length===1?{value:distinct[0],ambiguous:false}:{value:null,ambiguous:true};}
    }
    return {value:null,ambiguous:false};
  }
  function bestwaySummary(lines){
    const pages=[...new Set((lines||[]).map(line=>Number(line.page)||1))].sort((a,b)=>b-a);
    for(const page of pages){
      const pageLines=(lines||[]).filter(line=>(Number(line.page)||1)===page),summary=pageLines.filter(line=>/\binvoice\s+summary\b/i.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0))[0];
      if(!summary)continue;
      const start=(Number(summary.y)||0)+Math.max(1,Number(summary.height)||1),totalDueLabels=pageLines.filter(line=>{
        const text=String(line.text||'');
        return (Number(line.y)||0)>=start&&/\btotal\s+due\b/i.test(text)&&/\b(?:inc|incl|lnc|in[cg]l?)\s*VAT\b/i.test(text);
      }).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
      const totalDue=totalDueLabels[0];
      if(!totalDue)continue;
      const total=bestwayPositionedValue(pageLines,/\btotal\s+due\b.*\b(?:inc|incl|lnc|in[cg]l?)\s*VAT\b/i,{minY:start,maxY:Number(totalDue.y)||Infinity,rowTolerance:Math.max(30,Number(totalDue.height)||0)});
      // Use the printed summary labels and their order instead of page-wide
      // coordinate assumptions: VAT is the last VAT row before Total Due.
      const vatLabels=pageLines.filter(line=>{
        const y=Number(line.y)||0,text=String(line.text||'');
        return y>=start&&y<(Number(totalDue.y)||Infinity)&&/^\s*VAT(?:\s+(?:amount|value))?\s*:?\s*(?:[£$€Ee]?\s*[\d., ]*)?$/i.test(text);
      }).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0));
      const vatLabel=vatLabels[0],vat=vatLabel?bestwayPositionedValue(pageLines,/^\s*VAT(?:\s+(?:amount|value))?\s*:?/i,{minY:Number(vatLabel.y)||start,maxY:Number(vatLabel.y)||start,rowTolerance:Math.max(30,Number(vatLabel.height)||0)}):{value:null,ambiguous:false};
      if(vat.value!==null||total.value!==null)return {page,vat,total};
    }
    return {page:0,vat:{value:null,ambiguous:false},total:{value:null,ambiguous:false}};
  }
  function parseBestwayInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],header=bestwayHeader(lines),text=String(flat||'');
    let fullNumber=header.fullNumber,date=header.date;
    if(!fullNumber){const match=text.match(/\binvoice\s+no\.?\s*[:#]?\s*([0-9OQIL|\s-]{8,})/i);if(match){const digits=match[1].toUpperCase().replace(/[OQ]/g,'0').replace(/[IL|]/g,'1').replace(/\D/g,'');if(digits.length===9)fullNumber=digits;}}
    if(!date){const match=text.match(/\bdate\s*(?:I|\/)?\s*time\b[\s:.-]{0,20}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i);if(match)date=parseDate(match[1]);}
    const summary=bestwaySummary(lines),vat=summary.vat.value,total=summary.total.value,complete=Boolean(fullNumber&&date&&vat!==null&&total!==null),rejectedReason=complete?'':!fullNumber?'Bestway invoice number could not be confirmed.':!date?'Bestway invoice date could not be confirmed.':total===null?'The printed Total due in the Bestway Invoice Summary could not be confirmed.':'The printed VAT in the Bestway Invoice Summary could not be confirmed.';
    return {invoiceNumber:fullNumber.slice(-4),originalInvoiceNumber:fullNumber,date,supplier:'Bestway Wholesale',subtotal:'',vat:vat??'',total:total??'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete,review:false,layoutId:'bestway-invoice-summary',profileId:'bestway'};
  }
  function isFreshwaysText(value){
    const text=String(value||'');
    return /\bFRESHWAYS\b/i.test(text)&&(/\bNIJJAR?\s+DAIR(?:IES|Y)\b/i.test(text)||/629[\s-]*1934[\s-]*20/.test(text))||/629[\s-]*1934[\s-]*20/.test(text);
  }
  function freshwaysHeaderPresent(lines){
    const text=(Array.isArray(lines)?lines:[]).map(line=>String(line.text||''));
    return text.some(value=>/^\s*INVOICE\s*$/i.test(value))&&text.some(value=>/\binvoice\s*(?:no\.?|number|#)\b/i.test(value))&&text.some(value=>/\binvoice\s+date\b/i.test(value));
  }
  function freshwaysLabeledRaw(lines,labelPattern,{minY=-Infinity,maxY=Infinity,preferLastPage=false,rowTolerance=28,rightGap=24}={}){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),labels=items.filter(line=>{const y=Number(line.y)||0;return y>=minY&&y<=maxY&&labelPattern.test(String(line.text||''));}).sort((a,b)=>preferLastPage?(Number(b.page)||1)-(Number(a.page)||1)||(Number(a.y)||0)-(Number(b.y)||0):(Number(a.page)||1)-(Number(b.page)||1)||(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){
      const text=String(label.text||''),match=text.match(labelPattern),inline=match?text.slice(match.index+match[0].length).replace(/^\s*[:#-]?\s*/,'').trim():'';
      if(inline)return inline;
      const page=Number(label.page)||1,y=Number(label.y)||0,x=Number(label.x)||0,candidates=items.filter(line=>(Number(line.page)||1)===page&&Math.abs((Number(line.y)||0)-y)<=rowTolerance&&(Number(line.x)||0)>=x+rightGap).sort((a,b)=>Math.abs((Number(a.y)||0)-y)-Math.abs((Number(b.y)||0)-y)||(Number(a.x)||0)-(Number(b.x)||0));
      if(candidates.length)return String(candidates[0].text||'').trim();
    }
    return '';
  }
  function freshwaysMoney(value){
    let text=String(value||'').trim().replace(/[£$€]/g,'').replace(/^E\s*(?=[0-9Oo])/i,'').replace(/[Oo]/g,'0').replace(/[Il](?=\d|[.,])/g,'1').replace(/\s+/g,' ');
    const match=text.match(/-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)[.,]\s*\d{2}/);return match?invoiceAmount(match[0]):null;
  }
  function freshwaysVatMoney(value){
    const raw=String(value||'').trim();
    // The first VAT character is the printed pound sign. Windows OCR can
    // render £0.00 as 20.00, so ignore that character before parsing VAT.
    return raw?freshwaysMoney(raw.slice(1)):null;
  }
  function freshwaysInvoiceNumber(value){
    const text=String(value||'').toUpperCase().replace(/[O]/g,'0').replace(/[IL]/g,'1'),match=text.match(/\b([A-Z]{0,2}\s*-?\s*\d{5,})\b/),full=match?.[1].replace(/\s+/g,'').replace(/-/g,'')||'',digits=full.replace(/\D/g,'');
    return digits.length>=4?{full,short:digits.slice(-4)}:{full:'',short:''};
  }
  function freshwaysInvoiceDate(value){
    const text=String(value||'').trim().replace(/\b([0-9])\s+([A-Za-z]{3,9})\s+(20\d{2})\b/,'$1 $2 $3');
    const match=text.match(/\b(?:\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|20\d{2}[/. -]\d{1,2}[/. -]\d{1,2})\b/i);return parseDate(match?.[0]||'');
  }
  function parseFreshwaysInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[];
    const footerPages=[...new Set(lines.filter(line=>/\binvoice\s+total\b/i.test(String(line.text||''))).map(line=>Number(line.page)||1))].sort((a,b)=>a-b),footerPage=footerPages.at(-1),footerLines=footerPage?lines.filter(line=>(Number(line.page)||1)===footerPage):lines;
    const rawNumber=freshwaysLabeledRaw(lines,/\binvoice\s*(?:no\.?|number|#)\s*:?[\s]*/i),number=freshwaysInvoiceNumber(rawNumber),dateRaw=freshwaysLabeledRaw(lines,/\binvoice\s+date\s*:?[\s]*/i),date=freshwaysInvoiceDate(dateRaw);
    const invoiceLabel=footerLines.filter(line=>/\bInvoice\s*:/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    const invoiceTotalLabel=footerLines.filter(line=>/\bInvoice\s+Total\s*:?/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    // Freshways pages also contain a VAT column heading and account balance
    // rows. Only trust a VAT value labelled between the invoice footer and
    // the printed Invoice Total; otherwise a nearby 20.00 balance/rate can be
    // mistaken for invoice VAT on OCR variants.
    const vatMinY=Number(invoiceLabel?.y),vatMaxY=Number(invoiceTotalLabel?.y),hasFooterBounds=Number.isFinite(vatMinY)&&Number.isFinite(vatMaxY)&&vatMaxY>vatMinY;
    // Never search the whole page for VAT: OCR can mistake a VAT column/rate
    // or an unrelated number near the bottom-left of the page for the footer
    // amount. Require either the known Invoice: → Invoice Total footer band,
    // or (if the first footer label was missed) a VAT label immediately above
    // Invoice Total in the right-hand totals area.
    let vatRaw='',vat=null;
    if(hasFooterBounds){vatRaw=freshwaysLabeledRaw(footerLines,/\bVAT\s*:?[\s]*/i,{minY:vatMinY,maxY:vatMaxY});vat=freshwaysVatMoney(vatRaw);}
    else if(invoiceTotalLabel){
      const totalY=Number(invoiceTotalLabel.y)||0,totalX=Number(invoiceTotalLabel.x)||0,footerVatLines=footerLines.filter(line=>{
        const y=Number(line.y)||0,x=Number(line.x)||0;
        return y>=totalY-180&&y<=totalY&&x>=Math.max(0,totalX-700);
      });
      vatRaw=freshwaysLabeledRaw(footerVatLines,/\bVAT\s*:?[\s]*/i,{minY:totalY-180,maxY:totalY});vat=freshwaysVatMoney(vatRaw);
    }
    // If OCR misses the VAT label, only consider the printed value in the
    // rows immediately following the invoice footer label.
    if(vat===null&&invoiceLabel){const baseY=Number(invoiceLabel.y)||0,maxY=hasFooterBounds?vatMaxY:baseY+85,page=Number(invoiceLabel.page)||1,valueX=Number(invoiceLabel.x)+(Number(invoiceLabel.width)||120)+8,candidates=footerLines.filter(line=>(Number(line.page)||1)===page&&(Number(line.x)||0)>=valueX&&(Number(line.y)||0)>=baseY+30&&(Number(line.y)||0)<=maxY).sort((a,b)=>Math.abs((Number(a.y)||0)-(baseY+56))-Math.abs((Number(b.y)||0)-(baseY+56)));vat=freshwaysVatMoney(candidates[0]?.text);vatRaw=vat===null?'':candidates[0]?.text||'';}
    let totalRaw=freshwaysLabeledRaw(footerLines,/\bInvoice\s+Total\s*:?[\s]*/i),total=freshwaysMoney(totalRaw);
    if(total===null&&invoiceLabel){const baseY=Number(invoiceLabel.y)||0,page=Number(invoiceLabel.page)||1,valueX=Number(invoiceLabel.x)+(Number(invoiceLabel.width)||120)+8,candidates=footerLines.filter(line=>(Number(line.page)||1)===page&&(Number(line.x)||0)>=valueX&&(Number(line.y)||0)>=baseY+95&&(Number(line.y)||0)<=baseY+150).sort((a,b)=>Math.abs((Number(a.y)||0)-(baseY+120))-Math.abs((Number(b.y)||0)-(baseY+120)));total=freshwaysMoney(candidates[0]?.text);totalRaw=total===null?'':candidates[0]?.text||'';}
    // On some Windows OCR builds the printed pound sign before £0.00 is read
    // as a digit 2, producing the text "20.00". Do not post that as VAT; ask
    // the existing 5x retry to confirm the footer value instead.
    const vatCurrencyGlyphSuspect=vat===20&&/^2(?:0|O)[.,]0{2}$/i.test(String(vatRaw||'').replace(/\s+/g,'')),confirmedVat=vatCurrencyGlyphSuspect?null:vat;
    const complete=Boolean(number.short&&date&&confirmedVat!==null&&total!==null),rejectedReason=complete?'':!number.short?'Freshways invoice number could not be confirmed.':!date?'Freshways invoice date could not be confirmed.':total===null?'Printed Freshways Invoice Total could not be confirmed.':vatCurrencyGlyphSuspect?'Freshways VAT may have the pound sign misread as a digit; a 5x OCR confirmation is required.':'Printed Freshways VAT could not be confirmed.';
    return {invoiceNumber:number.short,originalInvoiceNumber:number.full,date,supplier:'Freshways',subtotal:'',vat:confirmedVat??'',total:total??'',documentType:'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',rejectedReason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:!complete||vatCurrencyGlyphSuspect,review:false,layoutId:'freshways-invoice-footer',profileId:'freshways',freshwaysVatOcrAmbiguous:vatCurrencyGlyphSuspect};
  }
  function isaacInvoiceNumber(value){
    const text=String(value||'').toUpperCase().replace(/[OQ]/g,'0').replace(/[IL|]/g,'1');
    const match=text.match(/(?:^|[-/\s])([0-9]{3,})\s*$/);
    return match?match[1]:'';
  }
  function isaacInvoiceDate(value){
    const text=String(value||'').toUpperCase().replace(/\b0CT\b/g,'OCT').replace(/\b5EP\b/g,'SEP');
    const monthDate=text.match(/([0-9OQIL|](?:\s*[0-9OQIL|])?)\s*[-/.]\s*([A-Z0-9]{3})\s*[-/.]\s*(20\d{2})/);
    if(monthDate){
      const day=monthDate[1].replace(/\s/g,'').replace(/[OQ]/g,'0').replace(/[IL|]/g,'1'),months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12},month=months[monthDate[2]];
      if(month)return parseDate(`${day}/${month}/${monthDate[3]}`);
    }
    const numeric=text.match(/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d{2}\b/);
    return parseDate(numeric?.[0]||'');
  }
  function isaacMoney(value){
    const match=String(value||'').replace(/[\u00A3$]/g,' ').match(/\(?-?\d[\d,\s]*[.,]\s*\d{2}\)?/);
    return match?invoiceAmount(match[0]):null;
  }
  function isaacLabeledValue(lines,labelPattern,parseValue,kind='row'){
    const items=Array.isArray(lines)?lines.filter(line=>line&&String(line.text||'').trim()):[],matches=items.filter(line=>labelPattern.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of matches){
      const labelText=String(label.text||''),labelMatch=labelText.match(labelPattern),inline=labelMatch?labelText.slice((labelMatch.index||0)+labelMatch[0].length).replace(/^\s*[:#.-]?\s*/,''):'';
      const direct=parseValue(inline);if(direct!==null&&direct!==undefined&&direct!=='')return direct;
      const labelX=Number(label.x)||0,labelY=Number(label.y)||0,labelHeight=Math.max(1,Number(label.height)||20),labelWidth=Math.max(String(labelText).length*8,Number(label.width)||0),samePage=items.filter(line=>line!==label&&(line.page===undefined||label.page===undefined||Number(line.page)===Number(label.page)));
      const candidates=[];
      for(const line of samePage){
        const value=parseValue(line.text);if(value===null||value===undefined||value==='')continue;
        const x=Number(line.x)||0,y=Number(line.y)||0,height=Math.max(1,Number(line.height)||labelHeight),delta=y-labelY;
        // Account balance is a separate statement figure and must never be
        // eligible as an invoice total, even when OCR places it unusually
        // close to the invoice footer.
        if(kind==='row'&&samePage.some(other=>/\baccount\s+balance\b/i.test(String(other.text||''))&&Math.abs(y-(Number(other.y)||0))<=Math.max(8,height*.8)&&x>(Number(other.x)||0)+(Number(other.width)||String(other.text||'').length*8)*.35))continue;
        if(kind==='below'){
          if(delta<labelHeight*.35||delta>labelHeight*4.5||x<labelX-labelHeight*2.5||x>labelX+labelWidth+labelHeight*12)continue;
        }else{
          if(Math.abs(delta)>Math.max(42,labelHeight*1.8)||x<labelX+labelWidth*.35)continue;
        }
        const horizontalGap=Math.max(0,x-(labelX+labelWidth));
        candidates.push({value,score:Math.abs(delta)/labelHeight+horizontalGap/(labelHeight*2)});
      }
      candidates.sort((a,b)=>a.score-b.score);if(candidates.length)return candidates[0].value;
    }
    return null;
  }
  function isaacInvoicePageText(value){
    const text=String(value||'');
    return isIsaacWholesaleText(text)&&/\bsales\s+invoice\b/i.test(text)&&/\binvoice\s+to\b/i.test(text)&&(/\binvoice\s+(?:no\.?|number|#)\b/i.test(text)||/\binvoice\s+date\b/i.test(text));
  }
  function isaacHeader(lines,flat=''){
    const source=String(flat||lines?.map(line=>String(line.text||'')).join(' ')||'');
    const number=isaacLabeledValue(lines,/\binvoice\s*(?:no\.?|number|#)\b/i,isaacInvoiceNumber,'below')||isaacInvoiceNumber(source.match(/\binvoice\s*(?:no\.?|number|#)\b\s*[:#.-]?\s*([A-Z0-9| -]{3,}?)(?=\s+invoice\s+date|\s+ship\s+route|$)/i)?.[1]||'');
    const date=isaacLabeledValue(lines,/\binvoice\s+date\b/i,isaacInvoiceDate,'below')||isaacInvoiceDate(source.match(/\binvoice\s+date\b\s*[:#.-]?\s*([0-9OQIL|\s/-]{1,8}\s*[-/.]\s*[A-Z0-9]{3}\s*[-/.]\s*20\d{2}|\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d{2})/i)?.[1]||'');
    return {fullNumber:number,date};
  }
  function isaacInvoicePage(lines){
    const text=(lines||[]).map(line=>String(line.text||'')).join(' ');
    return isaacInvoicePageText(text);
  }
  function isaacSummaryPage(lines){
    const text=(lines||[]).map(line=>String(line.text||'')).join(' ');
    return /\b(?:invoice|account|sales)\s+summary\b|\bstatement\s+of\s+account\b|\bTOTAL\s+DELTA[- ]ARA\b/i.test(text)||/\bINVOICE\s+[1-4]\s*:/i.test(text)&&/\bSOLD\b.*\bBALANCE\b/i.test(text);
  }
  function parseIsaacWholesaleInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],pages=[...new Set(lines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),pageGroups=new Map(pages.map(page=>[page,lines.filter(line=>(Number(line.page)||1)===page)])),invoicePage=pages.find(page=>isaacInvoicePage(pageGroups.get(page)||[])),headerLines=invoicePage?pageGroups.get(invoicePage):lines,header=isaacHeader(headerLines,flat),number=header.fullNumber.slice(-4),date=header.date;
    let total=null,vat=null;
    for(const page of [...pages].reverse()){
      const pageLines=pageGroups.get(page)||[];
      if(total===null)total=isaacLabeledValue(pageLines,/\binvoice\s+total\b/i,isaacMoney,'row');
      if(vat===null)vat=isaacLabeledValue(pageLines,/\bVAT\s+total\b/i,isaacMoney,'row');
    }
    if(!lines.length){
      const inlineTotal=String(flat||'').match(/\binvoice\s+total\s*:?\s*[\u00A3$]?\s*(\d[\d,\s]*[.,]\s*\d{2})/i),inlineVat=String(flat||'').match(/\bVAT\s+total\s*:?\s*[\u00A3$]?\s*(\d[\d,\s]*[.,]\s*\d{2})/i);
      total=inlineTotal?isaacMoney(inlineTotal[1]):null;vat=inlineVat?isaacMoney(inlineVat[1]):null;
    }
    const invoiceDocument=isaacInvoicePageText(String(flat||lines.map(line=>String(line.text||'')).join(' '))),complete=Boolean(invoiceDocument&&number&&date&&total!==null&&vat!==null),reason=complete?'':!invoiceDocument?'This document does not appear to be an Isaac Wholesale invoice.':!number?'Isaac Wholesale invoice number could not be confirmed.':!date?'Isaac Wholesale invoice date could not be confirmed.':total===null?'Printed Isaac Wholesale Invoice Total could not be confirmed.':'Printed Isaac Wholesale VAT Total could not be confirmed.';
    return {invoiceNumber:number,originalInvoiceNumber:header.fullNumber,date,supplier:'Isaac Wholesale Ltd',subtotal:'',vat:vat??'',total:total??'',documentType:'INVOICE',isInvoiceDocument:invoiceDocument,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr:Boolean(invoiceDocument&&(!complete||!lines.length)),review:false,layoutId:'isaac-wholesale-invoice-total',profileId:'isaac-wholesale'};
  }
  function parseIsaacWholesaleBatch(pageLines,source){
    const pages=[...new Set(pageLines.keys())].sort((a,b)=>a-b),isaacPages=pages.filter(page=>isIsaacWholesaleText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))),groups=[];
    for(const page of isaacPages){
      const lines=pageLines.get(page)||[],flat=lines.map(line=>String(line.text||'')).join(' '),header=isaacHeader(lines,flat),starts=isaacInvoicePage(lines);
      if(isaacSummaryPage(lines))continue;
      if(starts){
        const previous=groups.at(-1);
        if(previous&&(header.fullNumber&&previous.fullNumber===header.fullNumber||!header.fullNumber&&(previous.date&&header.date===previous.date||/\bcontinued\b/i.test(flat)))){previous.pages.push(page);continue;}
        groups.push({page,fullNumber:header.fullNumber,date:header.date,pages:[page]});
      }else if(groups.length&&(/\bcontinued\b/i.test(flat)||header.fullNumber&&groups.at(-1).fullNumber===header.fullNumber))groups.at(-1).pages.push(page);
      else if(groups.length&&/\b(?:product|quantity|unit\s+price|tax\s+rate)\b/i.test(flat))groups.at(-1).pages.push(page);
    }
    return groups.map(group=>{
      const groupedLines=group.pages.flatMap(page=>pageLines.get(page)||[]),text=groupedLines.map(line=>String(line.text||'')).join(' '),row=parseIsaacWholesaleInvoice(text,source,groupedLines);
      return {...row,page:group.page,sourcePages:group.pages};
    });
  }
  // Keep supplier/document-specific parsing isolated here. Detection uses
  // document content, never just the file name, because users often rename
  // statements and batch PDFs from several suppliers together.
  const invoiceProfiles=[
    {id:'freshways',name:'Freshways',kind:'supplier',detect:isFreshwaysText,parse:(flat,source,lines)=>parseFreshwaysInvoice(flat,source,lines)},
    {id:'bestway',name:'Bestway Wholesale',kind:'supplier',detect:isBestwayText,parse:(flat,source,lines)=>parseBestwayInvoice(flat,source,lines)},
    {id:'eagle-foods',name:'Eagle Foods Ltd',kind:'supplier',status:'Under development',detect:isEagleFoodsText,parse:(flat,source,lines)=>parseEagleFoodsInvoice(flat,source,lines)},
    {id:'shahid-halal-poultry',name:'Shahid Halal Poultry',kind:'supplier',detect:isShahidHalalText,parse:(flat,source,lines)=>parseShahidHalalInvoice(flat,source,lines)},
    {id:'marion-trading',name:'Marion Trading',kind:'supplier',detect:isMarionTradingText,parse:(flat,source,lines)=>parseMarionInvoice(flat,source,lines)},
    {id:'monolith',name:'Monolith',kind:'supplier',detect:isMonolithText,parse:(flat,source,lines)=>parseMonolithInvoice(flat,source,lines)},
    {id:'peterborough-bazaar',name:'Peterborough Bazaar',kind:'supplier',detect:isPeterboroughBazaarText,parse:(flat,source,lines)=>parsePeterboroughBazaarInvoice(flat,source,lines)},
    {id:'parkers',name:'Parker Motor Services Ltd',kind:'supplier',status:'Review',detect:isParkersText,parse:(flat,source,lines)=>parseParkersInvoice(flat,source,lines)},
    {id:'deens-produce',name:'Deens Produce',kind:'supplier',detect:isDeensProduceText,parse:(flat,source,lines)=>parseDeensProduceInvoice(flat,source,lines)},
    {id:'liberty-frozen-foods',name:'Liberty Frozen Foods',kind:'supplier',detect:isLibertyFrozenFoodsText,parse:(flat,source,lines)=>parseLibertyFrozenFoodsInvoice(flat,source,lines)},
    {id:'isaac-wholesale',name:'Isaac Wholesale Ltd',kind:'supplier',detect:isIsaacWholesaleText,parse:(flat,source,lines)=>parseIsaacWholesaleInvoice(flat,source,lines)},
    {id:'dairy-fresh',name:'Dairy Fresh',kind:'supplier',status:'Under development',detect:isDairyFreshText,parse:(flat,source,lines)=>parseDairyFreshInvoice(flat,source,lines)},
    {id:'maspo',name:'Maspo',kind:'supplier',detect:flat=>/\bMASPO(?:\s+FOOD)?\s+LTD\b/i.test(flat)||maspoFooterInvoice(flat),parse:(flat,source,lines)=>parseMaspoInvoice(flat,source,lines)},
    {id:'polish-village-bread',name:'Polish Village Bread',kind:'supplier',detect:isPolishVillageBreadText,parse:(flat,source,lines,options)=>parseWzInvoice(flat,source,lines,options)},
    {id:'wz-delivery',name:'WZ delivery note',kind:'document format',detect:flat=>/\bDELIVERY\s+[0-9OIL\s]{3,}(?:\/|\s+[A-Z]{2,})/i.test(flat)||/\b(?:delivery\s+note|issued\s+baskets)\b/i.test(flat),parse:(flat,source,lines,options)=>parseWzInvoice(flat,source,lines,options)},
    {id:'generic',name:'General invoice',kind:'fallback',detect:()=>true,parse:(flat,source,lines)=>parseInvoiceGeneric(flat,source,lines)}
  ];
  function identifyInvoiceProfile(text){
    const flat=String(text||'').replace(/\s+/g,' ').trim();
    return invoiceProfiles.find(profile=>profile.detect(flat))||invoiceProfiles.at(-1);
  }
  function disambiguateGeneratedShahidReferences(records){
    const groups=new Map();
    for(const row of records||[]){
      if(row.profileId!=='shahid-halal-poultry'||!row.invoiceNumberGenerated||!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date||'')))continue;
      const date=String(row.date),base=date.slice(8,10)+date.slice(5,7);
      if(!groups.has(base))groups.set(base,[]);
      groups.get(base).push(row);
    }
    for(const [base,matchingRows] of groups){
      matchingRows.forEach((row,index)=>{
        const reference=matchingRows.length===1?base:`${base}${String(index+1).padStart(2,'0')}`;
        row.invoiceNumber=reference;row.originalInvoiceNumber=reference;
      });
    }
    return records;
  }
  function parseInvoiceRobust(text,source='',ocrLines,options={}){
    const flat=String(text||'').replace(/\b[oO][,.][oO]{2}\b/g,'0.00').replace(/\b(\d[\d,]*)[,.][oO]{2}\b/g,'$1.00').replace(/\b(\d[\d,]*)[.,]?[oO]{2}\b/g,'$1.00').replace(/\b(\d[\d,]*)[oO](\d)\b/g,'$1.0$2').replace(/\b(?:1\s*l|I\s*l|1l)th\b/gi,'11th').replace(/\s+/g,' ').trim();
    const profile=identifyInvoiceProfile(flat);
    const specialised=profile?.parse(flat,source,ocrLines,options),row=specialised||parseInvoiceGeneric(flat,source,ocrLines),originalInvoiceNumber=String(row.originalInvoiceNumber||row.invoiceNumber||'').trim();
    // Polish Village Bread is not VAT registered on these documents. Record an
    // explicit zero for this supplier only, so its exports never contain N/A.
    if(profile?.id==='polish-village-bread'&&row.isInvoiceDocument!==false)row.vat=0;
    row.originalInvoiceNumber=originalInvoiceNumber;
    row.invoiceNumber=profile?.id==='maspo'?normalizeMaspoInvoiceNumber(originalInvoiceNumber):profile?.id==='liberty-frozen-foods'?originalInvoiceNumber:normalizeInvoiceNumber(originalInvoiceNumber);
    if(row.subtotal===null||row.subtotal===undefined)row.subtotal='';
    if(row.vat===null||row.vat===undefined)row.vat='';
    // Only an explicitly configured supplier profile is allowed to accept a
    // supplier document. Layout-only parsers (such as WZ delivery notes) can
    // help read fields, but they do not establish that the supplier is known.
    const profileConfigured=profile?.kind==='supplier',supportedProfile=profileConfigured&&Boolean(specialised),genericAcceptedForConfiguredProfile=profileConfigured&&row.accepted===true,unconfiguredSupplier=!profileConfigured&&row.isInvoiceDocument!==false;
    const vatRequired=row.documentType!=='DELIVERY NOTE',complete=Boolean((supportedProfile||genericAcceptedForConfiguredProfile)&&row.isInvoiceDocument!==false&&row.invoiceNumber&&row.date&&row.supplier&&row.total!==''&&row.total!==null&&row.total!==undefined&&Number.isFinite(Number(row.total))&&(!vatRequired||row.vat!==''&&row.vat!==null&&row.vat!==undefined&&Number.isFinite(Number(row.vat)))&&(row.documentType!=='CORRECTION'||row.correctedTotal!==''&&row.correctedTotal!==null&&row.correctedTotal!==undefined&&Number.isFinite(Number(row.correctedTotal))&&row.correctedVat!==''&&row.correctedVat!==null&&row.correctedVat!==undefined&&Number.isFinite(Number(row.correctedVat))));
    if(row.isInvoiceDocument===false){row.invoiceNumber='';row.originalInvoiceNumber='';row.date='';row.total='';row.subtotal='';row.vat='';}
    row.status=complete?'ACCEPTED':'REJECTED';row.accepted=row.status==='ACCEPTED';row.rejected=row.status==='REJECTED';
    row.unconfiguredSupplier=unconfiguredSupplier;
    row.supplierProfileConfigured=Boolean(profileConfigured);
    row.rejectedReason=complete?'':row.isInvoiceDocument===false?(row.rejectedReason||'This document is a supplier statement or non-invoice document.'):unconfiguredSupplier?'Supplier profile is not set up. All invoices from this supplier are rejected until a supplier profile is configured.':row.rejectedReason||(!specialised?'Supplier/document format not recognised.':!row.invoiceNumber?'Invoice number not found.':!row.date?'Invoice date not found.':!row.supplier?'Supplier not identified.':row.documentType==='CORRECTION'&&(row.correctedTotal===''||row.correctedTotal===null||row.correctedTotal===undefined||row.correctedVat===''||row.correctedVat===null||row.correctedVat===undefined)?'Corrected invoice total or VAT could not be confirmed; correction was not applied.':row.total===''||row.total===null||row.total===undefined?'Printed total not found.':'VAT amount not found; one 5x OCR retry is required.');
    row.confidence=row.status;row.review=row.status==='REVIEW';
    return {...row,profileId:profile?.id||'generic'};
  }
  function parseInvoiceBatch(text,source='',ocrLines,options={}){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[];
    if(!lines.length){if(/\bE\s*\.?\s*P\s*\.?\s*A\s*\.?\s*FOODS?\s+LTD\b|\bEPA\s+FOODS\b/i.test(String(text||'')))return [];if(isEagleFoodsText(text)&&isEagleNonInvoicePage(text)&&!eagleInvoicePage([],text))return [];if(isIsaacWholesaleText(text)&&isaacSummaryPage([{text:String(text||'')}])&&!isaacInvoicePageText(text))return [];const row=parseInvoiceRobust(text,source,undefined,options);row.profileId=identifyInvoiceProfile(text)?.id||'generic';return row.profileId==='isaac-wholesale'&&!row.isInvoiceDocument?[]:disambiguateGeneratedShahidReferences([row]);}
    const pages=[...new Set(lines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b);
    const pageLines=new Map(pages.map(page=>[page,lines.filter(line=>(Number(line.page)||1)===page).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0))]));
    const parkersPages=pages.filter(page=>isParkersText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')));
    if(parkersPages.length){
      const parkersRows=parkersPages.flatMap(page=>{
        const items=pageLines.get(page)||[],pageText=items.map(line=>String(line.text||'')).join(' ');
        if(!parkersInvoicePage(items,pageText))return [];
        const row=parseInvoiceRobust(pageText,source,items,options);row.page=page;row.sourcePages=[page];row.profileId='parkers';return [row];
      }),otherLines=lines.filter(line=>!parkersPages.includes(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
      return [...otherRows,...parkersRows].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
    }
    const isaacPages=pages.filter(page=>isIsaacWholesaleText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')));
    if(isaacPages.length){
      const isaacRows=parseIsaacWholesaleBatch(new Map(isaacPages.map(page=>[page,pageLines.get(page)])),source),otherLines=lines.filter(line=>!isaacPages.includes(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
      return [...otherRows,...isaacRows].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
    }
    const eaglePages=pages.filter(page=>isEagleFoodsText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')));
    if(eaglePages.length){
      const eagleRows=parseEagleFoodsBatch(new Map(eaglePages.map(page=>[page,pageLines.get(page)])),source),eagleTermsPages=pages.filter(page=>isEagleNonInvoicePage((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))),otherLines=lines.filter(line=>!eaglePages.includes(Number(line.page)||1)&&!eagleTermsPages.includes(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
      return [...otherRows,...eagleRows].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
    }
    if(isDairyFreshText(text)||pages.some(page=>isDairyFreshText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))))return parseDairyFreshBatch(pageLines,source);
    // Find invoice boundaries using document identifiers, then detect the
    // supplier in each isolated invoice group before selecting its parser.
    const starts=[];
    for(const page of pages){
      const pageItems=pageLines.get(page),pageText=pageItems.map(line=>String(line.text||'')).join(' '),topItems=pageItems.filter(line=>(Number(line.y)||0)<1200),topText=topItems.map(line=>String(line.text||'')).join(' ');
      const freshwaysText=isFreshwaysText(pageText),freshwaysHeader=freshwaysText&&freshwaysHeaderPresent(pageItems),freshwaysRawNumber=freshwaysHeader?freshwaysLabeledRaw(pageItems,/\binvoice\s*(?:no\.?|number|#)\s*:?[\s]*/i,{minY:0,maxY:1200}):'',freshwaysHeaderNumber=freshwaysInvoiceNumber(freshwaysRawNumber),freshwaysHeaderDate=freshwaysHeader?freshwaysLabeledRaw(pageItems,/\binvoice\s+date\s*:?[\s]*/i,{minY:0,maxY:1200}):'',freshwaysInvoiceStart=Boolean(freshwaysHeader),freshwaysStartId=freshwaysInvoiceStart?`freshways:${freshwaysHeaderNumber.full||page}:${freshwaysInvoiceDate(freshwaysHeaderDate)||''}`:'';
      const shahidText=isShahidHalalText(pageText),shahidTotal=shahidText?shahidFooterTotal(pageItems):null,shahidInvoiceStart=Boolean(shahidText&&shahidTotal?.line),shahidStartId=shahidInvoiceStart?'shahid:'+page:'';
      const marionText=isMarionTradingText(pageText),marionHeaderData=marionText?marionHeader(pageItems,pageText):{fullNumber:'',date:''},marionInvoiceStart=Boolean(marionHeaderData.fullNumber),marionStartId=marionInvoiceStart?'marion:'+marionHeaderData.fullNumber:'';
      const monolithData=isMonolithText(pageText)?monolithHeader(pageText,pageItems):{number:'',pageNumber:0,pageCount:0,date:''},monolithInvoiceStart=Boolean(monolithData.number&&monolithData.pageNumber===1),monolithStartId=monolithInvoiceStart?'monolith:'+monolithData.number:'';
      const deensText=isDeensProduceText(pageText),deensHeaderData=deensText?deensHeader(pageItems,pageText):{fullNumber:'',date:''},deensInvoiceStart=Boolean(deensHeaderData.fullNumber),deensStartId=deensInvoiceStart?'deens:'+deensHeaderData.fullNumber:'';
      const libertyReference=pageText.match(/\b(MAP\s*-\s*\d{6}\s*-\s*\d+)\b/i)?.[1]?.replace(/\s+/g,'').toUpperCase()||'',libertyInvoiceHeader=!libertyReference&&/\binvoice\s+no\.?\b/i.test(pageText)&&/\border\s+date\b/i.test(pageText)&&/\bMAP\b/i.test(pageText),libertyInvoiceStart=Boolean(isLibertyFrozenFoodsText(pageText)&&(libertyReference||libertyInvoiceHeader)),libertyStartId=libertyInvoiceStart?(libertyReference?'liberty:'+libertyReference:'liberty-page:'+page):'';
      const epaNonInvoice=/\bE\s*\.?\s*P\s*\.?\s*A\s*\.?\s*FOODS?\s+LTD\b|\bEPA\s+FOODS\b/i.test(pageText);
      const peterboroughText=isPeterboroughBazaarText(pageText),peterboroughData=peterboroughText?peterboroughHeader(pageItems,pageText):{fullNumber:'',date:''},peterboroughInvoiceStart=Boolean(peterboroughText&&/\binvoice\b/i.test(topText)),peterboroughTotal=peterboroughInvoiceStart?peterboroughFooterValue(pageItems,'total'):null,peterboroughVat=peterboroughInvoiceStart?peterboroughFooterValue(pageItems,'vat'):null,peterboroughStartId=peterboroughInvoiceStart?`peterborough:${peterboroughData.fullNumber||'unknown'}:${peterboroughData.date||''}:${peterboroughTotal??''}:${peterboroughVat??''}`:'';
      const bestwayText=isBestwayText(pageText),bestwayData=bestwayText?bestwayHeader(pageItems):{fullNumber:'',invoiceNumber:'',date:'',total:null},bestwaySequence=bestwayText?bestwayPageSequence(pageItems):{page:0,count:0},bestwayStartId=bestwayData.fullNumber?`bestway:${bestwayData.fullNumber}`:'',bestwayInvoiceStart=Boolean(bestwayText&&bestwayStartId&&bestwaySequence.page<=1&&starts.at(-1)?.id!==bestwayStartId);
      const maspoId=maspoPageDocumentId(pageItems),maspoText=/\bMASPO(?:\s+FOOD)?\s+LTD\b/i.test(pageText),maspoInvoiceStart=Boolean(maspoId&&maspoText&&/\binvoice\s+date(?:\s*\(taxpoint\))?\s*:?\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}|\binvoice\s+date(?:\s*\(taxpoint\))?\b/i.test(pageText)),maspoDate=maspoInvoiceStart?parseDate(firstMatch(pageText,[/invoice\s+date(?:\s*\(taxpoint\))?\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}[./-]\d{2})/i])):'',maspoNonInvoiceStart=/\b(?:cash\s+receipt|complaint\s+report|pallet\s+note)\b/i.test(pageText),maspoStatementStart=/\bstatement\s+of\s+the\s+account\b|\baccount\s+statement\b/i.test(pageText),footerReference=pageText.match(/\binvoice\s+(\d{5,8}\s*\/\s*LON\s*\/\d{1,2}\s*\/\s*\d{4})\b/i)?.[1]||'',maspoFooterStart=Boolean(footerReference&&/\bitem\s+name\b/i.test(pageText)&&/\bgross\s+value\b/i.test(pageText));
      const deliveryLine=pageItems.find(line=>{
        const isDelivery=/\bDELIVERY\s+[0-9OIL\s]{3,}(?:\/|\s+[A-Z]{2,})/i.test(String(line.text||''));
        const nearContinuation=pageItems.some(other=>/continued\s+on\s+the\s+next\s+page/i.test(String(other.text||''))&&Math.abs((Number(other.y)||0)-(Number(line.y)||0))<120);
        return isDelivery&&((Number(line.y)||0)<1200||nearContinuation);
      });
      const genericMatch=topText.match(/\b(?:invoice|tax\s+invoice)\s*(?:no\.?|number|#)?\s*((?:FS\s*)?\d{3,}\s*[\/-]\s*[A-Z0-9][A-Z0-9./-]*)/i);
      const maspoLonKey=value=>{const match=String(value||'').match(/(\d{5,8})\s*\/\s*LON\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/i);return match?`maspo-lon:${match[1].slice(-4)}:${match[2].padStart(2,'0')}:${match[3]}`:'';};
      const footerKey=maspoLonKey(maspoId)||maspoLonKey(footerReference)||'maspo-lon:'+String(maspoId||footerReference).replace(/\s+/g,'').toUpperCase();
      const lastStart=starts.at(-1),lastMaspoMatch=String(lastStart?.id||'').match(/^maspo:(\d{4}):(.*)$/);
      const genericMaspoNumber=genericMatch?normalizeMaspoInvoiceNumber(genericMatch[1]):'';
      const genericDate=parseDate(firstMatch(pageText,[/invoice\s+date(?:\s*\(taxpoint\))?\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}[./-]\d{2})/i]));
      const sameMaspoNumber=Boolean((maspoId&&lastMaspoMatch&&lastMaspoMatch[1]===normalizeMaspoInvoiceNumber(maspoId))||(genericMaspoNumber&&lastMaspoMatch&&lastMaspoMatch[1]===genericMaspoNumber&&!maspoText));
      const sameMaspoContinuation=(Boolean(maspoId||footerReference)&&(lastStart?.id===footerKey||(sameMaspoNumber&&(!maspoDate||!lastMaspoMatch?.[2]||lastMaspoMatch[2]===maspoDate))))||(sameMaspoNumber&&!maspoText&&(!genericDate||!lastMaspoMatch?.[2]||lastMaspoMatch[2]===genericDate));
      const maspoStartId=/^\d{5,8}\s*\/\s*LON\s*\//i.test(maspoId)?(maspoLonKey(maspoId)||footerKey):'maspo:'+normalizeMaspoInvoiceNumber(maspoId)+':'+maspoDate;
      let candidate=null;
      if(epaNonInvoice)candidate={id:'ignored-epa:'+page,page,skip:true};
      else if(bestwayInvoiceStart)candidate={id:bestwayStartId,page,bestway:true};
      else if(libertyInvoiceStart&&lastStart?.id!==libertyStartId)candidate={id:libertyStartId,page,liberty:true};
      else if(monolithInvoiceStart&&lastStart?.id!==monolithStartId)candidate={id:monolithStartId,page};
      else if(marionInvoiceStart&&lastStart?.id!==marionStartId)candidate={id:marionStartId,page};
      else if(deensInvoiceStart&&lastStart?.id!==deensStartId)candidate={id:deensStartId,page};
      else if(peterboroughInvoiceStart)candidate={id:peterboroughStartId,page};
      else if(shahidInvoiceStart)candidate={id:shahidStartId,page};
      else if(freshwaysInvoiceStart)candidate={id:freshwaysStartId,page,freshways:true};
      else if(maspoInvoiceStart&&!sameMaspoContinuation)candidate={id:maspoStartId,page};
      else if(maspoNonInvoiceStart)candidate={id:'maspo-noninvoice:'+page,page};
      else if(maspoStatementStart&&!starts.at(-1)?.id.startsWith('delivery:')&&!sameMaspoContinuation)candidate={id:'maspo-statement',page};
      else if(maspoFooterStart&&!sameMaspoContinuation)candidate={id:footerKey,page};
      else if(deliveryLine)candidate={id:'delivery:'+extractDeliveryIdentifier(pageText),page};
      else if(genericMatch&&!maspoId&&!maspoText&&!bestwayText&&!sameMaspoContinuation)candidate={id:'invoice:'+genericMatch[1].replace(/\s+/g,''),page};
      if(candidate&&lastStart?.id!==candidate.id)starts.push(candidate);
    }
    if(!starts.length&&pages.some(page=>isMarionSummaryPage(pageLines.get(page)||[])))return [];
    if(starts.length===1&&starts[0].id.startsWith('marion:')){const start=starts[0].page,segmentLines=pages.filter(page=>page>=start).flatMap(page=>pageLines.get(page)),segmentText=segmentLines.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n'),record=parseInvoiceRobust(segmentText,source,segmentLines,options);record.page=start;record.profileId=identifyInvoiceProfile(segmentText)?.id||'generic';return disambiguateGeneratedShahidReferences([record]);}
    if(starts.length===1&&starts[0].freshways){const start=starts[0].page,segmentLines=pages.filter(page=>page>=start).flatMap(page=>pageLines.get(page)),segmentText=segmentLines.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n'),record=parseInvoiceRobust(segmentText,source,segmentLines,options);record.page=start;record.profileId='freshways';return [record];}
    if(starts.length<=1){if(starts[0]?.skip||/\b(?:cash\s+receipt|complaint\s+report|pallet\s+note)\b/i.test(text)&&!/\binvoice\s+date(?:\s*\(taxpoint\))?\b/i.test(text))return [];if(starts[0]?.liberty){const page=starts[0].page,pageItems=pageLines.get(page),record=parseInvoiceRobust(pageItems.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n'),source,pageItems,options);record.page=page;record.profileId='liberty-frozen-foods';return deduplicateInvoiceRows([record]).rows.map(row=>row.status==='ACCEPTED'?{...row,rejectedReason:'',retryOcr:false}:row);}const record=parseInvoiceRobust(text,source,lines,options);record.page=pages[0]||1;record.profileId=identifyInvoiceProfile(text)?.id||'generic';return disambiguateGeneratedShahidReferences([record]);}
    const records=[];
    for(let i=0;i<starts.length;i++){
      if(starts[i].skip)continue;
      const start=starts[i].page,end=i+1<starts.length?starts[i+1].page-1:pages.at(-1),segmentLines=pages.filter(page=>page>=start&&page<=end).flatMap(page=>pageLines.get(page));
      const parseLines=starts[i].liberty?pageLines.get(start):segmentLines,segmentText=parseLines.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n');
      if(/\b(?:cash\s+receipt|complaint\s+report|pallet\s+note)\b/i.test(segmentText)&&!/\binvoice\s+date(?:\s*\(taxpoint\))?\b/i.test(segmentText))continue;
      const record=parseInvoiceRobust(segmentText,source,parseLines,options);
      records.push({...record,page:start,profileId:identifyInvoiceProfile(segmentText)?.id||'generic'});
    }
    const rows=disambiguateGeneratedShahidReferences(records),libertyRows=deduplicateInvoiceRows(rows.filter(row=>row.profileId==='liberty-frozen-foods')).rows.map(row=>row.status==='ACCEPTED'?{...row,rejectedReason:'',retryOcr:false}:row),otherRows=rows.filter(row=>row.profileId!=='liberty-frozen-foods');return [...otherRows,...libertyRows].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }  async function parsePdf(input,mode,source=''){const info=await extractText(input);return {info,...(mode==='invoice'?{invoice:parseInvoiceRobust(info.text,source),invoices:parseInvoiceBatch(info.text,source)}:mode==='receipt'?{receipts:parseReceiptBatch(info.text,source)}:{transactions:parseBank(info.text,source,info.pageItems)})};}
  function pdfFileUrl(filePath,page=1){
    const raw=String(filePath||'').trim();if(!raw)return '';
    const safePart=part=>encodeURIComponent(part).replace(/%3A/gi,':');
    const normalized=raw.replace(/\\/g,'/');let url;
    if(/^file:\/\//i.test(normalized)){
      try{const parsed=new URL(normalized);const pathname=parsed.pathname.replace(/^\/(\w:)/,'$1');return pdfFileUrl(decodeURIComponent(parsed.hostname?`//${parsed.hostname}${parsed.pathname}`:pathname),page);}
      catch{return '';}
    }
    if(/^\/\//.test(normalized)){
      const [host,...parts]=normalized.slice(2).split('/');if(!host||!parts.length)return '';url=`file://${host}/${parts.map(safePart).join('/')}`;
    }else if(/^[a-zA-Z]:\//.test(normalized)){
      const [drive,...parts]=normalized.split('/');url=`file:///${safePart(drive)}/${parts.map(safePart).join('/')}`;
    }else if(normalized.startsWith('/')){
      url=`file:///${normalized.slice(1).split('/').map(safePart).join('/')}`;
    }else return '';
    return `${url}#page=${Math.max(1,Number(page)||1)}`;
  }
  function resolvePolishWzTotal(firstPassTotal,highResolutionTotal){
    const usable=value=>value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
    const verified=usable(highResolutionTotal),firstPass=usable(firstPassTotal);
    if(verified!==null)return {total:verified,verified:true,status:'ACCEPTED'};
    if(firstPass!==null)return {total:firstPass,verified:false,status:'ACCEPTED'};
    return {total:'',verified:false,status:'REJECTED'};
  }
  function invoiceStatusFor(documentType,complete,liveProcessing=false){if(liveProcessing)return 'PROCESSING';return complete?'ACCEPTED':'REJECTED';}
  function invoiceRateBases(total,vat,documentType='INVOICE'){
    const numeric=value=>value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))?Math.round(Number(value)*100):null;
    const grossCents=numeric(total),vatCents=numeric(vat);
    if(grossCents===null||vatCents===null)return {standardRate:'',zeroRate:''};
    if(vatCents===0)return {standardRate:'',zeroRate:grossCents/100};
    const standardCents=vatCents*5,netCents=grossCents-vatCents,zeroCents=netCents-standardCents;
      // VAT printed to pennies can make VAT × 5 differ from the invoice net by
      // a couple of pence. Treat that as an all-standard-rate invoice instead
      // of emitting a spurious zero-rate amount. For a positive invoice, a
      // negative remainder can never be a genuine zero-rated purchase; credits
      // retain negative zero-rate bases when they are genuinely mixed-rate.
      if(Math.abs(zeroCents)<=2||(grossCents>=0&&zeroCents<0))return {standardRate:netCents/100,zeroRate:''};
    return {standardRate:standardCents/100,zeroRate:zeroCents/100};
  }
  function invoiceRetryConflictReason(conflicts={}){
    return Object.entries(conflicts).map(([field,values])=>`OCR passes disagree on ${field==='vat'?'VAT':'total'} (£${Number(values.firstPass).toFixed(2)} vs £${Number(values.retry).toFixed(2)}). Confirm the printed amount on the PDF.`).join(' ');
  }
  function matchEagleRetryCandidate(row,candidates){
    if(row?.profileId!=='eagle-foods'||!Number.isInteger(Number(row.page))||Number(row.page)<1)return null;
    const first=String(row.originalInvoiceNumber||'').replace(/\D/g,''),page=Number(row.page);
    const matches=(candidates||[]).filter(candidate=>{
      if(candidate?.profileId!=='eagle-foods')return false;
      const retry=String(candidate.originalInvoiceNumber||'').replace(/\D/g,'');
      if(retry.length<6||!((candidate.sourcePages||[candidate.page]).map(Number).includes(page)))return false;
      if(first.length>=6&&first!==retry||first.length>=2&&first.length<6&&!retry.endsWith(first))return false;
      if(row.date&&candidate.date&&row.date!==candidate.date)return false;
      if(row.accountCode&&candidate.accountCode&&row.accountCode!==candidate.accountCode)return false;
      return true;
    });
    return matches.length===1?matches[0]:null;
  }
  function invoiceRetryAccepted(row,candidate,complete){
    const first=String(row?.originalInvoiceNumber||'').replace(/\D/g,''),retry=String(candidate?.originalInvoiceNumber||'').replace(/\D/g,''),sameEaglePage=(candidate?.sourcePages||[candidate?.page]).map(Number).includes(Number(row?.page)),eaglePageMatch=row?.profileId==='eagle-foods'&&candidate?.profileId==='eagle-foods'&&sameEaglePage&&(!first||first===retry||first.length>=2&&first.length<6&&retry.endsWith(first));
    return Boolean(complete&&!row?.freshwaysVatOcrAmbiguous&&!row?.eagleSummaryConflict&&!row?.eagleSummaryAmbiguousReference&&!Object.keys(row?.ocrAmountConflicts||{}).length&&(row?.profileId==='bestway'||candidate?.accepted||row?.freshwaysVatOcrRetryResolved||eaglePageMatch));
  }
  function mergeInvoiceRetryCandidate(row,candidate,{preserveGeneratedReference=false}={}){
    const merged={...row},conflicts={...(row.ocrAmountConflicts||{})},fields=['invoiceNumber','originalInvoiceNumber','date','supplier','subtotal','vat','total','correctsInvoice','documentType','correctedSubtotal','correctedVat','correctedTotal','profileId','accepted','rejectedReason','unconfiguredSupplier','supplierProfileConfigured'];
    for(const key of fields){
      if(preserveGeneratedReference&&(key==='invoiceNumber'||key==='originalInvoiceNumber'))continue;
      const value=candidate?.[key];if(value===''||value===null||value===undefined)continue;
      // If the 5x scan was requested only because a Freshways £0.00 may have
      // become "20.00", keep already readable first-pass totals. The higher
      // resolution page can misread the pound sign on the invoice total too.
      if(row?.profileId==='freshways'&&row?.freshwaysVatOcrAmbiguous&&key==='total'&&merged.total!==''&&merged.total!==null&&merged.total!==undefined)continue;
      const compareRetryAmount=(row.profileId==='bestway'||candidate.profileId==='bestway'||row.profileId==='eagle-foods'&&candidate.profileId==='eagle-foods')&&(key==='vat'||key==='total')||row.profileId==='freshways'&&candidate.profileId==='freshways'&&key==='vat';
      if(compareRetryAmount){
        const first=merged[key],firstNumber=first===''||first===null||first===undefined?null:Number(first),retryNumber=Number(value);
        if(Number.isFinite(firstNumber)&&Number.isFinite(retryNumber)&&Math.round(firstNumber*100)!==Math.round(retryNumber*100)){
          conflicts[key]={firstPass:firstNumber,retry:retryNumber};
          continue;
        }
      }
      merged[key]=value;
    }
    if(row?.profileId==='freshways'&&row?.freshwaysVatOcrAmbiguous){
      const retryVat=candidate?.vat===''||candidate?.vat===null||candidate?.vat===undefined?null:Number(candidate.vat);
      if(retryVat===0){merged.vat=0;merged.freshwaysVatOcrAmbiguous=false;merged.freshwaysVatOcrRetryResolved=true;merged.rejectedReason='';}
      else{merged.vat='';merged.freshwaysVatOcrAmbiguous=true;merged.accepted=false;merged.rejectedReason='Freshways VAT remained ambiguous after the 5x OCR retry; confirm the printed footer manually.';}
    }
    if(row?.profileId==='eagle-foods'&&Array.isArray(merged.eagleStatementRows)&&String(merged.originalInvoiceNumber||'').replace(/\D/g,'').length>=6){
      applyEagleStatementConfirmation(merged,merged.eagleStatementRows);
    }
    // When Liberty's clipped footer is unreadable on the higher-resolution
    // pass, do not preserve a generic first-pass figure (often a case price)
    // as if it were the invoice total. Keep the row for manual review instead.
    const missingRetryTotal=candidate?.total===''||candidate?.total===null||candidate?.total===undefined;
    if(missingRetryTotal&&(row?.profileId==='liberty-frozen-foods'||candidate?.profileId==='liberty-frozen-foods')){merged.total='';merged.accepted=false;}
    if(Object.keys(conflicts).length){merged.ocrAmountConflicts=conflicts;merged.ocrConflictReason=invoiceRetryConflictReason(conflicts);if(row?.profileId==='freshways'&&conflicts.vat)merged.rejectedReason=merged.ocrConflictReason;}
    else{delete merged.ocrAmountConflicts;delete merged.ocrConflictReason;}
    return merged;
  }
  return {extractText,parseBank,parseBankCsv,parseOcrBank,inspectBankBalances,markBankBalanceMismatches,parseInvoice:parseInvoiceRobust,parseInvoiceBatch,confirmEagleInvoiceRows,eagleStatementRowsFromOcr,identifyInvoiceProfile,invoiceProfiles:invoiceProfiles.map(({id,name,kind})=>({id,name,kind})),receiptProfiles:receiptProfiles.map(({id,name,category})=>({id,name,category})),compatibleCompanies:compatibleCompanies(),parseReceiptBatch,sortReceiptRowsByPdfPage,isReceiptBackPage,resolvePolishWzTotal,invoiceStatusFor,invoiceRateBases,invoiceRetryAccepted,matchEagleRetryCandidate,mergeInvoiceRetryCandidate,invoiceRetryConflictReason,reconcileInvoiceCorrections,deduplicateInvoiceRows,parseDairyFreshFooterRetryTargets,parsePdf,parseDate,amount,pdfFileUrl};
});




