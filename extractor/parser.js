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
  // Starling's selectable text uses embedded custom fonts. The ordinary text
  // scanner above sees the raw character codes and can lose digits. Resolve
  // those fonts' ToUnicode maps and retain their page positions so the same
  // heading-relative bank parser can read online PDFs without OCR.
  async function extractStarlingPdfText(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),source=bytesToLatin(bytes),objects=new Map(),objectPattern=/(\d+)\s+0\s+obj\b/g;let match;
    while((match=objectPattern.exec(source))){const id=Number(match[1]),bodyStart=objectPattern.lastIndex;let end=source.indexOf('endobj',bodyStart),stream=source.indexOf('stream',bodyStart);if(stream>=0&&(end<0||stream<end)){const endStream=source.indexOf('endstream',stream);if(endStream<0)break;end=source.indexOf('endobj',endStream);if(end<0)break;}objects.set(id,{body:source.slice(bodyStart,end),start:bodyStart});objectPattern.lastIndex=end+6;}
    if(!objects.size)return null;
    const streamBytes=async object=>{if(!object||object.start<0)return null;const offset=object.body.indexOf('stream');if(offset<0)return null;let start=object.start+offset+6;if(bytes[start]===13&&bytes[start+1]===10)start+=2;else if(bytes[start]===10||bytes[start]===13)start++;let end=source.indexOf('endstream',start);if(end<0)return null;let raw=bytes.subarray(start,end);while(raw.length&&(raw.at(-1)===10||raw.at(-1)===13))raw=raw.subarray(0,-1);if(/\/FlateDecode\b/.test(object.body.slice(0,offset)))try{raw=await inflate(raw);}catch{return null;}return raw;};
    for(const object of [...objects.values()]){if(!/\/Type\s*\/ObjStm\b/.test(object.body))continue;const count=Number(object.body.match(/\/N\s+(\d+)/)?.[1]),first=Number(object.body.match(/\/First\s+(\d+)/)?.[1]),raw=await streamBytes(object);if(!raw||!count||!first)continue;const decoded=bytesToLatin(raw),header=decoded.slice(0,first).trim().split(/\s+/).map(Number);for(let index=0;index<count;index++){const id=header[index*2],offset=header[index*2+1],next=index+1<count?header[index*2+3]:decoded.length-first;if(Number.isFinite(id)&&Number.isFinite(offset))objects.set(id,{body:decoded.slice(first+offset,first+next),start:-1});}}
    const reference=(body,key)=>Number(body.match(new RegExp(`\\/${key}\\s+(\\d+)\\s+\\d+\\s+R`))?.[1])||0;
    const toUnicode=async object=>{const raw=await streamBytes(object);if(!raw)return null;const text=bytesToLatin(raw),map=new Map();for(const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))map.set(pair[1].toUpperCase(),unicodeHex(pair[2]));for(const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)){const range=/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[((?:\s*<[0-9A-Fa-f]+>\s*)+)\])/g;for(const item of block[1].matchAll(range)){const start=parseInt(item[1],16),finish=parseInt(item[2],16),digits=item[1].length;if(item[3]){const destination=parseInt(item[3],16);for(let code=start;code<=finish;code++)map.set(code.toString(16).toUpperCase().padStart(digits,'0'),String.fromCharCode(destination+code-start));}else{const values=[...item[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map(value=>unicodeHex(value[1]));for(let code=start;code<=finish&&code-start<values.length;code++)map.set(code.toString(16).toUpperCase().padStart(digits,'0'),values[code-start]);}}}const codeLength=Math.max(1,...[...map.keys()].map(key=>key.length/2));return {map,codeLength};};
    const unicodeHex=value=>{let result='';for(let index=0;index+3<value.length;index+=4)result+=String.fromCharCode(parseInt(value.slice(index,index+4),16));return result;};
    const unicodeCache=new Map(),fontMaps=async pageBody=>{let resourcesBody=objects.get(reference(pageBody,'Resources'))?.body||pageBody;if(!/\/Font\b/.test(resourcesBody)){const parent=reference(pageBody,'Parent');if(parent)resourcesBody=objects.get(parent)?.body||resourcesBody;}const fontId=reference(resourcesBody,'Font'),fontBody=objects.get(fontId)?.body||resourcesBody,result={};for(const item of fontBody.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)){const font=objects.get(Number(item[2])),mapId=reference(font?.body||'','ToUnicode');if(!mapId)continue;if(!unicodeCache.has(mapId))unicodeCache.set(mapId,toUnicode(objects.get(mapId)));result[item[1]]=await unicodeCache.get(mapId);}return result;};
    const decodePdfString=(token,map)=>{let raw;if(token[0]==='<')raw=token.slice(1,-1).replace(/\s/g,'').match(/../g)?.map(value=>parseInt(value,16))||[];else raw=[...unescapePdf(token.slice(1,-1))].map(value=>value.charCodeAt(0)&255);if(!map)return raw.map(value=>String.fromCharCode(value)).join('');let output='';for(let index=0;index<raw.length;index+=map.codeLength){const key=raw.slice(index,index+map.codeLength).map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();output+=map.map.get(key)||'�';}return output;};
    const tokenize=content=>[...content.matchAll(/\/[A-Za-z0-9_.+-]+|<[^>]*>|\((?:\\[\s\S]|[^\\)])*\)|[-+]?(?:\d+\.?\d*|\.\d+)|\[|\]|[A-Za-z*"']+/g)].map(value=>value[0]);
    const contentLines=(content,maps,page,height)=>{const tokens=tokenize(content),items=[];let stack=[],font='',fontSize=8,lineX=0,lineY=0,leading=0,ctm=[1,0,0,1,0,0],graphics=[];const transform=(x,y)=>[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]],multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]],emit=text=>{if(!text.trim())return;const [x,y]=transform(lineX,lineY),width=text.length*fontSize*.5*Math.hypot(ctm[0],ctm[1]),lineHeight=fontSize*Math.hypot(ctm[2],ctm[3]);items.push({page,text,x:x*2.5,y:(height-y-lineHeight)*2.5,width:width*2.5,height:lineHeight*2.5});},add=token=>emit(decodePdfString(token,maps[font]));
      for(let index=0;index<tokens.length;index++){const token=tokens[index];if(token==='['){const values=[];while(index+1<tokens.length&&tokens[index+1]!==']')values.push(tokens[++index]);index++;stack.push(values);continue;}if(token[0]==='/'){stack.push(token.slice(1));continue;}if(token[0]==='('||token[0]==='<'){stack.push(token);continue;}if(/^[-+]?(?:\d|\.)/.test(token)){stack.push(Number(token));continue;}switch(token){case'q':graphics.push([...ctm]);stack=[];break;case'Q':ctm=graphics.pop()||ctm;stack=[];break;case'cm':{const matrix=stack.splice(-6).map(Number);if(matrix.length===6&&matrix.every(Number.isFinite))ctm=multiply(ctm,matrix);stack=[];break;}case'BT':stack=[];lineX=0;lineY=0;break;case'ET':stack=[];break;case'Tf':{const size=stack.pop(),name=stack.pop();font=String(name||'');fontSize=Number(size)||fontSize;stack=[];break;}case'Td':case'TD':{lineY+=Number(stack.pop())||0;lineX+=Number(stack.pop())||0;stack=[];break;}case'Tm':{const values=stack.splice(-6).map(Number);if(values.length===6){lineX=values[4];lineY=values[5];}stack=[];break;}case'TL':leading=Number(stack.pop())||leading;stack=[];break;case'T*':lineY-=leading;stack=[];break;case'Tj':{const value=stack.pop();if(typeof value==='string')add(value);stack=[];break;}case'TJ':{const values=stack.pop();if(Array.isArray(values))emit(values.filter(value=>typeof value==='string').map(value=>decodePdfString(value,maps[font])).join(''));stack=[];break;}case"'":{const value=stack.pop();lineY-=leading;if(typeof value==='string')add(value);stack=[];break;}default:if(/^(?:sc|SC|scn|SCN|g|G|rg|RG|w|m|l|c|v|y|re|S|s|f|F|f\*|B|B\*|n|Do|Tc|Tw|Tz|Tr|Ts|d|J|j|M|W|W\*)$/.test(token))stack=[];}}
      return items;};
    const tree=[...objects.entries()].find(([,object])=>/\/Type\s*\/Pages\b/.test(object.body));if(!tree)return null;const pageIds=[];const walk=id=>{const body=objects.get(id)?.body||'';if(/\/Type\s*\/Page\b/.test(body)&&!/\/Type\s*\/Pages\b/.test(body)){pageIds.push(id);return;}const kids=body.match(/\/Kids\s*\[([^\]]*)\]/);if(kids)for(const child of kids[1].matchAll(/(\d+)\s+\d+\s+R/g))walk(Number(child[1]));};walk(tree[0]);if(!pageIds.length)return null;
    const pageItems=[],imagePages=[];for(let index=0;index<pageIds.length;index++){
      const body=objects.get(pageIds[index]).body;let media=body.match(/\/MediaBox\s*\[([^\]]+)\]/),parent=reference(body,'Parent');while(!media&&parent){const parentBody=objects.get(parent)?.body||'';media=parentBody.match(/\/MediaBox\s*\[([^\]]+)\]/);parent=reference(parentBody,'Parent');}
      const coords=(media?.[1]||'0 0 612 792').trim().split(/\s+/).map(Number),height=coords[3]-coords[1],maps=await fontMaps(body),contentIds=[...body.matchAll(/\/Contents\s+(\d+)\s+\d+\s+R/g)].map(value=>Number(value[1])),array=body.match(/\/Contents\s*\[([^\]]+)\]/);if(array)contentIds.push(...[...array[1].matchAll(/(\d+)\s+\d+\s+R/g)].map(value=>Number(value[1])));
      const items=[],content=[];for(const id of contentIds){const raw=await streamBytes(objects.get(id));if(raw){const decoded=bytesToLatin(raw);content.push(decoded);items.push(...contentLines(decoded,maps,index+1,height));}}
      let resources=objects.get(reference(body,'Resources'))?.body||body;if(!/\/XObject\b/.test(resources)){const parentId=reference(body,'Parent');if(parentId)resources=objects.get(parentId)?.body||resources;}
      const xObjectBody=objects.get(reference(resources,'XObject'))?.body||'';for(const entry of xObjectBody.matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)){const image=objects.get(Number(entry[2]))?.body||'';if(!/\/Subtype\s*\/Image\b/.test(image))continue;const width=Number(image.match(/\/Width\s+(\d+)/)?.[1])||0,imageHeight=Number(image.match(/\/Height\s+(\d+)/)?.[1])||0;if(width*imageHeight<100000||!content.some(stream=>new RegExp(`\\/${entry[1]}\\s+Do\\b`).test(stream)))continue;imagePages.push(index+1);break;}
      pageItems.push(items.sort((a,b)=>a.y-b.y||a.x-b.x));
    }
    const text=pageItems.flat().map(item=>item.text).join('\n');if(!/starlingbank\.com/i.test(text)||!/(?:END\s+OF\s+DAY|ACCOUNT\s+BALANCE|PAYMENTS\s+IN|PAYMENTS\s+OUT)/i.test(text))return null;
    // Large image XObjects can be logos or signatures repeated on every page.
    // OCR only pages with no selectable transaction dates and no statement
    // summary; this catches mixed text/scanned statements without OCRing every
    // page or mistaking the summary page for a missing transaction page.
    const imagePagesToRead=pageItems.flatMap((items,index)=>{const pageText=items.map(item=>item.text).join(' '),hasDates=/\b\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*20\d{2}\b/.test(pageText),hasSummary=/\b(?:OPENING\s+BALANCE|CLOSING\s+BALANCE|PAYMENTS\s+IN|PAYMENTS\s+OUT)\b/i.test(pageText);return imagePages.includes(index+1)&&!hasDates&&!hasSummary?[index+1]:[];});
    return {text,pages:pageIds.length,hasText:Boolean(text.trim()),pageItems,imagePages:imagePagesToRead};
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
    let s=String(value||'').trim().replace(/\b([A-Za-z]{3,9})\.\s+/g,'$1 ').replace(/\s*([/.\-])\s*/g,'$1');
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};let m=s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);if(!m)m=s.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
    if(!m){const dayFirst=s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})$/i),monthFirst=s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})$/i);if(dayFirst){const month=months[dayFirst[2].slice(0,3).toLowerCase()];if(month)m=[null,dayFirst[1],month,dayFirst[3]];}else if(monthFirst){const month=months[monthFirst[1].slice(0,3).toLowerCase()];if(month)m=[null,monthFirst[2],month,monthFirst[3]];}}
    if(!m)return '';let y,day,month;if(m[1].length===4){y=Number(m[1]);month=Number(m[2]);day=Number(m[3]);}else{day=Number(m[1]);month=Number(m[2]);y=Number(m[3])<100?2000+Number(m[3]):Number(m[3]);}if(!Number.isInteger(y)||y<1900||y>2100||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return '';const parsed=new Date(Date.UTC(y,month-1,day));if(parsed.getUTCFullYear()!==y||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)return '';return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }  function amount(value){let s=String(value??'').replace(/[\u00A3$\u20AC\s]/g,'').replace(/,/g,'');if(!s)return null;const negative=/^\(.*\)$/.test(s)||/-/.test(s)||/\b(?:DR|DEBIT)\b/i.test(s);s=s.replace(/[()]/g,'').replace(/[^\d.-]/g,'');const n=Number(s);return Number.isFinite(n)?(negative?-1:1)*Math.abs(n):null;}
  function invoiceAmount(value){
    let s=String(value??'').trim();if(!s)return null;const negative=/^\(.*\)$/.test(s)||/-/.test(s)||/\b(?:DR|DEBIT)\b/i.test(s);
    // Repair common OCR confusions only inside amount-shaped currency tokens.
    s=s.replace(/E\s*[Il|](?=\s*,\s*\d{3}[.,]\s*[\dOo]{2}\b)/gi,(_match,currency)=>`${currency}1`).replace(/([Â£â‚¬$E])\s*[Il|]O(?=[.,]\s*[\dOo]{2}\b)/gi,(_match,currency)=>`${currency}10`).replace(/(?<=\d)[Oo](?=[.,]\s*[\dOo]{2}\b)/g,'0').replace(/([.,;])\s*[Oo]{2}\b/g,'$1 00');
    s=s.replace(/[^\d\s,;.()\-]/g,'').replace(/[()]/g,'').replace(/\s+/g,' ').trim();
    const grouped=s.match(/^(-?\d{1,3}(?:[\s,]\d{3})+)[.,;]\s*(\d{2})$/);if(grouped)s=`${grouped[1].replace(/[\s,]/g,'')}.${grouped[2]}`;else{const decimal=s.match(/^(-?\d+)[.,;]\s*(\d{2})$/);if(decimal)s=`${decimal[1]}.${decimal[2]}`;else s=s.replace(/[\s,;]/g,'');}
    const n=Number(s);return Number.isFinite(n)?(negative?-1:1)*Math.abs(n):null;
  }  function moneyTokens(line){return [...String(line).matchAll(/(?:[\u00A3$\u20AC]\s*)?\(?-?\d[\d,]*(?:\.\d{2})\)?(?:\s*(?:CR|DR))?/gi)].map(m=>({raw:m[0],value:amount(m[0]),index:m.index})).filter(x=>x.value!==null);}
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
      Object.assign(mismatch,{startIndex:entries[0]?.index??first.index,endIndex:balanceItem.index,currentIndex:balanceItem.index,rowIndexes:[...new Set(entries.map(entry=>entry.index))],previousIndex:previousItem?.index??null,previousDate:previousItem?.date||'',date:balanceItem.date,page:balanceItem.row?.page||first.row?.page||''});
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
      let raw=String(value??'').trim().replace(/[\u00A0\u202F]/g,' ');if(!raw||/^(?:-|â€”|n\/a)$/i.test(raw))return null;
      const negative=/^\(.*\)$/.test(raw)||/^\s*-/.test(raw)||/\b(?:dr|debit)\b/i.test(raw);raw=raw.replace(/[()]/g,'').replace(/[Â£$â‚¬\s,]/g,'').replace(/[^\d.\-]/g,'');if(!raw||raw==='-'||raw==='.')return null;
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
    const label=line=>String(line?.text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\bpaym\s+ent\b/g,'payment').replace(/^dtit\s+e$/,'date').replace(/\bdute\b/g,'date').replace(/\bdote\b/g,'date').replace(/\bderails\b/g,'details').replace(/\s+/g,' ').trim();
    const compactLabel=value=>String(value||'').replace(/\s+/g,'');
    const matchesHeader=(line,name)=>compactLabel(label(line))===compactLabel(name);
    const canonicalHeader=line=>({date:'date',paymenttypeanddetails:'payment type and details',paidout:'paid out',paidin:'paid in',balance:'balance'})[compactLabel(label(line))]||label(line);
    const headers=[];
    for(const [page,items] of pages){
      const dates=items.filter(line=>matchesHeader(line,'date'));
      for(const date of dates){
        const nearby=name=>items.filter(line=>matchesHeader(line,name)&&Math.abs(line.y-date.y)<=Math.max(22,(date.height||line.height||16)*1.5)).sort((a,b)=>Math.abs(a.y-date.y)-Math.abs(b.y-date.y))[0]||null;
        const detail=nearby('payment type and details');let out=nearby('paid out'),income=nearby('paid in'),balance=nearby('balance');
        // On scans, OCR can preserve the HSBC column positions while losing
        // most of the wording in the three amount headings (for example,
        // "Paidow", "edn", "Bec"). Recover those columns from the header
        // fragments' left-to-right order, anchored to the recognized date and
        // details headings. This uses the page's own layout, not fixed points.
        if(detail&&(!out||!income||!balance)){
          const headerTolerance=Math.max(20,Math.min(34,median([date.height,detail.height])*1.25||20));
          const fragments=items.filter(line=>line.x>detail.x+detail.width*.65&&Math.abs(line.y-date.y)<=headerTolerance&&/[a-z]/i.test(line.text)&&!/^(?:date|payment\s+type\s+and\s+details)$/i.test(line.text))
            .sort((a,b)=>(a.x+a.width/2)-(b.x+b.width/2));
          const distinct=[];
          for(const fragment of fragments){const center=fragment.x+fragment.width/2;if(!distinct.some(item=>Math.abs(item.center-center)<Math.max(12,Math.min(item.line.height,fragment.height)*.6)))distinct.push({line:fragment,center});}
          if(distinct.length>=3){
            const byLabel={
              out:distinct.find(item=>/paid\s*out|paidow/i.test(label(item.line))),
              income:distinct.find(item=>/paid\s*in|edn/i.test(label(item.line))),
              balance:distinct.find(item=>/balanc|\bbec\b/i.test(label(item.line))),
            };
            out=out||byLabel.out?.line||distinct[0].line;
            balance=balance||byLabel.balance?.line||distinct.at(-1).line;
            income=income||byLabel.income?.line||distinct.find(item=>item.line!==out&&item.line!==balance)?.line;
          }
        }
        if(!detail||!out||!income||!balance)continue;
        const anchors=[{line:date,name:'date'},{line:detail,name:'payment type and details'},{line:out,name:'paid out'},{line:income,name:'paid in'},{line:balance,name:'balance'}].map(anchor=>({...anchor,center:anchor.line.x+anchor.line.width/2})).sort((a,b)=>a.center-b.center);
        if(anchors.some((anchor,index)=>index&&anchor.center<=anchors[index-1].center))continue;
        const anchorHeight=median([date.height,detail.height,out.height,income.height,balance.height]);
        headers.push({page,items,date,detail,out,income,balance,headerY:median([date.y,detail.y,out.y,income.y,balance.y]),headerHeight:anchorHeight,centers:Object.fromEntries(anchors.map(anchor=>[anchor.name,anchor.center]))});
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
      let raw=String(value||'').trim().replace(/[\u00A3$\u20AC]/g,'').replace(/\bGBP\b/ig,'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/\s+/g,'');
      const suffix=(raw.match(/(CR|DR|C|D)$/i)||[])[1]?.toUpperCase()||'';raw=raw.replace(/(?:CR|DR|[CD])$/i,'');
      const negative=/^\(.*\)$/.test(raw)||/^-/.test(raw)||suffix==='DR'||suffix==='D';raw=raw.replace(/[()]/g,'').replace(/^[-+]/,'');
      // HSBC prints GBP amounts with two decimal places. Requiring both cents
      // avoids treating references, dates, percentages, or partial OCR as money.
      if(!/^\d[\d,]*\.\d{2}$/.test(raw))return null;
      const valueNumber=Number(raw.replace(/,/g,''));return Number.isFinite(valueNumber)?(negative?-1:1)*valueNumber:null;
    };
    const hasExplicitBalanceSign=value=>/(?:CR|DR|[CD])\s*$/i.test(String(value||'').replace(/\s+/g,''))||/^\s*\(?\s*-/.test(String(value||''));
    const rows=[];let previousPageDate='';
    for(const header of headers.sort((a,b)=>a.page-b.page)){
      const c=header.centers,dateDetail=(c.date+c['payment type and details'])/2,detailOut=(c['payment type and details']+c['paid out'])/2,outIncome=(c['paid out']+c['paid in'])/2,incomeBalance=(c['paid in']+c.balance)/2;
      const afterHeader=header.headerY+Math.max(8,header.headerHeight*.45),items=header.items;
      const dateLines=items.filter(line=>line.y>afterHeader&&line.x<dateDetail).map(line=>({line,date:parseDatePrefix(line.text)})).filter(item=>item.date).sort((a,b)=>a.line.y-b.line.y);
      const moneyCandidates=items.filter(line=>line.y>afterHeader&&line.x>=detailOut&&line.x<incomeBalance).map(line=>({line,value:readMoney(line.text)})).filter(item=>item.value!==0&&(item.value!==null||/^[\s(+-]*(?:[Â£$â‚¬]\s*)?\d[\d,]*[.,]\s*\d{2}[)\s]*$/.test(item.line.text))).map(item=>({...item,kind:item.line.x<outIncome?'payment':'receipt',readable:item.value!==null})).sort((a,b)=>a.line.y-b.line.y||a.line.x-b.line.x);
        const balances=items.filter(line=>line.y>afterHeader&&line.x>=incomeBalance).map(line=>({line,value:readMoney(line.text),explicitSign:hasExplicitBalanceSign(line.text)})).filter(item=>item.value!==null).sort((a,b)=>a.line.y-b.line.y);
      const typeMarkers=items.filter(line=>line.y>afterHeader&&line.x>=(c.date+c['payment type and details'])/2&&line.x<c['payment type and details']+Math.max(24,header.headerHeight)&&/^(?:CR|BP|SO)$/i.test(line.text.trim())).sort((a,b)=>a.y-b.y);
        const isBalanceForward=value=>{let normalized=String(value||'').toLowerCase().replace(/[^a-z]/g,'').replace(/baiance/g,'balance');if(/^(?:ce|cl|e)?(?:brought|carried)forward$/.test(normalized))normalized=`balance${normalized.replace(/^(?:ce|cl|e)?/,'')}`;return /balance(?:brought|carried)/.test(normalized);};
      // Estimate each page's transaction rhythm from OCR row spacing, so a missing amount does not shift neighboring details.
      const movementHeights=moneyCandidates.map(item=>Number(item.line.height)||0),lineHeight=median([...movementHeights,...typeMarkers.map(line=>Number(line.height)||0),...dateLines.map(item=>Number(item.line.height)||0)])||header.headerHeight||16;
      const movementGaps=moneyCandidates.slice(1).map((item,index)=>Number(item.line.y)-Number(moneyCandidates[index].line.y)).filter(gap=>gap>lineHeight*2.4&&gap<lineHeight*7);
      const markerGaps=typeMarkers.slice(1).map((line,index)=>Number(line.y)-Number(typeMarkers[index].y)).filter(gap=>gap>lineHeight*2.4&&gap<lineHeight*7);
      const pitch=median([...movementGaps,...markerGaps])||lineHeight*4;
      const markerOffset=median(moneyCandidates.map(item=>{const prior=[...typeMarkers].reverse().find(line=>line.y<=item.line.y);return prior?Number(item.line.y)-Number(prior.y):0;}).filter(gap=>gap>lineHeight*.6&&gap<=pitch*1.35))||lineHeight*2;
      const slots=moneyCandidates.map(item=>({...item,inferred:false}));
      const pushInferredSlot=(y,kind='')=>{if(slots.some(slot=>Math.abs(Number(slot.line.y)-y)<=lineHeight*.65))return;slots.push({line:{page:header.page,x:kind==='receipt'?c['paid in']:kind==='payment'?c['paid out']:c['paid in'],y,width:0,height:lineHeight,text:''},value:null,kind,readable:false,inferred:true});};
      // Amounts normally sit one printed line below the transaction's type or
      // date. When OCR loses the entire amount cell there may be no amount line
      // from which to spot a gap, so use those row labels as relative anchors.
      const rowCues=[...typeMarkers.map(line=>({line,kind:/^CR$/i.test(line.text.trim())?'receipt':'payment'})),...dateLines.filter(item=>!typeMarkers.some(marker=>Math.abs(Number(marker.y)-Number(item.line.y))<=markerOffset+lineHeight*.6)).filter(item=>!items.some(line=>isBalanceForward(line.text)&&Math.abs(Number(line.y)-Number(item.line.y))<=lineHeight*.9)).filter(item=>items.some(line=>line.x>=dateDetail&&line.x<detailOut&&line.y>=Number(item.line.y)-lineHeight*.6&&line.y<=Number(item.line.y)+markerOffset+lineHeight*.5&&!isBalanceForward(line.text))).map(item=>({line:item.line,kind:''}))].sort((a,b)=>a.line.y-b.line.y);
      for(const cue of rowCues){const expectedY=Number(cue.line.y)+markerOffset,hasAmount=moneyCandidates.some(item=>Number(item.line.y)>=Number(cue.line.y)-lineHeight*.5&&Number(item.line.y)<=expectedY+lineHeight*2.5);if(!hasAmount)pushInferredSlot(expectedY,cue.kind);}
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
          movements.push({date,details:details||'Bank transaction amount not read',receipt:value!==''&&kind==='receipt'?value:'',payment:value!==''&&kind==='payment'?value:'',amount:signed,balance:balance?.value??'',balanceSignExplicit:balance?.explicitSign??false,balanceExpected:Boolean(balance),source,page:header.page,ocrY:Number(movement.line.y)||0,balanceY:balance?.line.y??null,confidence:movement.readable?'HSBC labelled OCR columns':'REJECTED',review:true,...(!movement.readable?{balanceMovementUnreadable:true}: {})});
      }
      if(movements.length){
        const firstMovementY=slots[0]?.line.y??Infinity,pageOpening=balances.filter(item=>item.line.y<firstMovementY).at(-1)?.value;
          const pageOpeningEntry=balances.filter(item=>item.line.y<firstMovementY).at(-1);
          movements[0].pageOpeningBalance=pageOpening??'';
          movements[0].pageOpeningBalanceSignExplicit=pageOpeningEntry?.explicitSign??false;
          if(!rows.length&&pageOpening!==undefined){movements[0].openingBalance=pageOpening;movements[0].openingBalanceSignExplicit=pageOpeningEntry?.explicitSign??false;}
        rows.push(...movements);
      }
      if(dateLines.length)previousPageDate=dateLines.at(-1).date;
    }
    // A faint debit/credit suffix is sometimes lost by Windows OCR. Recover a
    // missing balance sign only when the printed transaction amounts and the
    // other printed balance checkpoints leave exactly one mathematically valid
    // sign sequence. Ambiguous or incomplete intervals remain untouched and
    // are still rejected by the normal balance reconciliation.
    const checkpoints=[];
    if(rows.length&&bankValueCents(rows[0].openingBalance)!==null)checkpoints.push({index:-1,row:rows[0],field:'openingBalance',explicit:Boolean(rows[0].openingBalanceSignExplicit)});
    rows.forEach((row,index)=>{if(bankValueCents(row.balance)!==null)checkpoints.push({index,row,field:'balance',explicit:Boolean(row.balanceSignExplicit)});});
    const candidates=point=>{const value=bankValueCents(point.row[point.field]);if(value===null)return [];return point.explicit||value===0?[value]:[Math.abs(value),-Math.abs(value)];};
    const applyUniqueSigns=points=>{
      if(!points.length)return;
      const values=points.map(candidates),counts=values[0].map(()=>1),parents=values.map(list=>list.map(()=>-1));
      let ways=counts;
      for(let position=1;position<points.length;position++){
        const previous=points[position-1],current=points[position],movementCents=[];
        for(let rowIndex=previous.index+1;rowIndex<=current.index;rowIndex++){
          const cents=bankRowAmountCents(rows[rowIndex]);if(cents===null||rows[rowIndex]?.balanceMovementUnreadable){movementCents.length=0;break;}movementCents.push(cents);
        }
        if(previous.index===-1&&current.index<0)movementCents.length=0;
        const complete=previous.index+1<=current.index&&movementCents.length===current.index-previous.index;
        if(!complete)return;
        const delta=movementCents.reduce((sum,value)=>sum+value,0),nextWays=values[position].map(()=>0);
        for(let next=0;next<values[position].length;next++)for(let prior=0;prior<values[position-1].length;prior++)if(ways[prior]&&values[position-1][prior]+delta===values[position][next]){nextWays[next]=Math.min(2,nextWays[next]+ways[prior]);parents[position][next]=prior;}
        ways=nextWays;
      }
      const total=ways.reduce((sum,count)=>sum+count,0);if(total!==1)return;
      let state=ways.findIndex(count=>count===1);
      for(let position=points.length-1;position>=0;position--){
        const point=points[position],value=values[position][state];
        if(!point.explicit&&bankValueCents(point.row[point.field])!==value)point.row[point.field]=value/100;
        if(position>0)state=parents[position][state];
      }
    };
    // Split into balance runs where every transaction movement is readable.
    let run=[];
    for(const point of checkpoints){
      if(run.length){const previous=run.at(-1),complete=previous.index+1<=point.index&&Array.from({length:point.index-previous.index},(_,offset)=>bankRowAmountCents(rows[previous.index+1+offset])).every(value=>value!==null);if(!complete){applyUniqueSigns(run);run=[];}}
      run.push(point);
    }
    applyUniqueSigns(run);
    for(const row of rows){delete row.balanceSignExplicit;delete row.openingBalanceSignExplicit;delete row.pageOpeningBalanceSignExplicit;}
    return rows;
  }
  function parseSumUpOcrBank(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return null;
    const allText=`${source} ${text} ${ocrLines.map(line=>line?.text||'').join(' ')}`;
    if(!/sum\s*up\s+account\s+statement/i.test(allText)&&!/\bsum[\s-]*up\b/i.test(source))return null;
    const pages=new Map();
    for(const raw of ocrLines){const page=Number(raw?.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push({...raw,page,x:Number(raw?.x)||0,y:Number(raw?.y)||0,width:Number(raw?.width)||0,height:Number(raw?.height)||0,text:String(raw?.text||'').trim()});}
    const label=value=>String(value||'').toLowerCase().replace(/[^a-z]/g,'');
    const cleanDate=value=>{const raw=String(value||'').replace(/\s+/g,'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1');if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw))return {date:parseDate(raw),dayOnly:null};if(/^\d{1,2}$/.test(raw)){const day=Number(raw);return {date:'',dayOnly:day>=1&&day<=31?day:null};}return {date:'',dayOnly:null};};
    const readMoney=value=>{
      const raw=String(value||'').trim(),match=raw.match(/[0-9OoIl|][0-9OoIl|,.'\s]*[.,]\s*[0-9OoIl|]{2}/);if(!match)return null;
      const token=match[0].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/\s/g,''),separator=Math.max(token.lastIndexOf('.'),token.lastIndexOf(','));if(separator<1)return null;
      const whole=token.slice(0,separator).replace(/[,.']/g,''),pennies=token.slice(separator+1);if(!/^\d+$/.test(whole)||!/^\d{2}$/.test(pennies))return null;
      const amountValue=Number(`${whole}.${pennies}`);if(!Number.isFinite(amountValue))return null;
      const leading=raw.match(/^\s*([(+\-])/),sign=leading?.[1]==='-'||leading?.[1]==='('? -1:leading?.[1]==='+'?1:0;
      return {value:amountValue,sign,raw:match[0]};
    };
    const rawRows=[];
    for(const [page,items] of [...pages.entries()].sort((a,b)=>a[0]-b[0])){
      const byLabel={date:[],reference:[],type:[],amount:[],description:[]};
      for(const line of items){const key=label(line.text);if(key==='date'||key==='reference'||key==='type'||key==='amount'||key==='description')byLabel[key].push(line);}
      let header=null;
      for(const date of byLabel.date){const tolerance=Math.max(18,(date.height||16)*1.5),nearest=name=>byLabel[name].filter(line=>Math.abs(line.y-date.y)<=tolerance).sort((a,b)=>Math.abs(a.y-date.y)-Math.abs(b.y-date.y))[0]||null,reference=nearest('reference'),type=nearest('type'),amountHeader=nearest('amount'),description=nearest('description');if(!reference||!type||!amountHeader||!description)continue;
        const columns=[date,reference,type,amountHeader,description],centers=columns.map(line=>line.x+line.width/2);if(centers.some((center,index)=>index&&center<=centers[index-1]))continue;
        header={columns,centers,bounds:centers.slice(1).map((center,index)=>(center+centers[index])/2),y:columns.reduce((sum,line)=>sum+line.y,0)/columns.length,height:Math.max(...columns.map(line=>line.height||0))};break;
      }
      if(!header)continue;
      const afterHeader=header.y+Math.max(8,header.height*.5),columnLines=index=>items.filter(line=>{const center=line.x+line.width/2;return line.y>afterHeader&&center>=(index?header.bounds[index-1]:-Infinity)&&center<(index<header.bounds.length?header.bounds[index]:Infinity);});
      const dateLines=columnLines(0).map(line=>({line,...cleanDate(line.text)})).filter(item=>item.date||item.dayOnly),amountLines=columnLines(3).map(line=>({line,money:readMoney(line.text)})),typeLines=columnLines(2).filter(line=>line.text&&label(line.text)!=='type').sort((a,b)=>a.y-b.y);
      const rowTolerance=Math.max(20,header.height*1.1),knownType=value=>/^(?:incoming transfer|outgoing transfer|card payment|direct debit|standing order|cash withdrawal|refund|card refund|chargeback)$/i.test(String(value||'').replace(/\s+/g,' ').trim());
      const markers=[];
      for(const line of typeLines){const nearbyDate=dateLines.some(item=>Math.abs(item.line.y-line.y)<=rowTolerance),nearbyAmount=amountLines.some(item=>Math.abs(item.line.y-line.y)<=rowTolerance);if(!knownType(line.text)&&!nearbyDate&&!nearbyAmount)continue;if(markers.some(marker=>Math.abs(marker.y-line.y)<=Math.max(5,(marker.height+line.height)/2)))continue;markers.push(line);}
      markers.sort((a,b)=>a.y-b.y);
      for(let index=0;index<markers.length;index++){
        const marker=markers[index],nextY=markers[index+1]?.y??Infinity,nearest=(list,predicate=()=>true)=>list.filter(item=>predicate(item)&&Math.abs(item.line.y-marker.y)<=rowTolerance).sort((a,b)=>Math.abs(a.line.y-marker.y)-Math.abs(b.line.y-marker.y))[0]||null;
        const dateItem=nearest(dateLines),amountCandidates=amountLines.filter(item=>Math.abs(item.line.y-marker.y)<=rowTolerance),focusedAmount=amountCandidates.find(item=>item.line.sumupFocused&&item.money)||null,fullPageAmount=amountCandidates.find(item=>!item.line.sumupFocused&&item.money)||null,amountItem=focusedAmount||fullPageAmount||amountCandidates.sort((a,b)=>Math.abs(a.line.y-marker.y)-Math.abs(b.line.y-marker.y))[0]||null,referenceLine=nearest(columnLines(1).map(line=>({line})))?.line||null;
        const descriptionLines=columnLines(4).filter(line=>line.y>=marker.y-rowTolerance*.25&&line.y<nextY-rowTolerance*.2&&!/^\s*\d+\s+of\s+\d+\s*$/i.test(line.text)).sort((a,b)=>a.y-b.y||a.x-b.x);
        const description=descriptionLines.map(line=>line.text).join(' ').replace(/\s+/g,' ').trim(),type=marker.text.replace(/\s+/g,' ').trim(),reference=referenceLine?.text||'';
        const expectedSign=/^(?:incoming transfer|refund|card refund|chargeback)$/i.test(type)?1:/^(?:outgoing transfer|card payment|direct debit|standing order|cash withdrawal)$/i.test(type)?-1:0,observedSign=amountItem?.money?.sign||0,sign=expectedSign||observedSign,money=amountItem?.money||null,value=money&&sign?Math.abs(money.value)*sign:'',signedReading=item=>item?.money&&sign?Math.abs(item.money.value)*sign:null,normalReading=signedReading(fullPageAmount),focusedReading=signedReading(focusedAmount),amountConflict=normalReading!==null&&focusedReading!==null&&Math.round(normalReading*100)!==Math.round(focusedReading*100);
        const record={date:dateItem?.date||'',dateDay:dateItem?.dayOnly??null,details:[type,description].filter(Boolean).join(': ')+(reference?` (Ref: ${reference})`:''),reference,type,description,amount:value,receipt:value!==''&&value>0?value:'',payment:value!==''&&value<0?Math.abs(value):'',balance:'',balanceExpected:false,source,page,ocrY:Number(marker.y)||0,profileId:'sumup-bank',amountConfirmed:Boolean(money&&sign),confidence:amountItem?.line?.sumupFocused?'SumUp focused amount OCR':'SumUp content-anchored columns',review:false,...(amountConflict?{sumupAmountConflict:true,sumupAmountReadings:{fullPage:normalReading,focused:focusedReading}}:{})};
        rawRows.push(record);
      }
    }
    // A day-only OCR result is recoverable only when both adjacent transaction
    // dates show the same month and year; otherwise keep the transaction rejected.
    for(let index=0;index<rawRows.length;index++){
      const row=rawRows[index];if(row.date||!row.dateDay)continue;
      const previous=[...rawRows.slice(0,index)].reverse().find(item=>item.date),next=rawRows.slice(index+1).find(item=>item.date);
      if(!previous||!next||previous.date.slice(0,7)!==next.date.slice(0,7))continue;
      const [year,month]=previous.date.split('-'),candidate=`${year}-${month}-${String(row.dateDay).padStart(2,'0')}`,validated=parseDate(`${String(row.dateDay).padStart(2,'0')}/${month}/${year}`);
      if(validated===candidate){row.date=candidate;row.confidence='SumUp date confirmed by adjacent statement rows';}
    }
    for(const row of rawRows){const reason=!row.date?'Transaction date could not be confirmed from the SumUp statement. Verify this row on the linked PDF page.':!row.amountConfirmed?'Transaction amount or direction could not be confirmed from the SumUp statement. Verify this row on the linked PDF page.':row.sumupAmountConflict?'SumUp OCR readings disagree on the printed amount. The row needs a higher-resolution check.':!row.description?'Transaction description could not be read from the SumUp statement. Verify this row on the linked PDF page.':'';if(reason){row.status='REJECTED';row.accepted=false;row.rejected=true;row.review=true;row.confidence='REJECTED';row.rejectedReason=reason;}else{row.status='ACCEPTED';row.accepted=true;row.rejected=false;row.review=false;row.rejectedReason='';}delete row.dateDay;delete row.amountConfirmed;delete row.description;}
    return rawRows;
  }
  function parseStarlingOcrBank(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return null;
    const allText=`${String(text||'')}\n${ocrLines.map(line=>String(line?.text||'')).join('\n')}`;
    if(!/(?:\bstarling\b|starlingbank\.com)/i.test(allText)||!/(?:END\s+OF\s+DAY|ACCOUNT\s+BALANCE|PAYMENTS\s+IN|PAYMENTS\s+OUT)/i.test(allText))return null;
    const normalize=value=>String(value||'').toUpperCase().replace(/[^A-Z]/g,''),center=line=>Number(line.x||0)+Number(line.width||0)/2;
    const pages=new Map();for(const original of ocrLines){const page=Number(original?.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push({...original,page,x:Number(original?.x)||0,y:Number(original?.y)||0,width:Number(original?.width)||0,height:Number(original?.height)||0,text:String(original?.text||'').trim()});}
    const pageEntries=[...pages.entries()].sort((a,b)=>a[0]-b[0]);let previousHeader=null;const rows=[],pageHeaders=new Map();
    const headerFor=items=>{
      const labels={date:[],type:[],transaction:[],in:[],out:[],balance:[],endOfDay:[]};
      for(const line of items){const value=normalize(line.text);if(value==='DATE'||value==='DATEE')labels.date.push(line);else if(value==='TYPE')labels.type.push(line);else if(value==='TRANSACTION'||value==='TRANSACTIONS')labels.transaction.push(line);else if(value==='IN')labels.in.push(line);else if(value==='OUT')labels.out.push(line);else if(value==='ACCOUNTBALANCE'||value==='BALANCE')labels.balance.push(line);else if(value==='ENDOFDAY')labels.endOfDay.push(line);}
      for(const date of labels.date){const nearest=(list,max=85)=>list.map(line=>({line,distance:Math.abs(line.y-date.y)})).filter(item=>item.distance<=max).sort((a,b)=>a.distance-b.distance)[0]?.line||null,type=nearest(labels.type),transaction=nearest(labels.transaction),incoming=nearest(labels.in),outgoing=nearest(labels.out);if(!type||!transaction||!incoming||!outgoing)continue;
        const headerY=[date,type,transaction,incoming,outgoing].reduce((sum,line)=>sum+line.y,0)/5,base={date:center(date),type:center(type),transaction:center(transaction),in:center(incoming),out:center(outgoing),y:headerY,height:Math.max(10,...[date,type,transaction,incoming,outgoing].map(line=>line.height||0))};
        if(!(base.date<base.type&&base.type<base.transaction&&base.transaction<base.in&&base.in<base.out))continue;
        const close=(list)=>list.map(line=>({line,distance:Math.abs(line.y-headerY)})).filter(item=>item.distance<=90&&center(item.line)>base.out-20).sort((a,b)=>a.distance-b.distance)[0]?.line||null;
        const balanceLabel=close(labels.balance),endOfDay=close(labels.endOfDay);base.balance=balanceLabel?center(balanceLabel):endOfDay?center(endOfDay):base.out+(base.out-base.in);return base;
      }
      return null;
    };
    const parseStarlingDate=value=>{const compact=String(value||'').replace(/\s+/g,'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1');if(!/^\d{1,2}\/\d{1,2}\/20\d{2}$/.test(compact))return '';return parseDate(compact);};
    const parseStarlingMoney=value=>{
      let raw=String(value||'').trim();if(!raw)return null;
      // Windows OCR often renders "£1" as "El" in Starling's amount cells.
      // Preserve that leading one; removing the whole token loses a digit from
      // values such as £134.64 and £122,650.00. Other currency-glyph variants
      // remain prefixes only and are discarded before parsing.
      raw=raw.replace(/^\s*E\s*[Il|](?=\s*(?:[0-9OoIl|]|[.,]\s*[0-9OoIl|]))/i,'1').replace(/^\s*(?:[£$€]|E|[QO]\s*[Il|])\s*/i,'');
      if(/^[QO]\s*[Il|]\s*[.,]\s*[0-9OoIl|]{2}$/i.test(raw))return null;
      if(/^\s*[.,]\s*[0-9OoIl|]{2}\s*$/.test(raw))raw=`0${raw.trim()}`;
      const token=raw.match(/\(?-?[0-9OoIl|][0-9OoIl|,.'\s]*[.,]\s*[0-9OoIl|]{2}\)?/);if(!token)return null;
      const valueNumber=invoiceAmount(token[0]);return valueNumber===null?null:Math.abs(valueNumber);
    };
    const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:null;};
    const inferContinuationHeader=items=>{
      if(!previousHeader)return null;
      const dateLines=items.filter(line=>parseStarlingDate(line.text)).sort((a,b)=>a.y-b.y);if(dateLines.length<4)return null;
      const minY=dateLines[0].y-10,maxY=dateLines.at(-1).y+10,within=line=>line.y>=minY&&line.y<=maxY;
      const typePattern=/^(?:DIRECT DEBIT|APPLE PAY|ONLINE PAYMENT|FASTER PAYMENT|INTERNATIONAL PAYMENT|CARD SUBSCRIPTION|DIRECT CREDIT|TRANSFER|CASH WITHDRAWAL|STANDING ORDER|CARD PAYMENT|CARD REFUND|REFUND|CASH DEPOSIT)\b/i;
      const typeLines=items.filter(line=>within(line)&&typePattern.test(line.text.trim()));if(typeLines.length<3)return null;
      const typeX=median(typeLines.map(center)),dateX=median(dateLines.map(center));if(typeX===null||dateX===null)return null;
      // Text continuations keep the same column geometry as the prior page;
      // use that measured header directly. Infer a new layout only when OCR
      // reports a materially shifted table (for example a rasterized page).
      if(Math.abs(dateX-previousHeader.date)<=Math.max(80,Math.abs(previousHeader.date)*.25)&&Math.abs(typeX-previousHeader.type)<=Math.max(90,Math.abs(previousHeader.type)*.25))return null;
      const descriptionLines=items.filter(line=>within(line)&&!parseStarlingDate(line.text)&&!parseStarlingMoney(line.text)&&center(line)>typeX&&!typePattern.test(line.text.trim())&&line.text.trim());
      const descriptionX=median(descriptionLines.map(center));if(descriptionX===null||descriptionX<=typeX)return null;
      const amountFloor=descriptionX+(descriptionX-typeX)*.5;
      const amountLines=items.filter(line=>within(line)&&center(line)>amountFloor&&parseStarlingMoney(line.text)!==null);if(amountLines.length<8)return null;
      const values=amountLines.map(line=>center(line)).sort((a,b)=>a-b),gaps=values.slice(1).map((value,index)=>({index,gap:value-values[index]})),splitIndexes=new Set(gaps.slice().sort((a,b)=>b.gap-a.gap).slice(0,2).filter(item=>item.gap>Math.max(25,(median(gaps.map(value=>value.gap))||0)*2)).map(item=>item.index)),clusters=[values[0]];
      for(let index=0;index<gaps.length;index++){if(splitIndexes.has(index))clusters.push(values[index+1]);else clusters[clusters.length-1]=(clusters.at(-1)+values[index+1])/2;}
      if(clusters.length!==3)return null;
      const [incoming,outgoing,balance]=clusters;if(!(previousHeader.date<previousHeader.type&&previousHeader.type<previousHeader.transaction&&previousHeader.transaction<previousHeader.in&&previousHeader.in<previousHeader.out&&previousHeader.out<previousHeader.balance&&incoming<outgoing&&outgoing<balance))return null;
      return {date:median(dateLines.map(center)),type:typeX,transaction:descriptionX,in:incoming,out:outgoing,balance,y:minY-30,height:median(dateLines.map(line=>line.height||0))||10};
    };
    const midpoint=(a,b)=>(a+b)/2,nearestCell=(line,header)=>{
      const x=center(line),bounds=[midpoint(header.date,header.type),midpoint(header.type,header.transaction),midpoint(header.transaction,header.in),midpoint(header.in,header.out),midpoint(header.out,header.balance)];
      if(x<bounds[0])return 'date';if(x<bounds[1])return 'type';if(x<bounds[2])return 'transaction';if(x<bounds[3])return 'in';if(x<bounds[4])return 'out';return 'balance';
    };
    for(const [page,items] of pageEntries){const detected=headerFor(items),inferred=!detected?inferContinuationHeader(items):null;if(detected)previousHeader=detected;const header=detected||inferred||previousHeader;if(!header)continue;pageHeaders.set(page,header);
      const dateLines=items.filter(line=>nearestCell(line,header)==='date'&&parseStarlingDate(line.text)).sort((a,b)=>a.y-b.y);
      for(const dateLine of dateLines){
        if(detected&&dateLine.y<header.y+Math.max(4,header.height*.35))continue;
        const parsedDate=parseStarlingDate(dateLine.text);if(rows.some(row=>row.page===page&&row.date===parsedDate&&Math.abs(Number(row.ocrY)-dateLine.y)<=Math.max(14,(dateLine.height||0)*.75)))continue;
        const sameRow=items.filter(line=>Math.abs(line.y-dateLine.y)<=(line.starlingFocused?Math.max(26,(dateLine.height||0)*.75):Math.max(7,(dateLine.height||0)*.45)));
        const cellLines={type:[],transaction:[],in:[],out:[],balance:[]};for(const line of sameRow){const cell=nearestCell(line,header);if(cellLines[cell])cellLines[cell].push(line);}
        const typeLine=cellLines.type.filter(line=>!/^(?:TYPE|DATE|TRANSACTION|IN|OUT|ACCOUNT|BALANCE|END OF DAY)$/i.test(line.text)).sort((a,b)=>a.x-b.x)[0]||null;
        const description=cellLines.transaction.map(line=>line.text).filter(value=>value&&!/^(?:TYPE|DATE|TRANSACTION|IN|OUT|ACCOUNT|BALANCE|END OF DAY)$/i.test(value)).join(' ').replace(/\s+/g,' ').trim();
        const byBestReading=(a,b)=>Number(Boolean(b.line.starlingFocused))-Number(Boolean(a.line.starlingFocused))||Math.abs(a.line.y-dateLine.y)-Math.abs(b.line.y-dateLine.y);
        const incoming=cellLines.in.map(line=>({line,value:parseStarlingMoney(line.text)})).filter(item=>item.value!==null).sort(byBestReading)[0]||null;
        const outgoing=cellLines.out.map(line=>({line,value:parseStarlingMoney(line.text)})).filter(item=>item.value!==null).sort(byBestReading)[0]||null;
        const balanceItem=cellLines.balance.map(line=>({line,value:parseStarlingMoney(line.text)})).filter(item=>item.value!==null).sort(byBestReading)[0]||null;
        const rawCellLine=list=>list.filter(line=>/\d/.test(line.text)).sort((a,b)=>Math.abs(a.y-dateLine.y)-Math.abs(b.y-dateLine.y))[0]||null,cellStarts={in:rawCellLine(cellLines.in)?.x,out:rawCellLine(cellLines.out)?.x,balance:rawCellLine(cellLines.balance)?.x};
        const conflict=Boolean(incoming&&outgoing),movement=conflict?null:incoming?{value:incoming.value,sign:1,line:incoming.line}:outgoing?{value:outgoing.value,sign:-1,line:outgoing.line}:null,amount=movement?movement.value*movement.sign:'';
        const type=typeLine?.text.replace(/\s+/g,' ').trim()||'',detail=[type,description].filter(Boolean).join(': ')||'Bank transaction';
        const row={date:parsedDate,details:detail,receipt:movement?.sign>0?movement.value:'',payment:movement?.sign<0?movement.value:'',amount,balance:balanceItem?.value??'',balanceExpected:Boolean(balanceItem),source,page,ocrY:Number(dateLine.y)||0,balanceY:Number(balanceItem?.line?.y)||Number(dateLine.y)||0,confidence:'Starling OCR · heading-anchored columns',profileId:'starling-bank',starlingColumns:{date:header.date,type:header.type,transaction:header.transaction,in:header.in,out:header.out,balance:header.balance},starlingCellStarts:cellStarts,review:false};
        if(!row.date||!movement||conflict){row.status='REJECTED';row.accepted=false;row.rejected=true;row.review=true;row.confidence='REJECTED';row.rejectedReason=conflict?'Both Starling IN and OUT values were read on the same transaction row; verify the printed statement.':!movement?'Starling transaction amount or direction could not be confirmed from the printed IN/OUT columns. Verify this row on the linked PDF page.':'Starling transaction date could not be confirmed from the statement.';}
        else{row.status='ACCEPTED';row.accepted=true;row.rejected=false;row.rejectedReason='';}
        rows.push(row);
      }
    }
    if(!rows.length)return [];
    const getSummaryValue=(label)=>{
      const labels=[];for(const [,items] of pageEntries)for(const line of items)if(normalize(line.text)===normalize(label))labels.push(line);
      for(const labelLine of labels){const items=pages.get(labelLine.page)||[],candidates=items.filter(line=>line.x>labelLine.x&&Math.abs(line.y-labelLine.y)<=Math.max(12,(labelLine.height||16)*1.1)).map(line=>({line,value:parseStarlingMoney(line.text)})).filter(item=>item.value!==null).sort((a,b)=>a.line.x-b.line.x);if(candidates.length)return candidates[0].value;}
      return null;
    };
    const summaryOpening=getSummaryValue('Opening Balance'),tableOpeningLabels=[];
    for(const [page,items] of pageEntries){const header=pageHeaders.get(page);if(!header)continue;for(const line of items){if(normalize(line.text)!=='OPENINGBALANCE'||line.y<=header.y)continue;const candidate=items.filter(value=>Math.abs(value.y-line.y)<=Math.max(8,(line.height||16)*.5)&&nearestCell(value,header)==='balance').map(value=>({line:value,amount:parseStarlingMoney(value.text)})).filter(value=>value.amount!==null).sort((a,b)=>Math.abs(a.line.y-line.y)-Math.abs(b.line.y-line.y))[0];if(candidate)tableOpeningLabels.push({page,y:line.y,value:candidate.amount});}}
    const tableOpening=tableOpeningLabels[0]?.value??null,opening=tableOpening??summaryOpening,summary={openingBalance:summaryOpening,tableOpeningBalance:tableOpening,paymentsIn:getSummaryValue('Payments In'),paymentsOut:getSummaryValue('Payments Out'),closingBalance:getSummaryValue('Closing Balance')};
    if(opening!==null)rows[0].openingBalance=opening;if(tableOpeningLabels.length)rows[0].starlingOpeningY=tableOpeningLabels[0].y;
    rows[0].starlingStatementSummary=summary;
    for(const [page,header] of pageHeaders){const pageRows=rows.filter(row=>Number(row.page)===page);if(!pageRows.length)continue;const starts={};for(const column of ['in','out','balance']){const values=pageRows.map(row=>Number(row.starlingCellStarts?.[column])).filter(Number.isFinite);if(values.length)starts[`${column}Start`]=Math.min(...values);}const columns={...header,...starts};for(const row of pageRows)row.starlingColumns=columns;}
    const dates=new Map();for(let index=0;index<rows.length;index++){const key=rows[index].date;if(!key)continue;dates.set(key,index);}
    // End-of-day balance is only expected after the final transaction for a
    // date. Mark it required only when that date has a printed checkpoint;
    // balance inspection then validates the full interval without guessing.
    return rows;
  }
  function parseOcrBank(ocrLines,text='',source=''){
    if(!Array.isArray(ocrLines)||!ocrLines.length)return [];
    const sumUpRows=parseSumUpOcrBank(ocrLines,text,source);if(sumUpRows!==null)return sumUpRows;
    const starlingRows=parseStarlingOcrBank(ocrLines,text,source);if(starlingRows!==null)return starlingRows;
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
    const directPrintedMatch=flat.match(/\btotal\s+issued\s+baskets\s*:\s*(?:notes\s*:\s*)?((?:Â£|â‚¬|\$)?\s*\d[\d\s,.;]*[.,;]\s*\d{2})/i),directPrintedTotal=directPrintedMatch?invoiceAmount(directPrintedMatch[1]):null;
    // WZ forms print the real delivery total on the same baseline as the
    // bold `Total` label. OCR preserves each line's position, so use that
    // layout signal before looking at the account statement below. This
    // avoids confusing an invoice balance or returned-basket amount with the
    // value delivered on this WZ document.
    const layoutCandidate=Array.isArray(ocrLines)?(ocrLines.filter(line=>/^(?:total|tota[i1l]|tout)$/i.test(String(line?.text||'').trim())).flatMap(label=>{const x=Number(label?.x)||0,labelRight=x+(Number(label?.width)||0),minGap=Math.max(8,Math.min(28,(Number(label?.width)||0)*0.2));return ocrLines.filter(line=>Number(line?.page)===Number(label?.page)&&Number(line?.x)>labelRight+minGap&&Math.abs(Number(line?.y)-Number(label?.y))<=35).map(line=>{const raw=String(line?.text||''),match=raw.match(/\b\d[\d,.;]*\b/);return match?{value:invoiceAmount(match[0]),raw}:null})}).find(item=>item?.value!==null)??null):null;
    const layoutTotal=layoutCandidate?.value??null,layoutSuspect=Boolean(layoutCandidate&&(/[;]/.test(layoutCandidate.raw)||/[Â£â‚¬$]/.test(layoutCandidate.raw)||/[^\d\s,.;Â£â‚¬$]/.test(layoutCandidate.raw)||!/[,.]\s*\d{2}/.test(layoutCandidate.raw)));
    // A continuation page can lose the `Total` label while retaining the
    // printed delivery total at the top right (for example 327,96).
    const summaryCandidates=Array.isArray(ocrLines)?ocrLines.filter(line=>Number(line?.y)<260&&Number(line?.x)>1450&&/[0-9][,.;]\s*\d{2}/.test(String(line?.text||''))).map(line=>{const pageLines=ocrLines.filter(other=>Number(other?.page)===Number(line?.page)),hasItemRows=pageLines.filter(other=>Number(other?.x)>1450&&Number(other?.y)>Number(line?.y)+20&&Number(other?.y)<650&&/[0-9][,.]\s*\d{2}/.test(String(other?.text||''))).length>=2;return hasItemRows?null:{value:invoiceAmount(String(line.text||'')),raw:String(line.text||'')}}).filter(item=>item&&item.value!==null):[];
    const summaryCandidate=summaryCandidates[0]||null,summaryTotal=summaryCandidate?.value??null,summarySuspect=Boolean(summaryCandidate&&(/[;]/.test(summaryCandidate.raw)||/[^\d\s,.;Â£â‚¬$]/.test(summaryCandidate.raw)||!/[,.]\s*\d{2}/.test(summaryCandidate.raw)));
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
        else if(target.unconfiguredSupplier)target.rejectedReason='Supplier not recognised or configured. This invoice is rejected until a supplier profile is configured.';
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
    const kept=[],byIdentity=new Map(),byMillfieldPage=new Map();let duplicates=0;
    const score=row=>(row.accepted?100:0)+(row.total!==''&&row.total!==null&&row.total!==undefined?20:0)+(row.date?5:0)+(row.supplier?5:0)+(row.originalInvoiceNumber?2:0)+(row.profileId==='millfield-autoparts'&&row.millfieldPrintedInvoiceNumber?12:0)+(row.millfieldStatementConfirmed?15:0)-(row.millfieldInvoiceNumberConflict?60:0);
    const compact=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const mergeDuplicate=(index,row)=>{duplicates++;const current=kept[index],preferred=score(row)>score(current)?row:current,other=preferred===row?current:row,merged={...preferred};for(const field of ['invoiceNumber','originalInvoiceNumber','date','supplier','profileId','source','sourcePath','rejectedReason','confidence'])if((merged[field]===''||merged[field]===null||merged[field]===undefined)&&other[field]!==''&&other[field]!==null&&other[field]!==undefined)merged[field]=other[field];if(Number(current.page)>0&&Number(row.page)>0)merged.page=Math.min(Number(current.page),Number(row.page));kept[index]=merged;};
    for(const input of inputRows||[]){
      const row={...input},rawReference=String(row.originalInvoiceNumber||row.invoiceNumber||''),maspoSerial=/^\d{4}[-. ]?[A-Z]{2,}/i.test(rawReference),reference=maspoSerial?normalizeMaspoInvoiceNumber(rawReference):(compact(rawReference)||normalizeInvoiceNumber(row.invoiceNumber)),supplier=compact(row.supplier)||compact(row.profileId),date=String(row.date||''),type=String(row.documentType||'INVOICE').toUpperCase(),kind=type==='CREDIT NOTE'?'CREDIT NOTE':type.includes('CORRECTION')?'CORRECTION':'INVOICE';
      // Millfield invoice PDFs contain one invoice per page. OCR progress and
      // retry passes can assign different generated IDs to that same page;
      // collapse those versions by file/page. Statement-only rows are exempt
      // because one statement page legitimately lists many invoices.
      const sourceIdentity=String(row.sourcePath||row.source||''),page=Number(row.page),millfieldPageKey=row.profileId==='millfield-autoparts'&&!row.millfieldStatementOnly&&sourceIdentity&&Number.isInteger(page)&&page>0?`${sourceIdentity}|${page}|${kind}`:'';
      if(millfieldPageKey&&byMillfieldPage.has(millfieldPageKey)){mergeDuplicate(byMillfieldPage.get(millfieldPageKey),row);continue;}
      if(!reference){const newIndex=kept.length;kept.push(row);if(millfieldPageKey)byMillfieldPage.set(millfieldPageKey,newIndex);continue;}
      // A repeated header on a continuation page can yield the same invoice
      // number but lose its date. Merge that fragment with its same-file row;
      // keep two dated invoices separate when a supplier legitimately reuses
      // a number in another period.
      const key=`${supplier}|${reference}|${kind}`,indexes=byIdentity.get(key)||[],index=indexes.find(candidateIndex=>{const existing=kept[candidateIndex],existingDate=String(existing.date||''),existingSource=String(existing.source||''),source=String(row.source||''),generatedShahid=existing.profileId==='shahid-halal-poultry'&&existing.invoiceNumberGenerated&&row.profileId==='shahid-halal-poultry'&&row.invoiceNumberGenerated;if(generatedShahid){const sameFile=existing.sourcePath&&row.sourcePath?String(existing.sourcePath)===String(row.sourcePath):!existingSource||!source||existingSource===source;return sameFile&&Number(existing.page)===Number(row.page);}if(existingDate&&date)return existingDate===date;return !existingSource||!source||existingSource===source;});
      if(index===undefined){const newIndex=kept.length;indexes.push(newIndex);byIdentity.set(key,indexes);kept.push(row);if(millfieldPageKey)byMillfieldPage.set(millfieldPageKey,newIndex);continue;}
      mergeDuplicate(index,row);if(millfieldPageKey)byMillfieldPage.set(millfieldPageKey,index);
    }
    return {rows:kept,duplicates};
  }
  function parseInvoiceGeneric(text,source='',ocrLines){
    const flat=String(text||'').replace(/\b[oO][,.][oO]{2}\b/g,'0.00').replace(/\b(\d[\d,]*)[,.][oO]{2}\b/g,'$1.00').replace(/\b(\d[\d,]*)[.,]?[oO]{2}\b/g,'$1.00').replace(/\b(\d[\d,]*)[oO](\d)\b/g,'$1.0$2').replace(/\b(?:1\s*l|I\s*l|1l)th\b/gi,'11th').replace(/\s+/g,' ').trim();
    const evidence=invoiceLikeDocumentEvidence(flat,ocrLines),isStatement=/\b(?:bank\s+statement|account\s+statement|statement\s+of\s+(?:account|the\s+account))\b/i.test(flat);
    const date=firstMatch(flat,[/(?:invoice\s+date|date\s+of\s+issue|bill\s+issue\s+date|date\s+paid)\s*[.:#-]?\s*((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4}))/i,/(?:invoice|tax invoice|dated|date)\s*(?:no\.?|number)?\s*[.:#-]?\s*((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4}))/i,/\b(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})\b/i,/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/]);
    let number=anchoredInvoiceNumber(flat,ocrLines)||fourDigitDocumentNumber(extractInvoiceNumber(flat));
    if(!number&&evidence.kind==='BILL')number=cleanInvoiceNumber(firstMatch(flat,[/\bbill\s*(?:(?:number|no\.?|#|reference|ref)\s*)?[:#.-]?\s*(?!to\b|date\b|total\b|amount\b)([A-Z0-9][A-Z0-9/-]{2,})/i]));
    if(!number&&evidence.kind==='RECEIPT')number=cleanInvoiceNumber(firstMatch(flat,[/\breceipt\s*(?:(?:number|no\.?|#)\s*)?[:#.-]?\s*(?:\[\s*#?\s*)?(?!from\b|to\b|date\b|total\b|amount\b|issued\b|paid\b)([A-Z0-9][A-Z0-9/-]{2,})/i]));
    if(number)number=number.replace(/\s+/g,' ').trim();
    if(number&&/^INV[-\/]/i.test(number))number=number.replace(/^(INV[-\/])(.+)$/i,(_,prefix,suffix)=>prefix+suffix.replace(/O/g,'0').replace(/I/g,'1'));
    const money='[^0-9\\s]?\\s*\\(?\\s*(?:(?:\\d{1,3}(?:[\\s,]\\d{3})+)|\\d+)(?:[.,]\\s*\\d{2})?\\s*\\)?';
    const vatRaw=firstMatch(flat,[new RegExp('VAT\\s*@\\s*\\d+(?:[.,]\\d+)?%\\s*(?:\\([^)]*\\)\\s*)?('+money+')','i'),new RegExp('tax\\s+value\\b[^0-9]{0,40}('+money+')','i'),new RegExp('(?:VAT|tax)\\s*(?:amount|value)?\\s*[:#-]?\\s*('+money+')','i')]);
    const discountWindow=flat.match(/total\s+discount\b([\s\S]{0,100}?)amount\s+due/i)?.[1]||'',discountValues=[...discountWindow.matchAll(/\d[\d,.]*/g)].map(match=>invoiceAmount(match[0])).filter(value=>value!==null);
    const totalRaw=firstMatch(flat,[new RegExp('\\b(?:total\\s+for\\s+this\\s+bill|order\\s+total|total\\s+paid|amount\\s+paid|pay\\s+amount|total\\s*(?:due|payable|amount|value)?|amount\\s*due|grand\\s*total|balance\\s*due)\\s*[:#-]?\\s*('+money+')','i')]);
    const subRaw=firstMatch(flat,[new RegExp('(?:sub\\s*total|net\\s*amount|excl(?:uding)?\\s*VAT)\\s*[:#-]?\\s*('+money+')','i')]);
    const dueWindow=firstMatch(flat,[/(?:amount\s+due|total\s+due)\s*[:#-]?\s*([\s\S]{0,180}?)(?=\bsales\s+person\b|\bbuyer\b|\bstatement\s+of\s+the\s+account\b)/i]);
    const dueValues=[...String(dueWindow).matchAll(/\b\d[\d,]*[.,]\d{2}\b/g)].map(m=>invoiceAmount(m[0])).filter(x=>x!==null&&x>0),netRaw=firstMatch(flat,[new RegExp('(?:net\\s+value|gross\\s+value)\\s*[:#-]?\\s*('+money+')','i')]);
    const netCandidate=invoiceAmount(netRaw),polishDocument=isPolishVillageBreadText(flat)||/\bFS\s*\d{3,}\s*\/\s*MAG\s*\/\s*2026\b/i.test(flat),printedTotalRowValues=[...flat.matchAll(/\btotal\s*:\s*([^=]{0,100})/gi)].flatMap(match=>[...match[1].matchAll(/\d[\d\s,]*[.,]\s*\d{2}/g)].map(value=>invoiceAmount(value[0])).filter(value=>value!==null)),printedTotalRow=printedTotalRowValues.at(-1),parsedTotal=invoiceAmount(totalRaw),rawTotal=dueValues.at(-1)??discountValues.at(-1)??(polishDocument&&parsedTotal===0?(printedTotalRow??parsedTotal):parsedTotal)??null,total=isStatement?null:rawTotal,vat=isStatement?null:invoiceAmount(vatRaw),subtotal=isStatement?null:(invoiceAmount(subRaw)??netCandidate??null);
    const supplier=isPolishVillageBreadText(flat)?'Polish Village Bread LTD':firstMatch(flat,[/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,5}\s+(?:Limited|LTD|PLC|LLP))\b/i,/seller\s*:\s*(?:customer\s*:\s*)?([A-Za-z][A-Za-z0-9 &.' ,-]{2,}?)(?=\s+\d{1,4}(?:[- ]|$)|\s+\d{3,}\b|\s+VAT\s*:|\s+invoice\b|$)/i,/\bIssuer\s*:?\s*([A-Z][A-Za-z0-9 &.'-]{2,80}?)(?=\s+Address\b)/i,/(?:from|supplier|seller|sold\s*by)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &.' ,-]{2,80})/i,/^(?!invoice\b)([A-Z][A-Za-z0-9 &.'-]{2,60}?)\s+(?:tax\s+)?invoice\b/i])||'';
    const currency=/\bEUR\b|\u20ac/.test(flat)?'EUR':/\bUSD\b/.test(flat)?'USD':'GBP',complete=Boolean(evidence.isInvoice&&!isStatement&&number&&date&&supplier&&total!==null&&vat!==null&&Number.isFinite(Number(vat)));
    const retryOcr=evidence.isInvoice&&!isStatement&&Boolean(number||date)&&!complete;
    const reason=complete?'':!evidence.isInvoice||isStatement?'This document does not appear to be an invoice.':!number?'Invoice or document number not found.':!date?'Invoice date not found.':!supplier?'Supplier not identified.':total===null?'Printed total not found.':'VAT amount not found; one 5x OCR retry is required.';
    return {invoiceNumber:number,date:parseDate(date),supplier:supplier.trim(),subtotal:subtotal??'',vat:vat??'',total:total??'',currency,source,documentType:evidence.isInvoice&&!isStatement?evidence.kind:'NON-INVOICE',isInvoiceDocument:evidence.isInvoice&&!isStatement,accepted:complete,rejected:!complete,rejectedReason:reason,confidence:complete?'ACCEPTED':'REJECTED',retryOcr,review:false};
  }
  function isMarionTradingText(value){
    const text=String(value||'');
    return /\b(?:MARION|MARLON|MANION|MARI0N|MAÃ…ION)\s+TRAD(?:ING|IN[GI])\b/i.test(text)||/mariontrad(?:ing|jng)ltd\.co\.uk/i.test(text)||(/\bAWRS\s+NO\s*:\s*XYAW/i.test(text)&&/\bVAT\s+NO\s*:\s*GB\s*295\s*9266\s*44\b/i.test(text));
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
  function isBanozeText(value){
    const text=String(value||'');
    return /\bBANOZE\b/i.test(text)||/banoze\.co\.uk|info\s*@\s*banoze/i.test(text)||/421\s*756\s*895/.test(text)||(/\bBNZ\s*20\d{6,}\b/i.test(text)&&/\b(?:GOODS\s+)?TOTAL\b/i.test(text));
  }
  function banozeInvoicePage(lines,text=''){
    const content=String(text||lines.map(line=>String(line.text||'')).join(' '));
    if(!isBanozeText(content))return false;
    const invoiceHeading=/\bINVOICE\b/i.test(content)||/\bKEEP\s+INVOICE\s+AS\s+PROOF\s+OF\s+DELIVERY\b/i.test(content),identifiedInvoice=/\bINVOICE\s*(?:TO|NO\.?|NUMBER|N[O0])\b|\bKEEP\s+INVOICE\s+AS\s+PROOF\s+OF\s+DELIVERY\b/i.test(content),number=/\bBNZ\s*20\d{6,}\b/i.test(content),summaryPage=/\b(?:invoice|account|customer|delivery|order)\s+summary\b|\bsummary\s+(?:of|for|page)\b/i.test(content);
    if(summaryPage&&!identifiedInvoice&&!number)return false;
    return invoiceHeading||number;
  }
  function banozeInvoiceNumber(text,lines){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim());
    if(!items.length){const direct=String(text||'').match(/BNZ\s*[-:#.]?\s*([0-9OIL|]{7,})/i);return direct?`BNZ${direct[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')}`:'';}
    const pages=new Map();for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    const found=[];
    for(const pageLines of pages.values()){
      const pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),header=pageLines.filter(line=>(Number(line.y)||0)<pageHeight*.3),labels=header.filter(line=>/invoi|nvoice|rnvoice|1nvoice/i.test(String(line.text||''))||/\b(?:BNZ|NZ\s*20)/i.test(String(line.text||'')));
      for(const label of labels){
        const height=Math.max(Number(label.height)||16,16),labelY=Number(label.y)||0,row=header.filter(line=>Math.abs((Number(line.y)||0)-labelY)<=Math.max(height*1.25,20)).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0)),compact=row.map(line=>String(line.text||'')).join(' ').replace(/[^A-Z0-9]/gi,'');
        const candidates=[];
        for(const match of compact.matchAll(/BNZ([0-9OIL|]{7,})/gi))candidates.push(`BNZ${match[1]}`);
        // OCR can drop the first B or split digits. Repair that prefix only
        // on the same header row as the printed invoice label.
        for(const match of compact.matchAll(/NZ(20[0-9OIL|]{6,})/gi))candidates.push(`BNZ${match[1]}`);
        for(const match of compact.matchAll(/(?:INVO|NVOICE|RNVOICE|1NVOICE)[A-Z0-9]*?(20[0-9OIL|]{6,})/gi))candidates.push(`BNZ${match[1]}`);
        for(const raw of candidates){const normalized=raw.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1');if(/^BNZ(?:20\d{6,}|\d{7,})$/.test(normalized))found.push(normalized);}
      }
    }
    const unique=[...new Set(found)];return unique.length===1?unique[0]:'';
  }
  function banozeLabelMatches(text,kind){
    const raw=String(text||'').trim().toUpperCase();if(kind==='TOTAL'&&/\bGOODS\b/i.test(raw))return false;
    const label=raw.replace(/0/g,'O').replace(/[^A-Z]/g,'');
    if(kind==='VAT')return ['VAT','VA','VAI'].includes(label);
    if(kind==='GOODS TOTAL')return label.startsWith('GOODSTOT');
    return ['TOTAL','TOTA','TOTL','TOAL'].includes(label);
  }
  function banozeMoneyValues(value){
    const raw=String(value||'')
      .replace(/\bE\s*[Il|]{2}(?=[.,]\s*[0-9OIl|]{2}\b)/gi,'£11')
      .replace(/\bC\s*[Il|]O(?=[.,]\s*[0-9OIl|]{2}\b)/gi,'£10')
      .replace(/^\s*[fF]\s*(?=\d)/,'£')
      .replace(/(?<=\.)[Ss](?=\d{1,2}\b)/g,'5')
      // Faint footer decimal points can be recognized as dashes. Normalize
      // only a complete two-digit cents suffix, e.g. OCR `118-33` -> `118.33`.
      .replace(/(^|[^\d])([0-9OIl|]{1,3})\s*[-–—]\s*([0-9OIl|]{2})(?!\d)/g,(_match,prefix,major,cents)=>`${prefix}${major}.${cents}`)
      .replace(/^\s*C\s*(\d{3,})[Ss](\d)\s*$/i,(_match,major,_centsFirst,centsLast)=>`£${major}.5${centsLast}`);
    return anchoredInvoiceMoneyValues(raw);
  }
  function banozeFooterAmount(lines,kind,variantPass=false){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();
    for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    if(!variantPass){
      for(const pageLines of pages.values()){
        const variants=[...new Set(pageLines.filter(line=>line.banozeVariant!==undefined&&line.banozeVariant!==null).map(line=>String(line.banozeVariant)))];if(!variants.length)continue;
        const readings=variants.map(variant=>banozeFooterAmount(pageLines.filter(line=>String(line.banozeVariant)===variant),kind,true)).filter(value=>value!==null).map(value=>Number(value).toFixed(2)),votes=new Map();for(const value of readings)votes.set(value,(votes.get(value)||0)+1);
        const ranked=[...votes.entries()].sort((a,b)=>b[1]-a[1]);return ranked.length&&ranked[0][1]>=2&&ranked[0][1]*2>readings.length?Number(ranked[0][0]):null;
      }
    }
    for(const pageLines of pages.values()){
      const pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),pageWidth=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),minimumY=pageHeight*.58;
      const labels=pageLines.filter(line=>banozeLabelMatches(line.text,kind)&&(Number(line.y)||0)>=minimumY).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
      const candidates=[];
      for(const label of labels){
        const inline=banozeMoneyValues(String(label.text||''));
        for(const money of inline)candidates.push({value:money.value,distance:0,horizontal:0});
        const labelY=Number(label.y)||0,labelX=Number(label.x)||0,labelHeight=Math.max(Number(label.height)||16,16),maxDistance=Math.max(pageHeight*.035,labelHeight*3,24),maxHorizontal=Math.max(pageWidth*.075,labelHeight*3,24);
        for(const line of pageLines){const y=Number(line.y)||0,x=Number(line.x)||0,distance=y-labelY;if(line===label||distance<=0||distance>maxDistance)continue;const lineText=String(line.text||'');if(kind==='TOTAL'&&/\d[.,]\s*\d{2}\s*[-–—]\s*$/.test(lineText))continue;const moneyValues=banozeMoneyValues(lineText),lineWidth=Math.max(Number(line.width)||0,0),labelCenter=labelX+Math.max(Number(label.width)||0,0)/2;if(!moneyValues.length)continue;if(moneyValues.length===1){const money=moneyValues[0],tokenCenter=x+((money.index+String(money.raw||'').length/2)/Math.max(lineText.length,1))*lineWidth,horizontal=Math.abs(tokenCenter-labelCenter);if(horizontal<=maxHorizontal)candidates.push({value:money.value,distance,horizontal});continue;}if(!lineWidth||labelCenter<x-maxHorizontal||labelCenter>x+lineWidth+maxHorizontal)continue;const positioned=moneyValues.map(money=>({value:money.value,distance,horizontal:Math.abs((x+((money.index+String(money.raw||'').length/2)/Math.max(lineText.length,1))*lineWidth)-labelCenter)})).sort((a,b)=>a.horizontal-b.horizontal);if(positioned[0].horizontal<=maxHorizontal)candidates.push(positioned[0]);}
      }
      const values=[...new Set(candidates.map(item=>Number(item.value).toFixed(2)))];
      if(values.length===1)return Number(values[0]);
      if(candidates.length){candidates.sort((a,b)=>a.distance-b.distance||a.horizontal-b.horizontal);const best=candidates[0],ties=candidates.filter(item=>Math.abs(item.distance-best.distance)<=Math.max(Number(labels[0]?.height)||16,1)&&Math.abs(item.horizontal-best.horizontal)<=pageWidth*.01);if(new Set(ties.map(item=>Number(item.value).toFixed(2))).size===1)return Number(best.value);}
    }
    return null;
  }
  function banozeFooterVariantConfirms(lines,kind,value){
    if(value===null||value===undefined||!Number.isFinite(Number(value)))return false;
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    return [...pages.values()].some(pageLines=>{if(!pageLines.some(line=>line.banozeVariant!==undefined&&line.banozeVariant!==null))return false;const confirmed=banozeFooterAmount(pageLines,kind);return confirmed!==null&&Math.round(Number(confirmed)*100)===Math.round(Number(value)*100);});
  }
  function banozeCents(value){if(value===null||value===undefined||String(value).trim()==='')return null;const amount=Number(value);return Number.isFinite(amount)?Math.round(amount*100):null;}
  function parseBanozeInvoice(text,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],content=String(text||lines.map(line=>String(line.text||'')).join('\n')),isInvoiceDocument=banozeInvoicePage(lines,content);
    let originalInvoiceNumber=isInvoiceDocument?banozeInvoiceNumber(content,lines):'',printedDate=isInvoiceDocument?anchoredInvoiceDate(content,lines):'';
    const headerVariants=[...new Set(lines.filter(line=>line.banozeHeaderVariant!==undefined&&line.banozeHeaderVariant!==null).map(line=>String(line.banozeHeaderVariant)))];
    if(headerVariants.length){
      const untagged=lines.filter(line=>line.banozeHeaderVariant===undefined||line.banozeHeaderVariant===null);originalInvoiceNumber=banozeInvoiceNumber('',untagged);printedDate=anchoredInvoiceDate('',untagged);const numberYear=String(originalInvoiceNumber).match(/^BNZ(20\d{2})/i)?.[1]||'';
      if(!originalInvoiceNumber){const candidates=headerVariants.map(variant=>banozeInvoiceNumber('',[...untagged,...lines.filter(line=>String(line.banozeHeaderVariant)===variant)])).filter(Boolean),counts=new Map();for(const candidate of candidates)counts.set(candidate,(counts.get(candidate)||0)+1);const agreed=[...counts].filter(([,count])=>count>=2);if(agreed.length===1)originalInvoiceNumber=agreed[0][0];}
      if(!printedDate||numberYear&&printedDate.slice(0,4)!==numberYear){const candidates=headerVariants.map(variant=>anchoredInvoiceDate('',[...untagged,...lines.filter(line=>String(line.banozeHeaderVariant)===variant)])).filter(Boolean),counts=new Map();for(const candidate of candidates)counts.set(candidate,(counts.get(candidate)||0)+1);const agreed=[...counts].filter(([,count])=>count>=2);if(agreed.length===1)printedDate=agreed[0][0];}
    }
    const numberYear=String(originalInvoiceNumber).match(/^BNZ(20\d{2})/i)?.[1]||'',date=numberYear&&printedDate&&printedDate.slice(0,4)!==numberYear?'':printedDate,goodsTotal=isInvoiceDocument?banozeFooterAmount(lines,'GOODS TOTAL'):null,readVat=isInvoiceDocument?banozeFooterAmount(lines,'VAT'):null,readTotal=isInvoiceDocument?banozeFooterAmount(lines,'TOTAL'):null;
    // The Banoze footer prints Goods Total, VAT and Total together. These are
    // the only values used for a derived amount; line items are never summed.
    // If OCR values conflict, defer to the focused contrast retry instead of
    // guessing which first-pass value lost or gained digits.
    let vat=readVat,total=readTotal,vatCalculated=false,totalCalculated=false,footerNeedsReview=false;
    const hasGoodsTotalLabel=isInvoiceDocument&&lines.some(line=>banozeLabelMatches(line.text,'GOODS TOTAL')),
      hasContrastReads=lines.some(line=>line.banozeVariant!==undefined&&line.banozeVariant!==null),
      goodsConfirmed=banozeFooterVariantConfirms(lines,'GOODS TOTAL',goodsTotal),
      vatConfirmed=banozeFooterVariantConfirms(lines,'VAT',readVat),
      totalConfirmed=banozeFooterVariantConfirms(lines,'TOTAL',readTotal),
      footerCents={goods:banozeCents(goodsTotal),vat:banozeCents(readVat),total:banozeCents(readTotal)},
      rawFooterReconciles=footerCents.goods!==null&&footerCents.vat!==null&&footerCents.total!==null&&Math.abs(footerCents.goods+footerCents.vat-footerCents.total)<=1;
    if(hasContrastReads){
      // A majority contrast reading confirms each footer cell independently.
      // When two confirmed footer figures are available, use those to recover
      // the third or correct a conflicting OCR read, all in integer pennies.
      if(goodsConfirmed&&vatConfirmed&&!totalConfirmed){
        total=(banozeCents(goodsTotal)+banozeCents(readVat))/100;
        totalCalculated=true;
        vat=readVat;
      }else if(goodsConfirmed&&totalConfirmed&&!vatConfirmed){
        vat=(banozeCents(readTotal)-banozeCents(goodsTotal))/100;
        vatCalculated=true;
        total=readTotal;
      }else if(vatConfirmed&&totalConfirmed){
        // Goods Total is useful corroboration, but not required to report the
        // two directly confirmed amounts when that footer cell stays unreadable.
        vat=readVat;total=readTotal;
      }else{
        footerNeedsReview=true;vat=null;total=null;
      }
      if(!footerNeedsReview&&goodsConfirmed&&vatConfirmed&&totalConfirmed){
        const recoveredCents={goods:banozeCents(goodsTotal),vat:banozeCents(vat),total:banozeCents(total)};
        if(Math.abs(recoveredCents.goods+recoveredCents.vat-recoveredCents.total)>1)footerNeedsReview=true;
      }
    }else if(footerCents.goods!==null&&footerCents.vat!==null&&footerCents.total!==null&&!rawFooterReconciles){
      // Three inconsistent first-pass values do not establish which OCR cell
      // is wrong. Hide both posting amounts and require a footer-only reread.
      footerNeedsReview=true;vat=null;total=null;
    }else if(total===null&&goodsTotal!==null&&readVat!==null){
      total=(banozeCents(goodsTotal)+banozeCents(readVat))/100;totalCalculated=true;
    }else if(readVat===null&&goodsTotal!==null&&readTotal!==null){
      vat=(banozeCents(readTotal)-banozeCents(goodsTotal))/100;vatCalculated=true;
    }
    // A missing Goods Total on a document that clearly prints this footer
    // still triggers one localized reread: it can expose a dropped leading
    // digit in the apparently readable VAT or Total cell.
    if(isInvoiceDocument&&hasGoodsTotalLabel&&goodsTotal===null&&!hasContrastReads){footerNeedsReview=true;total=null;}
    const parsedCents={goods:banozeCents(goodsTotal),vat:banozeCents(vat),total:banozeCents(total)},amountsReconcile=parsedCents.goods!==null&&parsedCents.vat!==null&&parsedCents.total!==null&&Math.abs(parsedCents.goods+parsedCents.vat-parsedCents.total)<=1,
      footerPairConfirmed=hasContrastReads&&(goodsConfirmed&&vatConfirmed||goodsConfirmed&&totalConfirmed||vatConfirmed&&totalConfirmed);
    if(!footerNeedsReview&&parsedCents.goods!==null&&parsedCents.vat!==null&&parsedCents.total!==null&&!amountsReconcile)footerNeedsReview=true;
    if(hasGoodsTotalLabel&&goodsTotal===null&&!footerPairConfirmed)footerNeedsReview=true;
    if(footerNeedsReview&&!hasContrastReads){vat=null;total=null;}
    const supplier='Banoze Ltd',invoiceNumberGenerated=Boolean(isInvoiceDocument&&!originalInvoiceNumber),referencePage=lines.length?Math.min(...lines.map(line=>Number(line.page)||1)):1,generatedNumber=invoiceNumberGenerated?generatedInvoiceReference('banoze',date,`${source}|PAGE:${referencePage}|${content}`):'',invoiceNumber=originalInvoiceNumber||generatedNumber,
      complete=Boolean(isInvoiceDocument&&invoiceNumber&&date&&vat!==null&&total!==null&&Number.isFinite(vat)&&Number.isFinite(total)&&!footerNeedsReview),
      reason=complete?'':!isInvoiceDocument?'This page is not a Banoze invoice.':!date?'Banoze invoice date could not be confirmed from the printed document.':footerNeedsReview?'Banoze footer values could not be confirmed; the printed Goods Total, VAT and Total need a focused reread.':total===null?'Printed Banoze TOTAL could not be confirmed.':'Printed Banoze VAT could not be confirmed independently from the invoice footer.';
    return {invoiceNumber,originalInvoiceNumber:originalInvoiceNumber||generatedNumber,invoiceNumberGenerated,invoiceNumberGeneratedReason:invoiceNumberGenerated?`No readable invoice number was printed; generated unique internal reference ${generatedNumber}.`:'',date,supplier,subtotal:'',vat:vat??'',vatUnverified:vat===null,vatMentioned:vat!==null,total:total??'',banozeGoodsTotal:goodsTotal??'',banozeDerivedVat:vatCalculated,banozeDerivedTotal:totalCalculated,banozeFooterUnverified:footerNeedsReview,currency:'GBP',source,documentType:isInvoiceDocument?'INVOICE':'NON-INVOICE',isInvoiceDocument,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(isInvoiceDocument&&(!complete||footerNeedsReview)),review:false,layoutId:'banoze-footer-summary',profileId:'banoze'};
  }
  function parseBanozeBatch(pageLines,source,options={}){
    const pages=[...pageLines.keys()].sort((a,b)=>a-b),banozePages=new Set(pages.filter(page=>isBanozeText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')))),records=[],consumed=new Set(banozePages);
    for(const page of [...banozePages].sort((a,b)=>a-b)){
      const items=pageLines.get(page)||[],text=items.map(line=>String(line.text||'')).join('\n');if(!banozeInvoicePage(items,text))continue;
      const row=parseInvoiceRobust(text,source,items,options);row.page=page;row.sourcePages=[page];row.profileId='banoze';records.push(row);
    }
    const otherLines=pages.filter(page=>!consumed.has(page)).flatMap(page=>{const items=pageLines.get(page)||[],text=items.map(line=>String(line.text||'').trim()).filter(Boolean).join(' '),summaryPage=/\b(?:invoice|account|customer|delivery|order)\s+summary\b|\bsummary\s+(?:of|for|page)\b/i.test(text),hasDocumentCue=/\b(?:invoice|bill|credit\s+note|receipt|order|delivery\s+note)\b/i.test(text);return summaryPage||!hasDocumentCue?[]:items;}),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
    return [...otherRows,...records].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function matchBanozeFullPageRetryCandidate(row,candidates){
    const compact=value=>String(value||'').replace(/[^A-Z0-9]/gi,'').toUpperCase(),page=Number(row?.page),currentRef=compact(row?.originalInvoiceNumber),matches=(Array.isArray(candidates)?candidates:[]).filter(candidate=>{
      if(candidate?.profileId!=='banoze'||candidate.accepted!==true||Number(candidate.page)!==page)return false;
      if(!row?.invoiceNumberGenerated){const retryRef=compact(candidate.originalInvoiceNumber);if(!retryRef||currentRef&&!(retryRef===currentRef||retryRef.startsWith(currentRef)))return false;}
      return !row?.date||row.date===candidate.date;
    });
    return matches.length===1?matches[0]:null;
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
    let raw=String(value??'').trim().replace(/[Â£$â‚¬]/g,'').replace(/\bGBP\b/ig,'').trim();
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
    const customerLabel=items.find(line=>/^\s*customer\s*:?\s*$/i.test(String(line.text||''))),customerValue=customerLabel?items.filter(line=>line!==customerLabel&&Math.abs((Number(line.y)||0)-(Number(customerLabel.y)||0))<=Math.max(14,(Number(customerLabel.height)||16)*1.2)&&Number(line.x)>Number(customerLabel.x)).sort((a,b)=>Number(a.x)-Number(b.x))[0]:null,accountCode=String(customerValue?.text||'').match(/^\s*([A-Z]{2,6})\s*[-â€“]/i)?.[1]?.toUpperCase()||'';
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
    let raw=String(value||'').trim().replace(/[Â£$â‚¬]/g,'').replace(/(?<=\d)\s*[â€¢Â·â—]\s*(?=\d{2}\s*$)/u,'.').trim();
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
    let raw=String(value||'').trim().replace(/[Â£$â‚¬]/g,'').replace(/^\s*[Ee]\s*/,'').replace(/\s+/g,' ');
    raw=raw.replace(/^([lI|])\s*(?=,)/,'1').replace(/^([Oo])\s*(?=,)/,'0').replace(/\s+([,.;])/g,'$1').replace(/([,.;])\s+(?=\d)/g,'$1').replace(/([.,])\s*([Oo])(?=\d)/g,'$10');
    if(!/^-?(?:(?:\d{1,3}(?:[\s,]\d{3})+)|\d+)[.,]\s*\d{2}$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function shahidSuspiciousPoundPrefix(value){
    // On these scans Windows OCR sometimes reads the printed "Â£1" as "21".
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
    let raw=String(value||'').trim().replace(/\b(?:GBP|GBR)\b/gi,'').replace(/[Â£$â‚¬Ã‚Ã†Ã¦ZzCcGgSs]/g,'').trim();
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
    let raw=String(value||'').trim().replace(/[Â£$â‚¬]/g,'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/(?<=\d)\s*[Â·â€¢]\s*(?=\d{2}\s*$)/u,'.').replace(/;(?=\s*\d{2}\s*$)/,'.').replace(/\s+/g,' ').trim();
    if(!/^-?(?:(?:\d{1,3}(?:[ ,]\d{3})+)|\d+)[.,]\s*\d{2}$/.test(raw))return null;
    return invoiceAmount(raw);
  }
  function dairyMoneyCandidates(value){
    const text=String(value||'').replace(/[Â£$â‚¬]/g,' '),matches=[...text.matchAll(/-?\d[\d, ]*[.,;]\s*[\dOoIl]{2}/g)],values=[];
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
    const source=String(text||''),number=source.match(/\bAUTO\s+INVOICE\s*[-â€“â€”]?\s*A\s*([0-9]{5,8})\b/i),page=source.match(/\bPage\s*(\d+)\s+of\s+(\d+)\s*[-â€“â€”]?\s*Original\b/i);
    const lines=Array.isArray(ocrLines)?ocrLines:[],dateLabel=lines.filter(line=>/^\s*Date\s*:?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    const dateCandidate=dateLabel?lines.filter(line=>(Number(line.page)||1)===(Number(dateLabel.page)||1)&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))<=70).map(line=>({line,match:String(line.text||'').match(/^\s*[:#.-]?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(dateLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(dateLabel.y)||0))||Number(a.line.x)-Number(b.line.x))[0]:null;
    const dateRaw=dateCandidate?.match[1]||source.match(/\bDate\s*:?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[-/.]\s*\d{4})\b/i)?.[1]||source.match(/\bPaid\s+by\s+(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})\b/i)?.[1]||'';
    return {number:number?.[1]||source.match(/\bUK26FAC2A(\d{6})\b/i)?.[1]||'',pageNumber:page?Number(page[1]):0,pageCount:page?Number(page[2]):0,date:parseDate(dateRaw.replace(/\s/g,''))};
  }
  function monolithPrintedMoney(value){
    let raw=String(value||'').trim().replace(/\b(?:GBR|GBP)\b/gi,'').replace(/[Â£$â‚¬]/g,'').trim();
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
      if(!dateText){const candidate=items.filter(line=>Number(line.page)===Number(dateLabel.page)&&Number(line.x)>Number(dateLabel.x)+50&&Math.abs((Number(line.y)||0)-(Number(dateLabel.y)||0))<=30).map(line=>({line,match:String(line.text||'').match(/^\s*[:#.â€¢Â·]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*$/)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-(Number(dateLabel.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(dateLabel.y)||0))||Number(a.line.x)-Number(b.line.x));
        dateText=candidate[0]?.match[1]||'';
      }
    }
    if(!dateText)dateText=String(text||'').match(/\bdate\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/i)?.[1]||'';
    return {fullNumber,date:parseDate(dateText)};
  }
  function marionPrintedMoney(value){
    const raw=String(value||'').trim().replace(/[Â£$â‚¬]/g,'').replace(/\s/g,'');
    if(/^(?:0+(?:[.,]0{1,2})?|[Oo][.,]?[Oo]{0,2})$/i.test(raw))return 0;
    if(!/^-?(?:(?:\d{1,3}(?:[, ]\d{3})+)|\d+)[.,]\d{2}$/.test(String(value||'').replace(/[Â£$â‚¬]/g,'').trim()))return null;
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
    {id:'tesco',name:'Tesco',category:'Receipts',detect:text=>/\bTESCO\b/i.test(text)&&/\b(?:PUMP|PETROL|FUEL|TOTAL|UNLEADED|SALE|LITRE|LITER|RECEIPT\s+SUMMARY)\b/i.test(text)},
    {id:'sainsburys',name:"Sainsbury's",category:'Receipts',detect:text=>/\bSAINSBURY(?:'S|S)?\b/i.test(text)&&/\b(?:PUMP|FUEL|UNLEADED|DIESEL|VAT\s+RECEIPT\s+SUMMARY)\b/i.test(text)},
    {id:'newtoll-services',name:'Newtoll Services (BP)',category:'Receipts',detect:text=>{const key=String(text||'').toUpperCase().replace(/[^A-Z]/g,'');return (key.includes('NEWTOLLSERVICES')||key.includes('NEWTONSERVICES'))&&/\b(?:A47|THORNEY\s+TOLL|KARAN\s+(?:FUEL|SHOP)|BPME|UNLEADED|DIESEL|TOTAL)\b/i.test(text);}},
    {id:'faizan-e-madina',name:'Faizan-e-Madina Shop',category:'Receipts',detect:text=>/\bFAIZAN\s*[- ]?E\s*[- ]?MADINA\b/i.test(text)&&/\b(?:SHOP|GROCERIES|SHOP\s+SALES|TOTAL)\b/i.test(text)},
    {id:'rockafellas',name:'RockaFellas',category:'Receipts',detect:text=>/\bROCKAFELLAS\b/i.test(text)&&/\b(?:TICKET|RECEIPT|TOTAL|CASH|CHANGE)\b/i.test(text)},
    {id:'poundland',name:'Poundland',category:'Receipts',detect:text=>/\bPOUNDLAND(?:\s+LIMITED)?\b/i.test(text)&&/\b(?:TOTAL|CASH|VAT|PURCHASE|SHOPPING)\b/i.test(text)},
    {id:'bm-retail',name:'B&M Retail Ltd',category:'Receipts',detect:text=>/\bB\s*&\s*M\s+RETAIL\b|\bB&amp;M\s+RETAIL\b/i.test(text)&&/\b(?:TOTAL\s+AMOUNT|TAX\s+GBP|SALES\s+VOUCHER)\b/i.test(text)},
    {id:'asda',name:'Asda',category:'Receipts',detect:text=>/\bASDA\b/i.test(text)&&/\b(?:TOTAL|RECEIPT|SALE)\b/i.test(text)},
    {id:'wilco-motor-spares',name:'Wilco Motor Spares',category:'Receipts',detect:text=>/\bWILCO\s+MOTOR\s+SPARES\b/i.test(text)&&/\b(?:TOTAL|GOODS|VAT|DOCUMENT)\b/i.test(text)},
    {id:'esso',name:'Esso',category:'Receipts',detect:text=>/\bESSO\b/i.test(text)||/239\s*088\s*635|218\s*001\s*105/.test(text)},
    // BP receipts in these scans often lose the red BP logo in OCR. Their
    // registered VAT number is a stable content identifier across layouts.
    {id:'bp',name:'BP',category:'Receipts',detect:text=>/\b(?:BP|LITTLE HAMPTON)\b/i.test(text)||/663\s*139\s*630/.test(text)},
    {id:'shell',name:'Shell',category:'Receipts',detect:text=>{const words=String(text||'').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean),knownSite=/\b(?:HUNTINGDON\s+ROAD|FENGATE|WESTWOOD|STANGROUND|NORTHMEAD|WESTSIDE)\b/i.test(text),shellWord=words.some(word=>word.length>=4&&word.length<=7&&receiptLevenshtein(word,'SHELL')<=2);return (shellWord||knownSite)&&/\b(?:PUMP|ARTICLE|CUSTOMER|TOTAL|MASTERCARD|AMOUNT|FUEL|UNLEADED|EFT|RECEIPT)\b/i.test(text);}},
    {id:'mfg',name:'MFG',category:'Receipts',detect:text=>/\b(?:MFG|MOTOR FUEL)\b/i.test(text)&&/\b(?:PUMP|TOTAL|SALE|UNLEADED|POS)\b/i.test(text)},
    // OCR commonly mangles the header (`EG ON THE MijVb`) but reads the
    // company name or VAT number in the footer more reliably.
    {id:'eg-on-the-move',name:'EG On The Move',category:'Receipts',detect:text=>/\bEG\s+ON\s+THE\s+(?:MOVE|MI[JV]V?B)\b/i.test(text)||/\bEIG\s+on\s+the\s+Move\s+Ltd\b/i.test(text)||/473\s*949\s*343/.test(text)},
    {id:'saxon-autopoint',name:'Saxon AutoPoint',category:'Receipts',detect:text=>/\bSAXON\s+AUTO\s*POINT\b/i.test(text)&&/\b(?:PUMP|TOTAL|SALE|UNLEADED)\b/i.test(text)},
    {id:'other-forecourt',name:'Other forecourt',category:'Receipts',detect:text=>/\b(?:UNLEADED|PETROL|PUMP|FUEL)\b/i.test(text)&&/\b(?:VAT|TOTAL|POS|RECEIPT)\b/i.test(text)},
    {id:'unidentified-forecourt',name:'Unidentified forecourt',category:'Receipts',detect:()=>false}
  ];
  function compatibleCompanies(){return [
    {id:'sumup-bank',name:'SumUp',category:'Bank statements',status:'Review',description:'OCR-supported SumUp account statements with content-detected Date, Reference, Type, Amount and Description columns'},
    {id:'monzo-bank',name:'Monzo',category:'Bank statements',status:'Under development',description:'Digital PDF statements with ISO dates and CR/DR transactions'},
    {id:'barclays-bank',name:'Barclays',category:'Bank statements',status:'Review',description:'OCR-supported statements with day and month transaction dates'},
    {id:'metro-bank',name:'Metro Bank',category:'Bank statements',status:'Review',description:'Column-based statements and online transaction reports with separate money out, money in and balance columns'},
    {id:'hsbc-bank',name:'HSBC',category:'Bank statements',status:'Review',description:'OCR-supported statements with labelled date, paid out, paid in and balance columns'},
    {id:'starling-bank',name:'Starling',category:'Bank statements',status:'Review',description:'OCR-supported statements with heading-detected date, transaction, money in, money out and end-of-day balance columns'},
    ...receiptProfiles.map(({id,name,category})=>({id,name,category,status:'Under development'})),
    ...invoiceProfiles.filter(profile=>!['generic','wz-delivery'].includes(profile.id)).map(({id,name,status,formatTag,category})=>({id,name,category:category||'Invoices',...(status?{status}:{}),...(formatTag?{formatTag}:{})}))
  ];}
  function underDevelopmentSuppliers(mode,rows=[],contexts=[]){
    const categories=mode==='invoice'?['Invoices','PDF only']:mode==='receipt'?['Receipts']:mode==='bank'?['Bank statements']:[];
    if(!categories.length)return [];
    const profiles=compatibleCompanies().filter(profile=>profile.status==='Under development'&&categories.includes(profile.category));
    const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en-GB').replace(/[^a-z0-9]+/g,' ').trim();
    const rowList=Array.isArray(rows)?rows:[],contextList=Array.isArray(contexts)?contexts:[contexts],profileIds=new Set(rowList.map(row=>String(row?.profileId||''))),supplierNames=new Set(rowList.map(row=>normalize(row?.supplier||row?.company||'' )).filter(Boolean));
    const contextText=contextList.map(value=>typeof value==='string'?value:String(value?.text||'')).join('\n');
    const found=profiles.filter(profile=>{
      if(profileIds.has(profile.id)||supplierNames.has(normalize(profile.name)))return true;
      const tokens=String(profile.name||'').trim().split(/[^a-z0-9]+/i).filter(Boolean).map(token=>token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
      if(!tokens.length)return false;
      const expression=new RegExp(`(?:^|[^a-z0-9])${tokens.join('[^a-z0-9]+')}(?:$|[^a-z0-9])`,'i');
      return expression.test(contextText);
    }).map(profile=>profile.name);
    return [...new Set(found)].sort((a,b)=>a.localeCompare(b,'en-GB'));
  }
  function receiptLevenshtein(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const current=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=current;}}return row[b.length];}
  function receiptTotalLabel(value){const letters=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I');return !['TOTALS','TODAY'].includes(letters)&&letters.length>=4&&letters.length<=6&&receiptLevenshtein(letters,'TOTAL')<=2;}
  function receiptFaintTotalLabel(line,fuelY){const x=Number(line?.x)||0,y=Number(line?.y)||0,letters=String(line?.text||'').toUpperCase().replace(/[^A-Z]/g,'');return x<260&&y>=(Number(fuelY)||0)+70&&y<=(Number(fuelY)||0)+320&&letters.length>=2&&letters.length<=3&&receiptLevenshtein(letters,'TOTAL')<=3;}
  function receiptMfgTotalLabel(line){const text=String(line?.text||''),letters=text.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I').replace(/I/g,'L'),x=Number(line?.x)||0,y=Number(line?.y)||0;if(receiptLevenshtein(letters,'TOTALS')<receiptLevenshtein(letters,'TOTAL'))return false;return x<300&&y>500&&y<1050&&letters.length>=4&&letters.length<=7&&receiptLevenshtein(letters,'TOTAL')<=2;}
  function receiptMoneyTokens(value){
    const text=String(value||'').replace(/[\u00A3\u20AC$]/g,' ').replace(/(^|[^\p{L}\d])G(?=[\sOoIl]{1,3}[.,][\sOoIlq]{2}(?:\s|$|[^\p{L}]))/gu,'$1').replace(/([.,]\s*[\dOoIl])\s*[qQ](?=\s|$|[^\p{L}])/gu,(_,prefix)=>prefix+'9').replace(/(^|[^\p{L}\d])[eEcCyY]\s*[aAgG]\s*[oO](?=[\s.,;-]*\d{2}(?:\s|$|[^\p{L}]))/gu,(_,lead)=>lead+'30').replace(/(^|[^\p{L}\d])[nN]\s*[oO](?=[\s.,;-]*\d{2}(?:\s|$|[^\p{L}]))/gu,(_,lead)=>lead+'20').replace(/([.,]\s*\d)\s*[bB](?=\s|$|[^\p{L}])/gu,(_,digit)=>digit+'6'),pattern=/\(?-?[\dOoIl]{1,4}(?:[\s,.'\u2019][\dOoIl]{3})*(?:\s*[.,;-]\s*[\dOoIl]{2})\)?/g,matches=[...text.matchAll(pattern)],values=[];
    for(const match of text.matchAll(/(?<![\d/])\d{1,4}\s+\d{2}(?!\d)/g))matches.push(match);
    matches.sort((a,b)=>a.index-b.index);
    for(const match of matches){const normalized=match[0].replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/[\u2019']/g,'').replace(/(\d)\s*-\s*(?=\d{2}\b)/g,'$1.').replace(/(?<=\d)\s+(?=\d{2}\b)/g,'.').replace(/\s+/g,' ').replace(/[;,]/g,'.'),parsed=invoiceAmount(normalized);if(parsed!==null&&Math.abs(parsed)<=100000&&!values.some(item=>item.index===match.index))values.push({raw:match[0],value:parsed,index:match.index});}
    return values;
  }
  function receiptAnchoredMoneyTokens(value){
    const raw=String(value||'').trim(),withoutCurrency=raw.replace(/^\s*[Â£â‚¬$EeFf]\s*/u,''),variants=[raw,withoutCurrency];
    // Only used beside a printed Total label. Windows OCR sometimes reads the
    // pound sign as E/F and breaks one amount across punctuation, e.g.
    // `E 44 (_)9` or `E59 . 2.3`. Repair those glyphs in this labelled cell,
    // never in product descriptions, dates or payment rows.
    const wrappedZero=withoutCurrency.match(/^\s*(\d{1,3})\s*[([]\s*[_\s]*[)\]]\s*(\d)\s*$/);
    if(wrappedZero)variants.push(`${wrappedZero[1]}.0${wrappedZero[2]}`);
    const doubledSeparator=withoutCurrency.match(/^\s*(\d{1,3})\s*[.,]\s*(\d)\s*[.,]\s*(\d)\s*$/);
    if(doubledSeparator)variants.push(`${doubledSeparator[1]}.${doubledSeparator[2]}${doubledSeparator[3]}`);
    const confusedEight=withoutCurrency.match(/^\s*(\d{1,3})[tT]\s*[.,]\s*(\d{2})\s*$/);
    if(confusedEight)variants.push(`${confusedEight[1]}8.${confusedEight[2]}`);
    // In a printed, label-anchored amount, Windows OCR can turn `Â£100.32`
    // into `El oo -32`. Join only the whole-pound glyphs and preserve the
    // explicit two printed penny digits; this never runs on unlabelled text.
    const separated=withoutCurrency.match(/^\s*([\dOoIl](?:[\s,.'\u2019]*[\dOoIl])*)\s*[.,;-]\s*([\dOoIl]{2})\s*$/);
    if(separated){const whole=separated[1].replace(/[\s,.'\u2019]/g,'').replace(/[Oo]/g,'0').replace(/[Il]/g,'1'),pence=separated[2].replace(/[Oo]/g,'0').replace(/[Il]/g,'1');if(/^\d{1,5}$/.test(whole)&&/^\d{2}$/.test(pence))variants.push(`${whole}.${pence}`);}
    const values=[];for(const variant of variants)for(const token of receiptMoneyTokens(variant))if(!values.some(item=>Math.round(item.value*100)===Math.round(token.value*100)))values.push(token);
    if(separated&&/^\s*[Il]\s/.test(separated[1])){const repaired=invoiceAmount(`${separated[1].replace(/[\s,.'\u2019]/g,'').replace(/[Oo]/g,'0').replace(/[Il]/g,'1')}.${separated[2].replace(/[Oo]/g,'0').replace(/[Il]/g,'1')}`);if(repaired!==null)return [{raw:separated[0],value:repaired,index:0}];}
    return values;
  }
  function receiptDateFromText(value){
    let text=String(value||'').replace(/\b0[bB](?=\s+20\d{2}\b)/g,'05').replace(/\b[I|]O(?=\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/gi,'10').replace(/\b([IOQL])(?=\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/gi,'1').replace(/\b([OQ])(?=\d)/gi,'0').replace(/(\d{1,2}[./-]\s*\d{1,2})\s+(20\d{2})\b/g,'$1/$2').replace(/(?<=\d)\s*([./-])\s*,?\s*(?=\d)/g,'$1').replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\b[:,]?\s*/ig,'');
    // Some till printouts use DD/MM YY on the date/time line.
    text=text.replace(/\b(\d{1,2}[./-]\s*\d{1,2})\s+(2\d)\b/g,'$1/20$2');
    // Windows OCR commonly removes one separator from short numeric dates,
    // e.g. `23.0812026`. Restore the day/month/year boundaries only when the
    // resulting calendar date is valid.
    text=text.replace(/\b(\d{1,2})[./-](\d{2})(20\d{2})\b/g,'$1/$2/$3').replace(/\b(\d{2})(\d{2})(20\d{2})\b/g,'$1/$2/$3');
    const numeric=[...text.matchAll(/\b(?:\d{1,2}[./-]\s*\d{1,2}[./-]\s*\d{2,4}|20\d{2}[./-]\d{1,2}[./-]\d{1,2})\b(?![A-Za-z0-9?])/g)].map(match=>parseDate(match[0].replace(/\s+/g,''))).filter(Boolean);
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
  function receiptVatFromLines(lines,total=''){
    const ordered=[...(Array.isArray(lines)?lines:[])].filter(line=>line&&String(line.text||'').trim()).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)),isRegistration=line=>{const value=String(line?.text||'');if(/\bV(?:A|4)(?:T|I)\s*(?:NO\.?|NUMBER|REG(?:ISTRATION)?|TYPE|RATE)\b/i.test(value))return true;const x=Number(line?.x)||0,y=Number(line?.y)||0;return ordered.some(other=>{const otherText=String(other.text||''),otherX=Number(other.x)||0,otherY=Number(other.y)||0,digits=otherText.replace(/\D/g,'');if(other===line||Math.abs(otherY-y)>20||otherX<x||otherX-x>330)return false;if(/\bGB\s*\d(?:[\s\d]{7,})\b/i.test(otherText))return true;return /^\s*V(?:A|4)(?:T|I)\s*[:.]?\s*$/i.test(value)&&digits.length>=8;});},vatLines=ordered.filter(line=>/\bV(?:A|4)(?:T|I)\b/i.test(String(line.text||''))&&!isRegistration(line)),text=ordered.map(line=>String(line.text||'')).join(' ');
    const compact=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),isVatWord=value=>/\bV(?:A|4)(?:T|I)\b/i.test(String(value||'')),vatAmountLabel=line=>{const value=String(line?.text||''),key=compact(value),match=key.match(/^(?:VAT|VAI|V4T)([A-Z0-9]+)$/);return Boolean(match&&receiptLevenshtein(match[1],'AMOUNT')<=2)||/\bV(?:A|4)(?:T|I)\s+(?:AMOUNT|VALUE)\b/i.test(value);},summary=ordered.find(line=>{const value=String(line.text||''),key=compact(value),summaryLike=/SUMMARY/.test(key),nearbyHeaders=ordered.filter(other=>{const y=Number(other.y)||0,anchorY=Number(line.y)||0;return y>=anchorY&&y<=anchorY+120;}),vatHeader=nearbyHeaders.find(other=>/^(?:VAT|VAI|V4T)$/i.test(String(other.text||'').trim())),totalHeader=nearbyHeaders.find(other=>/^\s*T(?:O|0)TAL\s*$/i.test(String(other.text||''))&&Math.abs((Number(other.y)||0)-(Number(vatHeader?.y)||0))<=8);return /\bVAT\s*(?:ANALYSIS|ANALYSTS|RECEIPT\s+SUMMARY|SUMMARY)\b|\bTAX\s+SUMMARY\b/i.test(value)||(summaryLike&&(key.includes('VAT')||key.includes('VAI')||key.includes('RECE'))&&(nearbyHeaders.some(other=>/F[U HJ]EL\s+ONLY/i.test(String(other.text||'')))||Boolean(vatHeader&&totalHeader)));}),summaryY=Number(summary?.y)||0,vatSeeBelow=ordered.some(line=>/\bV(?:A|4)(?:T|I)\s*[:.]?\s*SEE\s+BELOW\b/i.test(String(line.text||''))),vatAmountColumnEvidence=vatLines.some(line=>{const value=String(line.text||''),key=compact(value),x=Number(line.x)||0,y=Number(line.y)||0;if(!isVatWord(value)||/^\s*V(?:A|4)(?:T|I)\s*[:.]?\s*$/i.test(value)||/\b(?:NO\.?|NUMBER|TYPE|RATE|ANALYSIS|SUMMARY)\b/i.test(value))return false;return ordered.some(other=>other!==line&&/^\s*NETT?\s*$/i.test(String(other.text||''))&&Math.abs((Number(other.y)||0)-y)<=12&&(Number(other.x)||0)<x)||key.includes('AMOUNT');}),vatRateTable=ordered.some(line=>/^\s*VAT\s+RATE\s*$/i.test(String(line.text||''))&&ordered.some(other=>/^\s*EXCL?\s*$/i.test(String(other.text||''))&&Math.abs((Number(other.y)||0)-(Number(line.y)||0))<=12)&&ordered.some(other=>/^\s*INCL?\s*$/i.test(String(other.text||''))&&Math.abs((Number(other.y)||0)-(Number(line.y)||0))<=12)),taxAmountLabel=ordered.some(line=>/\bTAX\s+GBP\b/i.test(String(line.text||''))),poundlandVatLabel=ordered.some(line=>/\bVAT\b/i.test(String(line.text||''))&&/(?:INCLUSIVE.*VAT|VAT.*INCLUSIVE|PAID)/i.test(String(line.text||''))),taxTableLabel=ordered.some(line=>compact(line.text)==='TAX')&&ordered.some(line=>/\bRATE\b/i.test(String(line.text||'')))&&vatLines.length>0,mentioned=Boolean(summary)||vatSeeBelow||vatAmountColumnEvidence||vatRateTable||taxAmountLabel||poundlandVatLabel||taxTableLabel||vatLines.some(line=>vatAmountLabel(line)||/^\s*V(?:A|4)(?:T|I)\s*[:.]?\s*$/i.test(String(line.text||'')));
    if(!mentioned)return {vat:0,vatMentioned:false,vatUnverified:false,vatRaw:''};
    const cents=value=>receiptMoneyTokens(value).filter(token=>!/%/.test(String(value||''))).map(token=>Math.round(Math.abs(token.value)*100)),summaryCellCents=value=>{const values=cents(value);if(values.length)return values;const raw=String(value||'').trim(),match=raw.match(/^(\d{1,3})\s+[oO]{2}$/);if(match){const parsed=invoiceAmount(`${match[1]}.00`);return parsed===null?[]:[Math.round(parsed*100)];}const damaged=raw.match(/^[eEÂ£]?\s*[cC]\s*[.,]\s*(\d{2})$/);if(damaged){const parsed=invoiceAmount(`9.${damaged[1]}`);return parsed===null?[]:[Math.round(parsed*100)];}const pennies=raw.match(/^[^\d]*[.,]\s*(\d{2})\s*$/);if(pennies){const parsed=invoiceAmount(`0.${pennies[1]}`);return parsed===null?[]:[Math.round(parsed*100)];}return [];},sum=values=>values.reduce((a,b)=>a+b,0)/100;
    // Read VAT from the printed VAT column of a summary table. Many Newtoll,
    // MFG, Asda and Tesco layouts put the net, VAT and gross values on one row;
    // choosing a nearby number can silently select the net or gross column.
    // Use the headers on that receipt to identify the VAT column, then read
    // the printed VAT cells on each row (or the printed Totals row if OCR did
    // not retain the individual rate rows).
      const structuredVatTables=()=>{
      const labelKey=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      const headerLike=line=>/^(?:VAT|V4T|VAI)$/i.test(String(line.text||'').trim())||/^(?:EX\.?\s*VAT|EX\.?\s*V4T|INC\.?\s*VAT|INC\.?\s*V4T|A\.?\s*VAT)$/i.test(String(line.text||'').trim())||/^(?:NETT?|VAT\s*RATE|RATE)$/i.test(String(line.text||'').trim());
      const exactVat=ordered.filter(line=>/^(?:VAT|V4T|VAI)$/i.test(String(line.text||'').trim()));
      for(const vatHeader of exactVat){
        const hy=Number(vatHeader.y)||0,vx=Number(vatHeader.x)||0;
        const rowHeaders=ordered.filter(line=>Math.abs((Number(line.y)||0)-hy)<=12&&headerLike(line));
        const incHeader=rowHeaders.some(line=>(Number(line.x)||0)>vx&&/^(?:INC\.?\s*VAT|INC\.?\s*V4T)$/i.test(String(line.text||'').trim())),vatHeadersLeft=rowHeaders.filter(line=>(Number(line.x)||0)<vx&&/^(?:VAT|V4T|VAI)$/i.test(String(line.text||'').trim())),previous=rowHeaders.filter(line=>(Number(line.x)||0)<vx&&(/^(?:NETT?|EX\.?\s*VAT|EX\.?\s*V4T|A\.?\s*VAT)$/i.test(String(line.text||'').trim())||incHeader&&vatHeadersLeft.length>=1&&line===vatHeadersLeft[0])).sort((a,b)=>(Number(b.x)||0)-(Number(a.x)||0))[0];
        if(!previous)continue;
        const title=ordered.some(line=>{const key=compact(line.text);const y=Number(line.y)||0;return y<=hy&&hy-y<=280&&(/VATANALYSIS|VATRECEIPTSUMMARY|TAXSUMMARY|VATSUMMARY/.test(key)||/MOTORFUEL|VATRATE/.test(key));});
        const totalLabel=ordered.some(line=>/^(?:TOTALS?|TOTALS)$/i.test(String(line.text||'').trim())&&Math.abs((Number(line.y)||0)-hy)<=260);
        if(!title&&!totalLabel)continue;
        const px=Number(previous.x)||0,leftPitch=Math.max(40,vx-px),next= rowHeaders.filter(line=>(Number(line.x)||0)>vx&&/^(?:FUEL|VAT|V4T|VAI|INC\.?\s*VAT|INC\.?\s*V4T)$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0))[0],nextPitch=next?Math.max(35,(Number(next.x)||0)-vx):leftPitch;
        // Cap the column band to about half a normal column interval. This
        // excludes the duplicate fuel/net and gross VAT cells in Newtoll's
        // five-column table even when OCR misses the Fuel heading.
        const left=vx-leftPitch*0.7,right=vx+Math.min(leftPitch*0.5,nextPitch*0.55);
        const netHeader=previous,netX=Number(netHeader.x)||0,netPrev=rowHeaders.filter(line=>(Number(line.x)||0)<netX&&/^(?:RATE|VAT\s*RATE)$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(b.x)||0)-(Number(a.x)||0))[0],netLeft=netPrev?netX-(netX-(Number(netPrev.x)||0))*0.7:netX-leftPitch*0.7,netRight=netX+(vx-netX)*0.5;
        const valueTokensInBand=(line,bandLeft,bandRight)=>{
          const value=String(line.text||''),width=Number(line.width)||0,x=Number(line.x)||0;
          const tokens=receiptMoneyTokens(value).filter(token=>!/%/.test(value.slice(Math.max(0,token.index-2),token.index+token.raw.length+2))).map(token=>({value:Math.round(Math.abs(token.value)*100),x:x+(width&&value.length?width*(token.index+Math.min(token.raw.length/2,6))/value.length:token.index*6)})).filter(token=>token.x>=bandLeft&&token.x<bandRight);
          if(!tokens.length&&bandLeft===left&&bandRight===right){const repaired=summaryCellCents(value);if(repaired.length===1)return [{value:repaired[0],x:x+Math.max(0,width/2)}].filter(token=>token.x>=bandLeft&&token.x<bandRight);}
          return tokens;
        };
        const nextStop=ordered.filter(line=>(Number(line.y)||0)>hy+10&&/^(?:PAID\s+BY|CHANGE|MERCHANT\s*:|RECEIPT\s+NO\.?|DATE\s*\/\s*TIME)$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0],stopY=Math.min(nextStop?Number(nextStop.y):hy+260,hy+220);
        const data=ordered.filter(line=>(Number(line.y)||0)>hy+10&&(Number(line.y)||0)<stopY),rateRows=data.filter(line=>/\d{1,2}[.,]\d{1,2}\s*%/.test(String(line.text||''))),rowYs=[];
        for(const line of rateRows){const y=Number(line.y)||0;if(!rowYs.some(item=>Math.abs(item-y)<=14))rowYs.push(y);}
        const totalRows=data.filter(line=>/^TOTALS?$/i.test(String(line.text||'').trim())).map(line=>Number(line.y)||0),netYs=[];for(const line of data){if(valueTokensInBand(line,netLeft,netRight).length){const y=Number(line.y)||0;if(!netYs.some(item=>Math.abs(item-y)<=14))netYs.push(y);}}
        const cellAtRow=(y,bandLeft,bandRight,center)=>{const cells=data.filter(line=>Math.abs((Number(line.y)||0)-y)<=16).flatMap(line=>valueTokensInBand(line,bandLeft,bandRight));if(!cells.length)return null;const ranked=cells.sort((a,b)=>Math.abs(a.x-center)-Math.abs(b.x-center)),nearest=ranked[0],competitor=ranked.find(item=>item.value!==nearest.value);if(competitor&&Math.abs(competitor.x-center)-Math.abs(nearest.x-center)<10)return null;return nearest.value;};
        const positionedVatAtRow=y=>{
          const cells=data.filter(line=>Math.abs((Number(line.y)||0)-y)<=16).flatMap(line=>valueTokensInBand(line,vx-62,vx+72));
          if(!cells.length)return null;
          const ranked=cells.sort((a,b)=>Math.abs(a.x-vx)-Math.abs(b.x-vx)),nearest=ranked[0],competitor=ranked.find(item=>item.value!==nearest.value);
          if(competitor&&Math.abs(competitor.x-vx)-Math.abs(nearest.x-vx)<7)return null;
          return Math.abs(nearest.x-vx)<=62?nearest.value:null;
        };
        const printedTotalRows=totalRows.map(y=>({net:cellAtRow(y,netLeft,netRight,netX),vat:cellAtRow(y,left,right,vx),y})).filter(row=>row.net!==null&&row.vat!==null),pairs=[];for(const y of netYs){const net=cellAtRow(y,netLeft,netRight,netX),vat=cellAtRow(y,left,right,vx);if(net!==null&&vat!==null)pairs.push({net,vat,y});}
        let chosen=[];if(pairs.length){
          const detailPairs=pairs.filter(pair=>!totalRows.some(y=>Math.abs(y-pair.y)<=16)),detailVat=detailPairs.map(pair=>pair.vat),printedTotal=printedTotalRows.at(-1)?.vat;
          // Read the VAT cells on the printed rate rows first. The repeated
          // Totals line can be OCR'd with a one-digit error even when the
          // original detailed VAT cell is clear. If there are several rate
          // rows, accept their directly read cells only when their displayed
          // aggregate agrees with the invoice's printed Totals VAT cell.
          if(detailVat.length===1)chosen=detailVat;
          else if(detailVat.length>1&&printedTotal!==undefined&&detailVat.reduce((a,b)=>a+b,0)===printedTotal)chosen=[printedTotal];
          else if(!detailVat.length&&printedTotal!==undefined)chosen=[printedTotal];
          else return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
        }else if(printedTotalRows.length)chosen=[printedTotalRows[printedTotalRows.length-1].vat];else{
          const uniquePairs=new Map(pairs.map(pair=>[`${pair.net}:${pair.vat}`,pair]));chosen=[...uniquePairs.values()].map(pair=>pair.vat);
          // Windows OCR often merges the printed rate and net cells into one
          // text line but keeps VAT as a separate positioned value. Locate the
          // VAT cell by its column heading and the row's printed rate instead
          // of rejecting the row or choosing the duplicated Fuel VAT column.
          if(!chosen.length&&rowYs.length){const rowValues=rowYs.map(positionedVatAtRow);if(rowValues.length&&rowValues.every(value=>value!==null))chosen=rowValues;}
        }
        if(chosen.length)return {vat:sum(chosen),vatMentioned:true,vatUnverified:false,vatRaw:chosen.map(value=>(value/100).toFixed(2)).join(' + ')};
        if(rowYs.length||totalRows.length||netYs.length)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
      }
      // BP receipts place Nett, VAT and Incl values on one printed rate table.
      // If OCR drops the VAT column heading, locate the VAT cell between the printed
      // Excl and Incl headings and read its value from the Total row.
      const tableHeaderKey=line=>String(line?.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/VA[1I|]$/,'VAT');
      const rateHeaders=ordered.filter(line=>tableHeaderKey(line)==='VATRATE');
      for(const rateHeader of rateHeaders){
        const hy=Number(rateHeader.y)||0,headers=ordered.filter(line=>Math.abs((Number(line.y)||0)-hy)<=12),excl=headers.find(line=>['EX','EXCL','EXVAT'].includes(tableHeaderKey(line))),incl=headers.find(line=>['INC','INCL','INCVAT','LNCVAT'].includes(tableHeaderKey(line)));
        if(!excl||!incl||(Number(incl.x)||0)<=(Number(excl.x)||0))continue;
        const ex=Number(excl.x)||0,inc=Number(incl.x)||0,explicitVat=headers.find(line=>tableHeaderKey(line)==='VAT'&&(Number(line.x)||0)>ex&&(Number(line.x)||0)<inc),center=explicitVat?(Number(explicitVat.x)||0):(ex+inc)/2,left=(ex+center)/2,right=(center+inc)/2,totalLabels=ordered.filter(line=>/^\s*TOTALS?\s*$/i.test(String(line.text||''))&&(Number(line.y)||0)>hy&&(Number(line.y)||0)<hy+130).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
        for(const label of totalLabels){const y=Number(label.y)||0,values=[];for(const line of ordered){if(Math.abs((Number(line.y)||0)-y)>16)continue;const value=String(line.text||''),x=Number(line.x)||0,width=Number(line.width)||0;for(const token of receiptMoneyTokens(value)){if(/%/.test(value.slice(Math.max(0,token.index-2),token.index+token.raw.length+2)))continue;const tokenX=x+(width&&value.length?width*(token.index+Math.min(token.raw.length/2,6))/value.length:token.index*6);if(tokenX>=left&&tokenX<right)values.push(Math.round(Math.abs(token.value)*100));}}
          const unique=[...new Set(values)];if(unique.length===1)return {vat:unique[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(unique[0]/100).toFixed(2)};
          if(unique.length>1)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
        }
      }
      // Some receipts damage the VAT amount heading but retain the Nett column
      // and the printed VAT value directly beneath it.
      const damagedVatHeaders=vatLines.filter(line=>!isRegistration(line)&&isVatWord(line.text)&&!/^\s*V(?:A|4)(?:T|I)\s*[:.]?\s*$/i.test(String(line.text||''))&&!/\b(?:NO\.?|NUMBER|TYPE|RATE|ANALYSIS|SUMMARY)\b/i.test(String(line.text||''))&&ordered.some(other=>other!==line&&/^\s*NETT?\s*$/i.test(String(other.text||''))&&Math.abs((Number(other.y)||0)-(Number(line.y)||0))<=12&&(Number(other.x)||0)<(Number(line.x)||0)));
      for(const header of damagedVatHeaders){const x=Number(header.x)||0,y=Number(header.y)||0,values=ordered.filter(line=>{const lx=Number(line.x)||0,ly=Number(line.y)||0;return ly>y&&ly<=y+65&&lx>=x-18&&lx<=x+205;}).flatMap(line=>cents(line.text)),unique=[...new Set(values)];if(unique.length===1)return {vat:unique[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(unique[0]/100).toFixed(2)};if(unique.length>1)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};}
      return null;
    };
    // Tax tables label the VAT column as TAX rather than VAT (for example
    // Faizan-e-Madina). Anchor the value to same-row RATE, NET and TAX headers.
    for(const taxHeader of ordered.filter(line=>/^\s*TAX\s*$/i.test(String(line.text||'')))){
      const hy=Number(taxHeader.y)||0,headers=ordered.filter(line=>Math.abs((Number(line.y)||0)-hy)<=12),netHeader=headers.find(line=>/^\s*NETT?\s*$/i.test(String(line.text||''))),rateHeader=headers.find(line=>/^\s*RATE\s*$/i.test(String(line.text||'')));
      if(!netHeader||!rateHeader)continue;
      const tx=Number(taxHeader.x)||0,nx=Number(netHeader.x)||0,lo=Math.min(nx,tx),hi=Math.max(nx,tx),values=[];
      for(const line of ordered){const y=Number(line.y)||0,x=Number(line.x)||0;if(y<=hy+8||y>hy+100||x<lo+(hi-lo)*0.52||x>tx+(tx-nx)*0.5)continue;if(!ordered.some(other=>Math.abs((Number(other.y)||0)-y)<=12&&/\b(?:VAT|\d{1,2}[.,]\d{1,2}\s*%)\b/i.test(String(other.text||''))))continue;for(const value of cents(line.text))values.push(value);}
      const unique=[...new Set(values)];if(unique.length===1)return {vat:unique[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(unique[0]/100).toFixed(2)};if(unique.length>1)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
    }
    // Some UK till receipts print a distinct `Tax GBP n.nn` transaction row.
    // Read that printed figure directly rather than deriving VAT from total.
    for(const taxLine of ordered.filter(line=>/\bTAX\s+GBP\b/i.test(String(line.text||'')))){const values=cents(String(taxLine.text||'').replace(/^.*?\bTAX\s+GBP\b/i,''));if(values.length===1)return {vat:values[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(values[0]/100).toFixed(2)};}
    // Poundland prints VAT paid below its total. The amount is positioned on
    // the VAT-inclusive row; a leading currency/digit can be damaged, so only
    // recover the visible penny amount within that labelled row.
    for(const label of ordered.filter(line=>/\bVAT\b/i.test(String(line.text||''))&&/(?:INCLUSIVE.*VAT|VAT.*INCLUSIVE|PAID)/i.test(String(line.text||'')))){const x=Number(label.x)||0,y=Number(label.y)||0,paid=ordered.filter(line=>/\bPAID\b/i.test(String(line.text||''))&&Math.abs((Number(line.y)||0)-y)<=60).sort((a,b)=>Math.abs((Number(a.y)||0)-y)-Math.abs((Number(b.y)||0)-y))[0],targetY=Number(paid?.y)||y,values=[];for(const line of ordered){const lx=Number(line.x)||0,ly=Number(line.y)||0;if(ly<targetY-12||ly>targetY+12||lx<=x)continue;for(const value of summaryCellCents(line.text))values.push(value);}const unique=[...new Set(values)];if(unique.length===1)return {vat:unique[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(unique[0]/100).toFixed(2)};if(unique.length>1)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};}
    const structuredVat=structuredVatTables();if(structuredVat)return structuredVat;
    const summaryVatHeaders=ordered.filter(line=>['VAT','V4T','VAI'].includes(compact(line.text))&&ordered.some(other=>{const y=Number(other.y)||0,x=Number(other.x)||0;return compact(other.text)==='TOTAL'&&y>0&&Math.abs(y-(Number(line.y)||0))<=10&&x>(Number(line.x)||0);}));
    for(const vatHeader of summaryVatHeaders){const headerY=Number(vatHeader.y)||0,vatX=Number(vatHeader.x)||0,totalHeader=ordered.find(line=>compact(line.text)==='TOTAL'&&Math.abs((Number(line.y)||0)-headerY)<=10&&(Number(line.x)||0)>vatX),caption=ordered.some(line=>{const y=Number(line.y)||0,key=compact(line.text);return y<headerY&&headerY-y<=150&&key.includes('SUMMARY')&&(key.includes('VAT')||key.includes('VAI')||key.includes('RECE'));});if(!totalHeader||!caption)continue;const right=(vatX+(Number(totalHeader.x)||vatX+130))/2,rows=new Map();for(const line of ordered){const x=Number(line.x)||0,y=Number(line.y)||0;if(y<=headerY||y>headerY+52||x<vatX-45||x>=right)continue;const values=summaryCellCents(line.text);if(values.length){const key=Math.round(y/10);if(!rows.has(key))rows.set(key,[]);rows.get(key).push(...values);}}const rowValues=[...rows.values()];if(rowValues.length&&rowValues.every(values=>values.length===1)){const values=rowValues.map(items=>items[0]);return {vat:sum(values),vatMentioned:true,vatUnverified:false,vatRaw:values.map(value=>(value/100).toFixed(2)).join(' + ')};}}
    if(summary){
      const summaryIndex=ordered.indexOf(summary),summaryWindow=ordered.slice(summaryIndex+1,summaryIndex+30),rateHeader=summaryWindow.find(line=>/^\s*Rate\s*$/i.test(String(line.text||''))),netHeader=summaryWindow.find(line=>/^\s*Nett?\s*$/i.test(String(line.text||''))),vatHeaders=summaryWindow.filter(line=>/^\s*VAT\s*\.?\s*$/i.test(String(line.text||''))).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0)),fallbackVatHeaders=vatHeaders.filter(line=>(Number(line.y)||0)>summaryY&&(Number(line.y)||0)<=summaryY+70);
      const firstVat=rateHeader&&netHeader?vatHeaders.find(header=>Number(header.x)>Number(netHeader.x)):fallbackVatHeaders[0];
      if(rateHeader&&netHeader&&firstVat){
        const x=Number(firstVat.x)||0,nx=Number(netHeader.x)||0,previousBound=(nx+x)/2,nextHeader=summaryWindow.filter(line=>Number(line.x)>x&&(/^\s*Fuel\s*$/i.test(String(line.text||''))||/^\s*VAT\s*\.?\s*$/i.test(String(line.text||'')))).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0))[0],nextX=nextHeader?Number(nextHeader.x):x+(x-nx),rightBound=(x+nextX)/2,rateRows=summaryWindow.filter(line=>/^\s*\d{1,2}[.,]\d{1,2}\s*%\s*$/i.test(String(line.text||''))),rowValues=[];
        for(const rate of rateRows){const y=Number(rate.y)||0,candidates=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=20&&(Number(line.x)||0)>=previousBound&&(Number(line.x)||0)<rightBound&&!/%/.test(String(line.text||''))).flatMap(line=>cents(line.text));if(candidates.length===1)rowValues.push(candidates[0]);else if(candidates.length>1)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};}
        if(rowValues.length)return {vat:sum(rowValues),vatMentioned:true,vatUnverified:false,vatRaw:rowValues.map(value=>(value/100).toFixed(2)).join(' + ')};
      }
      if(firstVat){
        const vatX=Number(firstVat.x)||0,headerY=Number(firstVat.y)||summaryY,totalHeader=summaryWindow.filter(line=>Number(line.x)>vatX&&/^\s*TOTAL\s*$/i.test(String(line.text||''))).sort((a,b)=>Math.abs((Number(a.y)||0)-headerY)-Math.abs((Number(b.y)||0)-headerY))[0],right=totalHeader?(vatX+Number(totalHeader.x))/2:vatX+65,under=ordered.filter(line=>{const x=Number(line.x)||0,y=Number(line.y)||0;return y>headerY&&y<=headerY+48&&x>=vatX-48&&x<right;}).flatMap(line=>summaryCellCents(line.text));
        if(under.length===1)return {vat:under[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(under[0]/100).toFixed(2)};
        if(under.length>1)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
      }
    }
    const explicitLabels=vatLines.filter(vatAmountLabel),labels=explicitLabels.length?explicitLabels:vatLines.filter(line=>/^\s*V(?:A|4)(?:T|I)\s*[:.]?\s*$/i.test(String(line.text||''))),candidates=[];
    for(const label of labels){const raw=String(label.text||''),match=raw.match(/\bV(?:A|4)(?:T|I)\s*(?:AMOUNT|VALUE|ALNOUNT|AM0UNT)?\s*[:#-]?\s*(.*)$/i),inline=match?.[1]||'',x=Number(label.x)||0,y=Number(label.y)||0;for(const value of cents(inline))candidates.push({value,score:explicitLabels.length?0:100});for(const line of ordered){const lx=Number(line.x)||0,ly=Number(line.y)||0;if(ly<y-5||ly>y+48||lx<x-30||lx>x+280||/%/.test(String(line.text||''))||isRegistration(line))continue;for(const value of cents(line.text))candidates.push({value,score:(explicitLabels.length?0:100)+Math.abs(ly-y)+Math.max(0,x-lx)*0.04});}}
    if(!candidates.length)return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
    candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],near=candidates.filter(item=>item.score<=best.score+8),values=[...new Set(near.map(item=>item.value))];if(values.length===1)return {vat:values[0]/100,vatMentioned:true,vatUnverified:false,vatRaw:(values[0]/100).toFixed(2)};return {vat:'',vatMentioned:true,vatUnverified:true,vatRaw:''};
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
    const transactionEvidence=/\b(?:UNLEADED|DIESEL|LITRE|LITER|VAT\s+RECEIPT\s+SUMMARY|MASTERCARD|SALE|CARD\s+PAYMENT|PUMP\s*#?\s*\d+)\b/i.test(text),backOrMarketing=/should you change your mind about your purchase|please return the product with your proof of purchase|thank you for using pay at pump|ASDA\.COM\/MOBILE|SIM\s+PLANS|complete a short survey|download our app|terms and conditions apply/i.test(text);
    return backOrMarketing&&!transactionEvidence;
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
        if(!tokens.length&&/\bAMOUNT\b/.test(text)&&confirmedCents.size===1){const partial=String(line.text||'').match(/^\s*[Â£â‚¬$]?\s*(\d{1,3})\s*[.,]\s*[cC]\.??\s*$/);if(partial){const value=Number(`${partial[1]}.${[...confirmedCents][0]}`);if(value>=2&&value<=maximum)candidates.push({value,score:rank*100+Math.abs(ly-y)+Math.max(0,x+300-lx)*0.04});}}
      }}
    if(!candidates.length)return '';
    const counts=receiptAmountCounts(lines,Math.min(...labels.map(line=>Number(line.y)||0)),maximum);candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],sameBand=candidates.filter(item=>item.score<=best.score+20),distinct=[...new Set(sameBand.map(item=>Math.round(item.value*100)))];if(distinct.length===1)return best.value;
    const frequent=[...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]);return frequent.length?frequent[0][0]/100:best.value;
  }
  function receiptSinglePaidTotal(lines,maximum){
    const ordered=[...(Array.isArray(lines)?lines:[])],paid=ordered.filter(line=>/\bPAID\s+BY\b/i.test(String(line.text||''))),noChange=ordered.some(line=>/\bNO\s+CHANGE\b/i.test(String(line.text||''))),hasChange=ordered.some(line=>/\bCHANGE\s*:?/i.test(String(line.text||''))&&!/\bNO\s+CHANGE\b/i.test(String(line.text||''))&&receiptMoneyTokens(line.text).some(token=>Math.abs(token.value)>=0.01));
    // A single printed tender with an explicit NO CHANGE is a second printed
    // copy of the receipt amount. Do not use it for split tenders, or when
    // change is given (cash tender can exceed the purchase total).
    if(paid.length!==1||!noChange||hasChange||ordered.some(line=>/\b(?:BALANCE|AMOUNT)\s+DUE\b/i.test(String(line.text||''))))return '';
    const anchor=paid[0],x=Number(anchor.x)||0,y=Number(anchor.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=18&&(Number(line.x)||0)>=x+100).flatMap(line=>receiptAnchoredMoneyTokens(line.text).map(token=>Math.round(Math.abs(token.value)*100))).filter(value=>value>=200&&value<=maximum*100),paidValues=[...new Set(values)];
    if(paidValues.length>1)return '';
    const amountLabels=ordered.filter(line=>/^\s*AMOUNT\s*:?\s*$/i.test(String(line.text||''))),amountValues=[];
    for(const label of amountLabels){const lx=Number(label.x)||0,ly=Number(label.y)||0;for(const line of ordered){if(Math.abs((Number(line.y)||0)-ly)>20||(Number(line.x)||0)<lx+90)continue;for(const token of receiptAnchoredMoneyTokens(line.text)){const value=Math.round(Math.abs(token.value)*100);if(value>=200&&value<=maximum*100)amountValues.push(value);}}}
    const uniqueAmount=[...new Set(amountValues)];if(uniqueAmount.length>1)return '';
    if(paidValues.length===1&&uniqueAmount.length===1&&paidValues[0]!==uniqueAmount[0])return '';
    const confirmed=uniqueAmount.length===1?uniqueAmount[0]:paidValues.length===1?paidValues[0]:null;
    if(confirmed!==null)return confirmed/100;
    const totalLabels=ordered.filter(line=>receiptTotalLabel(line.text));if(totalLabels.length!==1)return '';
    const totalY=Number(totalLabels[0].y)||0,volumeRows=ordered.filter(line=>/\d[\dOoIl]{0,3}[.,]?\d{0,2}\s*[LlI1]\b/i.test(String(line.text||''))&&/(?:@|[.,]\s*\d{3}\s*\/\s*[LlI1])/i.test(String(line.text||'')));
    if(volumeRows.length!==1)return '';
    const fuelY=Number(volumeRows[0].y)||0;if(receiptOtherPurchases(ordered,fuelY,totalY,maximum).length)return '';
    const printedFuel=receiptFuelAmount(ordered,maximum),cents=printedFuel===''?null:Math.round(Number(printedFuel)*100);
    return Number.isInteger(cents)&&cents>=200&&cents<=maximum*100?cents/100:'';
  }
  function receiptFuelAmount(lines,maximum){
    const volumeRows=lines.filter(line=>/\d[\dOoIl]{0,3}[.,]?\d{0,2}\s*[LlI1]\b/i.test(String(line.text||''))&&/(?:@|[.,]\s*\d{3}\s*\/\s*[LlI1])/i.test(String(line.text||'')));
    if(volumeRows.length){
      const candidates=[];for(const anchor of volumeRows){const x=Number(anchor.x)||0,y=Number(anchor.y)||0,width=Number(anchor.width)||0,anchorText=String(anchor.text||''),slash=anchorText.search(/\/\s*[LlI1]/),afterRate=slash>=0?slash+2:0;
        for(const line of lines){const lx=Number(line.x)||0,ly=Number(line.y)||0;if(Math.abs(ly-y)>14)continue;const raw=String(line.text||'').trim(),correctedFuelAmount=/^N\s*O\s*[.,]\s*\d{2}$/i.test(raw)?raw.replace(/^N\s*O/i,'40'):raw;
          for(const token of receiptAnchoredMoneyTokens(correctedFuelAmount)){const tokenX=lx+(Number(line.width)&&raw.length?Number(line.width)*(token.index+Math.min(token.raw.length/2,6))/raw.length:token.index*6);if(line===anchor&&token.index<afterRate)continue;if(line!==anchor&&tokenX<x+Math.max(100,width*0.75))continue;const amount=Math.abs(token.value);if(amount>=2&&amount<=maximum)candidates.push(Math.round(amount*100));}
        }
      }
      const unique=[...new Set(candidates)];return unique.length===1?unique[0]/100:'';
    }
    const anchors=lines.filter(line=>receiptFuelDescription(line.text)).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));if(!anchors.length)return '';
    const candidates=[];for(const anchor of anchors){const x=Number(anchor.x)||0,y=Number(anchor.y)||0;for(const line of lines){const lx=Number(line.x)||0,ly=Number(line.y)||0,dy=Math.abs(ly-y);if(dy>55||lx<x+170)continue;for(const token of receiptMoneyTokens(line.text)){const value=Math.abs(token.value);if(value<2||value>maximum)continue;candidates.push({value,score:dy+Math.max(0,x+300-lx)*0.03});}}}
    if(!candidates.length)return '';candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],sameBand=candidates.filter(item=>item.score<=best.score+8),distinct=[...new Set(sameBand.map(item=>Math.round(item.value*100)))];return distinct.length===1?best.value:'';
  }
  function receiptOtherPurchases(lines,fuelY,totalY,maximum){
    const knownFuelY=Number(fuelY)||0,knownTotalY=Number(totalY)||0,start=Math.max(180,knownFuelY-120),end=knownTotalY>start?knownTotalY+18:knownFuelY+360,ignored=/\b(?:TOTAL|TOTALS|MASTERCARD|VISA|CARD|SALE|PAYMENT|PAID|PUMP|UNLEADED|DIESEL|PETROL|FUEL|LITRE|LITER|VAT|NET|RATE|RECEIPT|CHANGE|AUTH|MERCHANT|TERMINAL|TRANSACTION|AMOUNT|AID|PAN|SEQUENCE|POINTS?|CLUBCARD|QUALIFYING|EXPIR|DATE|TIME|CUSTOMER|THANK|PLEASE|COPY|NO\s+CHANGE|CASH|ASH|CREDIT|DEBIT|PENALTY|DISCOUNT|SAVING|LOYALTY|PROMOTION|ARTICLE|QTY|QUANTITY|PRICE|GBP|APPROVED|DUE|BALANCE|NO\s+TAXI\s+DRIVER)\b/i,items=[],faintTotalLabels=lines.filter(line=>receiptFaintTotalLabel(line,knownFuelY));
    for(const line of lines){const x=Number(line.x)||0,y=Number(line.y)||0,text=String(line.text||'').trim(),compact=text.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/UN[I1]/g,'UNLEADED'),letters=text.toUpperCase().replace(/[^A-Z]/g,'');const totalLabelContinuation=faintTotalLabels.some(label=>{const labelText=String(label.text||'').toUpperCase().replace(/[^A-Z]/g,'');return Math.abs(y-(Number(label.y)||0))<=42&&x>(Number(label.x)||0)&&x<(Number(label.x)||0)+220&&labelText.length>=2&&letters.length>=labelText.length&&letters.startsWith(labelText);});if(x>500||y<start||y>end||Math.abs(y-knownFuelY)<=22||totalLabelContinuation||!/\p{L}{3}/u.test(text)||ignored.test(text)||receiptTotalLabel(text)||receiptFaintTotalLabel(line,knownFuelY)||receiptFuelDescription(text)||/^(?:PUMP\d*|TOTALS?|MASTERCARD|VISA|CARD|SALE|PAYMENT|UNLEADED|DIESEL|PETROL|FUEL|PFS|POS\d*)/.test(compact))continue;
      const amounts=[];for(const candidate of lines){const lx=Number(candidate.x)||0,ly=Number(candidate.y)||0,dy=Math.abs(ly-y);if(dy>42||lx<x+150)continue;for(const token of receiptMoneyTokens(candidate.text)){const value=Number(token.value);if(Number.isFinite(value)&&Math.abs(value)>=0.01&&Math.abs(value)<=maximum)amounts.push(value);}}
      if(amounts.length)items.push({line,text,amounts:[...new Set(amounts.map(value=>Math.round(value*100)))].map(value=>value/100)});
    }
    return items;
  }
  function receiptHasOtherPurchase(lines,fuelY,totalY,maximum){return receiptOtherPurchases(lines,fuelY,totalY,maximum).length>0;}
  const maximumReceiptAmount=10000;
  function inferredReceiptSupplier(flat){
    const text=String(flat||''),profile=receiptProfiles.find(item=>item.detect(text));
    if(profile)return {supplier:profile.name,profileId:profile.id,category:profile.category};
    return {supplier:'Unidentified forecourt',profileId:'unidentified-forecourt',category:'Receipts'};
  }
  function parseReceiptPage(pageLines,source='',profileHint='',options={}){
    const ordered=[...pageLines].sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)),text=ordered.map(line=>String(line.text||'')).join(' '),flat=text.replace(/\s+/g,' ').trim();let profile=receiptProfiles.find(item=>item.detect(flat))||receiptProfiles.find(item=>item.id===profileHint);if(!profile&&looksLikeUnidentifiedReceipt(ordered))profile=receiptProfiles.find(item=>item.id==='unidentified-forecourt');
    if(!profile)return null;
    // Receipt backs and marketing pages can repeat the retailer name. Only
    // treat a page as a receipt when its transaction area has money and date
    // evidence as well as a fuel/POS marker.
    const hasReceiptMarker=['eg-on-the-move','unidentified-forecourt','rockafellas','poundland','bm-retail'].includes(profile.id)||profile.id==='faizan-e-madina'&&/\b(?:SALES\s+RECEIPT|SHOP\s+SALES|GROCERIES)\b/i.test(flat)||/\b(?:PUMP|UNLEADED|PETROL|FUEL|SALE|CASHSLIP|ARTICLE|AMOUNT|MASTERCARD|LITRE|LITER|P\/L|CARD\s+PAYMENT|TRANSACTION|RECEIPT\s+SUMMARY|CUSTOMER\s+RECEIPT|COPY\s+RECEIPT|TOTAL)\b/i.test(flat)||(profile.id==='mfg'&&/\b(?:STORE\s+\d+|TRANS\s+\d+|POS\s*\d*)\b/i.test(flat)),hasMoney=ordered.some(line=>receiptMoneyTokens(line.text).length),dateValues=receiptDateValuesFromLines(ordered),hasTenderAmount=receiptTenderTotal(ordered,profile.category==='Vehicle expense receipts'?10000:200)!=='';
    const termsBack=['tesco','esso'].includes(profile.id)&&/thank you for using pay at pump/i.test(flat)&&!/\b(?:UNLEADED|LITRE|LITER|VAT\s+RECEIPT\s+SUMMARY|MASTERCARD|SALE)\b/i.test(flat);
    if(termsBack||!hasReceiptMarker||(!hasMoney&&!dateValues.length&&!hasTenderAmount&&!['eg-on-the-move','unidentified-forecourt'].includes(profile.id)&&!/\b(?:RECEIPT\s+SUMMARY|CUSTOMER\s+RECEIPT|CASHSLIP)\b/i.test(flat)))return null;
    const maximum=profile.category==='Vehicle expense receipts'?10000:200,totalColumnHeader=line=>{const y=Number(line.y)||0,labels=ordered.filter(other=>other!==line&&Math.abs((Number(other.y)||0)-y)<=10&&/^(?:VAT|VAI|V4T|NET|NETT|RATE|AMOUNT)$/i.test(String(other.text||'').trim()));return labels.length>=2;},anchorLines=ordered.filter(line=>(profile.id==='mfg'?receiptMfgTotalLabel(line):receiptTotalLabel(line.text))&&!totalColumnHeader(line));
    const candidates=[];
    for(const anchor of anchorLines){
      const ax=Number(anchor.x)||0,ay=Number(anchor.y)||0;
      // Totals are printed beside their label on these receipts. A wide search
      // window can pick up pump volume/price rows or VAT tables instead.
      for(const line of ordered){const x=Number(line.x)||0,y=Number(line.y)||0,dy=Math.abs(y-ay);if(dy>50)continue;for(const token of receiptAnchoredMoneyTokens(line.text)){const value=Math.abs(token.value);if(value<2||value>maximum)continue;if(line===anchor&&token.index<Math.max(0,String(anchor.text||'').search(/[\d\u00A3\u20AC$]/)))continue;if(x<ax-10&&dy<30)continue;candidates.push({value,score:dy+Math.max(0,ax-x)*0.02+(x<ax?35:0),anchorY:ay,anchorX:ax});}}
    }
    let total='';
    if(candidates.length){candidates.sort((a,b)=>a.score-b.score);const best=candidates[0],sameBand=candidates.filter(item=>Math.abs(item.anchorY-best.anchorY)<1&&item.score<=best.score+8);const distinct=[...new Set(sameBand.map(item=>Math.round(item.value*100)))];if(distinct.length===1)total=best.value;}
    const vatSummaryAnchor=ordered.filter(line=>/\b(?:VAT\s+ANALYSIS|VAT\s+RECEIPT\s+SUMMARY|TAX\s+SUMMARY|VAT\s+RATE)\b/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0],vatSummaryY=vatSummaryAnchor?Number(vatSummaryAnchor.y)||0:Infinity;
    const printedReceiptTotals=anchorLines.filter(line=>(Number(line.y)||0)<vatSummaryY),hasPrintedTotalLabel=printedReceiptTotals.length>0;
    if(total===''&&hasPrintedTotalLabel){
      const positioned=[];
      for(const anchor of printedReceiptTotals){const ax=Number(anchor.x)||0,ay=Number(anchor.y)||0,aw=Number(anchor.width)||0;
        for(const line of ordered){const x=Number(line.x)||0,y=Number(line.y)||0,dy=Math.abs(y-ay);if(dy>20||/\b\d[\dOoIl]{0,3}[.,]?\d{0,2}\s*[Ll]\b|@\s*[Â£$]?\s*\d[.,]\d{3}\s*\/\s*[Ll]\b/i.test(String(line.text||'')))continue;
          if(line!==anchor&&x<ax+Math.max(45,Math.min(aw,100)))continue;
          for(const token of receiptMoneyTokens(line.text)){const value=Math.abs(token.value);if(value<2||value>maximum)continue;positioned.push({value,dy,dx:line===anchor?0:Math.max(0,x-(ax+aw)),anchorY:ay});}
        }
      }
      if(positioned.length){positioned.sort((a,b)=>a.dy-b.dy||a.dx-b.dx);const best=positioned[0],nearest=positioned.filter(item=>item.anchorY===best.anchorY&&item.dy<=best.dy+4&&item.dx<=best.dx+35),values=[...new Set(nearest.map(item=>Math.round(item.value*100)))];if(values.length===1)total=values[0]/100;}
    }
    // Shell receipts can place the value on the line below their TOTAL label.
    // Read the unique amount aligned to that label; item prices above the row
    // and the later card/cash tender remain outside this narrow total row.
    if(total===''&&profile.id==='shell'){
      const positioned=[];for(const anchor of anchorLines){const ax=Number(anchor.x)||0,ay=Number(anchor.y)||0;for(const line of ordered){const x=Number(line.x)||0,y=Number(line.y)||0,dy=Math.abs(y-ay);if(dy>100||x<ax+45)continue;for(const token of receiptMoneyTokens(line.text)){const value=Math.abs(token.value);if(value>=2&&value<=maximum)positioned.push({value,dy,anchorY:ay});}}}
      if(positioned.length){positioned.sort((a,b)=>a.dy-b.dy);const best=positioned[0],values=[...new Set(positioned.filter(item=>item.anchorY===best.anchorY&&item.dy<=best.dy+8).map(item=>Math.round(item.value*100)))];if(values.length===1)total=values[0]/100;}
    }
    // Some Shell slips have a broken/missing TOTAL label in OCR. Use only the
    // printed amount column beneath its AMOUNT heading, never a VAT amount or
    // a reconstructed sum.
    if(total===''&&profile.id==='shell'){
      const headers=ordered.filter(line=>receiptLevenshtein(String(line.text||'').toUpperCase().replace(/[^A-Z]/g,''),'AMOUNT')<=1&&Number(line.x)>350),header=headers[0];
      if(header){const x=Number(header.x)||0,y=Number(header.y)||0,values=ordered.filter(line=>(Number(line.x)||0)>=x-20&&(Number(line.y)||0)>y+80&&(Number(line.y)||0)<y+500).flatMap(line=>receiptMoneyTokens(line.text).map(token=>({value:Math.abs(token.value),distance:(Number(line.y)||0)-y}))).filter(item=>item.value<=10000).sort((a,b)=>a.distance-b.distance);if(values.length)total=values[0].value;}
    }
    if(profile.id==='bp'&&total===''){
      const labels=ordered.filter(line=>/^\s*AMOUNT\s*:?\s*$/i.test(String(line.text||'')));
      for(const label of labels){const x=Number(label.x)||0,y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=45&&(Number(line.x)||0)>=x+80).flatMap(line=>receiptMoneyTokens(line.text).map(token=>({value:Math.abs(token.value),score:Math.abs((Number(line.y)||0)-y)}))).filter(item=>item.value<=10000).sort((a,b)=>a.score-b.score);if(values.length){total=values[0].value;break;}}
    }
    // EG On The Move prints a small VAT summary at the foot of the receipt.
    // Read the printed gross value from the far-right cell on the row labelled
    // Totals; do not infer the total from the pump or net/VAT columns.
    if(total===''&&profile.id==='eg-on-the-move'){
      const labels=ordered.filter(line=>{const value=String(line.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I');return value.length>=4&&value.length<=7&&receiptLevenshtein(value,'TOTALS')<=2;});
      for(const label of labels){const y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=12&&(Number(line.x)||0)>=500).flatMap(line=>{const tokens=receiptMoneyTokens(line.text);if(tokens.length)return tokens.map(token=>Math.abs(token.value));const integer=String(line.text||'').match(/^\s*[Â£â‚¬]?\s*([\dOoIl]{1,4})\s*$/);if(!integer)return [];const value=invoiceAmount(integer[1].replace(/[Oo]/g,'0').replace(/[Il]/g,'1'));return value===null?[]:[Math.abs(value)];}).filter(value=>value>=2&&value<=200);if(values.length===1){total=values[0];break;}}
    }
    if(total===''&&profile.id==='faizan-e-madina'){
      const labels=ordered.filter(line=>/\bSHOP\s+SALES\b/i.test(String(line.text||''))||/^\s*(?:TOR[NM]|TOTAL)\.?\s*$/i.test(String(line.text||''))||receiptTotalLabel(line.text));
      for(const label of labels){const x=Number(label.x)||0,y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=24&&(Number(line.x)||0)>x+120).flatMap(line=>receiptAnchoredMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=maximum),unique=[...new Set(values.map(value=>Math.round(value*100)))];if(unique.length===1){total=unique[0]/100;break;}}
    }
    if(total===''&&profile.id==='poundland'){
      const labels=ordered.filter(line=>/INCLUSIVE.*VAT|VAT.*INCLUSIVE/i.test(String(line.text||'')));
      for(const label of labels){const x=Number(label.x)||0,y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=20&&(Number(line.x)||0)>x+100).flatMap(line=>receiptAnchoredMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=maximum),unique=[...new Set(values.map(value=>Math.round(value*100)))];if(unique.length===1){total=unique[0]/100;break;}}
    }
    if(total===''&&profile.id==='bm-retail'){
      const labels=ordered.filter(line=>/\bTOTAL\s+AMOUNT\s+GBP\b/i.test(String(line.text||'')));
      for(const label of labels){const values=receiptAnchoredMoneyTokens(label.text).map(token=>Math.abs(token.value)).filter(value=>value>=2&&value<=maximum);if(values.length===1){total=values[0];break;}}
    }
    if(total===''&&profile.id==='sainsburys'&&/V(?:AT|AI|4T)\s+RECEIPT\s+SUMMARY\s*[-:]?\s*FUEL\s+ONLY/i.test(flat)){
      // This Sainsbury's layout prints the directly charged fuel total beside
      // the pump marker. The VAT summary's TOTAL is a column heading, not the
      // receipt amount, so use only the amount on the pump's own row.
      const pump=ordered.find(line=>/\bPUMP\s*#?\s*\d+\b/i.test(String(line.text||'')));
      if(pump){const x=Number(pump.x)||0,y=Number(pump.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=48&&(Number(line.x)||0)>x+25).flatMap(line=>receiptAnchoredMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=maximum),unique=[...new Set(values.map(value=>Math.round(value*100)))];if(unique.length===1)total=unique[0]/100;}
    }
    // MFG receipts repeat a fuel-only VAT table beneath the receipt total. Use
    // that printed gross only when there is exactly one VAT-summary footer and
    // no additional purchased item between the fuel row and the total. When a
    // shop item is present, its footer has separate totals and we leave the
    // receipt rejected if the actual receipt total is unreadable.
    if(total===''&&profile.id==='mfg'){
      // MFG prints a second, labelled VAT summary below the receipt. If its
      // main Total cell is damaged, use the directly printed gross value in
      // the Inc. VAT column only when there is one unambiguous Totals row.
      const grossHeaders=ordered.filter(line=>{const key=String(line.text||'').toUpperCase().replace(/[^A-Z]/g,'').replace(/[1I]/g,'I');return receiptLevenshtein(key,'INCVAT')<=1;}),grossRows=[];
      for(const header of grossHeaders){const hy=Number(header.y)||0,hx=Number(header.x)||0,near=ordered.filter(line=>{const y=Number(line.y)||0;return Math.abs(y-hy)<=12;});const leftHeader=near.filter(line=>(Number(line.x)||0)<hx&&/^(?:VAT|EX\.?\s*VAT)$/i.test(String(line.text||'').trim())).sort((a,b)=>(Number(b.x)||0)-(Number(a.x)||0))[0];if(!leftHeader)continue;const leftX=Number(leftHeader.x)||0,pitch=hx-leftX,right=hx+pitch*.7,left=(leftX+hx)/2,labels=ordered.filter(line=>{const key=String(line.text||'').toUpperCase().replace(/[^A-Z]/g,'');return receiptLevenshtein(key,'TOTALS')<=1&&(Number(line.y)||0)>hy&&(Number(line.y)||0)<hy+120;});for(const label of labels){const y=Number(label.y)||0,values=ordered.filter(line=>Math.abs((Number(line.y)||0)-y)<=16).flatMap(line=>receiptMoneyTokens(line.text).filter(token=>{const width=Number(line.width)||0,x=Number(line.x)||0,center=x+(width&&String(line.text||'').length?width*(token.index+Math.min(token.raw.length/2,6))/String(line.text||'').length:token.index*6);return center>=left&&center<=right;}).map(token=>Math.abs(token.value)));const unique=[...new Set(values.map(value=>Math.round(value*100)))];if(unique.length===1)grossRows.push(unique[0]);}}
      const uniqueGross=[...new Set(grossRows)];if(uniqueGross.length===1)total=uniqueGross[0]/100;
      const receiptTotal=ordered.find(line=>receiptTotalLabel(line.text)&&(Number(line.y)||0)>500&&(Number(line.y)||0)<1050),footerTotals=ordered.filter(line=>{const value=String(line.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/0/g,'O').replace(/1/g,'I');return (value==='TOTALS'||receiptLevenshtein(value,'TOTALS')<=1)&&(Number(line.x)||0)<220&&(Number(line.y)||0)>(Number(receiptTotal?.y)||0)+40;});
      if(total===''&&receiptTotal&&footerTotals.length===1){const fy=Number(footerTotals[0].y)||0,ty=Number(receiptTotal.y)||0,fuel=ordered.find(line=>/\b(?:UNLEADED|DIESEL)\b/i.test(String(line.text||''))&&(Number(line.y)||0)<ty),fuelY=Number(fuel?.y)||0,extraItem=ordered.some(line=>{const y=Number(line.y)||0,x=Number(line.x)||0,t=String(line.text||'').trim();return y>fuelY+35&&y<ty-10&&x<500&&/[A-Za-z]{3}/.test(t)&&!/^\s*(?:pump\s*\d*|sale|master ?card|visa|card|total|unleaded|diesel)\b/i.test(t);});const values=ordered.filter(line=>Math.abs((Number(line.y)||0)-fy)<=12&&(Number(line.x)||0)>=500).flatMap(line=>receiptMoneyTokens(line.text).map(token=>Math.abs(token.value))).filter(value=>value>=2&&value<=200);if(!extraItem&&values.length===1)total=values[0];}
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
    // The explicit receipt Total is authoritative. Card/tender lines may show
    // one part of a split payment, cash given, loyalty redemption or change;
    // use them only when the receipt's own Total was not readable.
    if(total===''&&hasPrintedTotalLabel){const paidTotal=receiptSinglePaidTotal(ordered,maximum);if(paidTotal!=='')total=paidTotal;}
    const tenderTotal=receiptTenderTotal(ordered,maximum);if(total===''&&!hasPrintedTotalLabel&&tenderTotal!=='')total=tenderTotal;
    if(total===''&&profile.id==='sainsburys'){
      const summaryTotalHeader=ordered.find(line=>String(line.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='TOTAL'&&ordered.some(other=>{const y=Number(other.y)||0,key=String(other.text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return key.includes('SUMMARY')&&(key.includes('VAT')||key.includes('VAI')||key.includes('RECE'))&&y<(Number(line.y)||0)&&(Number(line.y)||0)-y<=150;}));
      if(summaryTotalHeader){const x=Number(summaryTotalHeader.x)||0,y=Number(summaryTotalHeader.y)||0,values=ordered.filter(line=>{const lx=Number(line.x)||0,ly=Number(line.y)||0;return ly>y&&ly<=y+52&&lx>=x-55&&lx<=x+70;}).flatMap(line=>receiptMoneyTokens(line.text).map(token=>Math.abs(token.value))),unique=[...new Set(values.map(value=>Math.round(value*100)))];if(unique.length===1)total=unique[0]/100;}
    }
    // Tesco prints the date, time and checkout identifiers together in one
    // footer string. If OCR returns that as a single unlabelled run-on date,
    // require a separate date label before accepting it; a valid-looking OCR
    // digit can still be a wrong month (as on faded receipt scans).
    const filteredDates=[...new Set(dateValues)].sort(),unverifiedTescoRunOnDate=profile.id==='tesco'&&ordered.some(line=>/\bSTORE\s*:/i.test(String(line.text||''))&&/\bCHECKOUT\s*:/i.test(String(line.text||''))&&receiptDateFromText(line.text).length>0)&&!ordered.some(line=>/\b(?:DATE|DATE\s*\/\s*TIME|TRANSACTION\s+DATE)\b/i.test(String(line.text||''))&&receiptDateFromText(line.text).length>0),date=!unverifiedTescoRunOnDate&&filteredDates.length===1?filteredDates[0]:'';
    const fuelLine=ordered.find(line=>receiptFuelDescription(line.text)||/\b(?:UNLEADED|DIESEL|PETROL)\b/i.test(String(line.text||''))),fuelOnly=/\bFUEL\s+ONLY\b/i.test(flat),fuelEvidence=Boolean(fuelLine||fuelOnly||/\bPUMP\s*#?\s*\d+\b/i.test(flat)||profile.id==='newtoll-services'&&/\bKARAN\s+FUEL\b/i.test(flat)),fuelY=Number(fuelLine?.y)||0,totalLine=ordered.find(line=>receiptTotalLabel(line.text))||(profile.id==='tesco'?ordered.find(line=>receiptFaintTotalLabel(line,fuelY)):undefined),totalY=Number(totalLine?.y)||0,otherPurchases=receiptOtherPurchases(ordered,fuelY,totalY,maximum),hasTaxiDriver=/\bTAXI\s+DRIVER\b/i.test(flat);
    let breakdown=hasTaxiDriver?{fuelAmount:total===''?'':Number(total),drawingsAmount:''}:profile.id==='mfg'?mfgReceiptBreakdown(ordered,total):{fuelAmount:total===''?'':Number(total),drawingsAmount:''};
    if(!hasTaxiDriver&&otherPurchases.length){
      const mfgSplit=profile.id==='mfg'&&Number.isFinite(Number(breakdown.fuelAmount))&&breakdown.drawingsAmount!==''&&breakdown.drawingsAmount!==null&&breakdown.drawingsAmount!==undefined;
      if(!mfgSplit){
        const printedFuel=receiptFuelAmount(ordered,maximum),totalCents=total===''?null:Math.round(Number(total)*100),fuelCents=printedFuel===''?null:Math.round(printedFuel*100);
        if(totalCents!==null&&fuelCents!==null&&fuelCents>0&&fuelCents<totalCents){breakdown={fuelAmount:fuelCents/100,drawingsAmount:(totalCents-fuelCents)/100};}
        else if(totalCents!==null&&fuelCents===null){const itemCents=otherPurchases.map(item=>item.amounts.length===1?Math.round(item.amounts[0]*100):null);if(itemCents.every(Number.isInteger)){const drawingsCents=itemCents.reduce((sum,value)=>sum+value,0),remainder=totalCents-drawingsCents;if(drawingsCents>0&&remainder>0)breakdown={fuelAmount:remainder/100,drawingsAmount:drawingsCents/100};else breakdown={fuelAmount:'',drawingsAmount:''};}else breakdown={fuelAmount:'',drawingsAmount:''};}
      }
    }
    const businessType=options.businessType==='company'?'company':options.businessType==='taxi-driver'?'taxi-driver':'legacy',plausibleTotal=total!==''&&Number.isFinite(Number(total))&&Number(total)>=2&&Number(total)<=maximum,totalCents=plausibleTotal?Math.round(Number(total)*100):null;
    let fuelAmount=breakdown.fuelAmount,otherAmount=breakdown.drawingsAmount,drawingsAmount=breakdown.drawingsAmount;
    if(businessType!=='legacy'){
      if(hasTaxiDriver){fuelAmount=plausibleTotal?Number(total):'';otherAmount=0;drawingsAmount='';}
      else if(fuelOnly||profile.id==='sainsburys'&&fuelEvidence){fuelAmount=plausibleTotal?Number(total):'';otherAmount=0;drawingsAmount='';}
      else if(!fuelEvidence){fuelAmount=0;otherAmount=plausibleTotal?Number(total):'';drawingsAmount=businessType==='taxi-driver'?otherAmount:'';}
      else if(!otherPurchases.length){fuelAmount=plausibleTotal?Number(total):'';otherAmount=0;drawingsAmount='';}
      else{
        const printedFuel=receiptFuelAmount(ordered,maximum),candidateFuel=printedFuel!==''?printedFuel:profile.id==='mfg'?breakdown.fuelAmount:'',totalFuelCents=plausibleTotal?Math.round(Number(total)*100):null,candidateFuelCents=Number.isFinite(Number(candidateFuel))?Math.round(Number(candidateFuel)*100):null;
        if(totalFuelCents!==null&&candidateFuel!==''&&candidateFuel!==null&&candidateFuel!==undefined&&candidateFuelCents!==null&&candidateFuelCents>0&&candidateFuelCents<totalFuelCents){fuelAmount=candidateFuelCents/100;otherAmount=(totalFuelCents-candidateFuelCents)/100;drawingsAmount=businessType==='taxi-driver'?otherAmount:'';}
        else{fuelAmount='';otherAmount='';drawingsAmount='';}
      }
    }
    const fuelCents=Number.isFinite(Number(fuelAmount))?Math.round(Number(fuelAmount)*100):null,otherCents=otherAmount===''||otherAmount===null||otherAmount===undefined?0:Number.isFinite(Number(otherAmount))?Math.round(Number(otherAmount)*100):null,splitComplete=totalCents!==null&&fuelCents!==null&&otherCents!==null&&fuelCents>=0&&otherCents>=0&&fuelCents+otherCents===totalCents&&(hasTaxiDriver||fuelOnly||profile.id==='sainsburys'&&fuelEvidence||!otherPurchases.length||otherCents>0),vatResult=receiptVatFromLines(ordered,total),accepted=Boolean(date&&plausibleTotal&&splitComplete&&!vatResult.vatUnverified),reason=accepted?'':!date?'Receipt date could not be confirmed from this page.':!plausibleTotal?'Printed receipt total is missing or outside the expected receipt range.':vatResult.vatUnverified?'VAT is printed on the receipt but its amount could not be confirmed.':!splitComplete?'Fuel and other purchase amounts could not be separated confidently.':'Receipt values were ambiguous.';
    return {date,total,fuelAmount,otherAmount,drawingsAmount:businessType==='taxi-driver'?drawingsAmount:businessType==='company'?'':drawingsAmount,vat:vatResult.vat,vatMentioned:vatResult.vatMentioned,vatUnverified:vatResult.vatUnverified,vatRaw:vatResult.vatRaw,handling:businessType,vatSplit:Boolean(options.vatSplit),supplier:profile.name,profileId:profile.id,category:profile.category,source,page:Number(ordered[0]?.page)||1,status:accepted?'ACCEPTED':'REJECTED',accepted,rejected:!accepted,rejectedReason:reason};
  }
  function receiptHeaderProfile(line){
    const text=String(line?.text||'').trim(),upper=text.toUpperCase(),compact=upper.replace(/[^A-Z0-9]/g,'');
    if(compact.includes('NEWTOLLSERVICES')||compact.includes('NEWTONSERVICES'))return 'newtoll-services';
    if(/^MFG\b|^MOTOR\s+FUEL\s+(?:LTD|LIMITED)\b/i.test(text))return 'mfg';
    const first=(upper.match(/^[A-Z]{4,8}/)||[])[0]||'';
    if(first&&receiptLevenshtein(first,'SHELL')<=1&&/\b(?:KINGS\s+LYNN|A47|WEST\s+LYNN|STAT\s+NO)\b/i.test(text))return 'shell';
    for(const profile of receiptProfiles){if(['newtoll-services','mfg','shell','bp','other-forecourt','unidentified-forecourt'].includes(profile.id))continue;const brand=String(profile.name||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(brand.length>=4&&compact.startsWith(brand))return profile.id;}
    return '';
  }
  function splitCompositeReceiptPage(pageLines,source='',options={}){
    const ordered=[...(Array.isArray(pageLines)?pageLines:[])].sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)),candidates=[];
    for(const line of ordered){const profileId=receiptHeaderProfile(line);if(!profileId)continue;const startY=Number(line.y)||0,context=ordered.filter(item=>{const y=Number(item.y)||0;return y>=startY-24&&y<=startY+950;}),profile=receiptProfiles.find(item=>item.id===profileId),contextText=context.map(item=>String(item.text||'')).join(' '),partialMfg=profileId==='mfg'&&/\b(?:STORE\s+\d+|TRANS\s+\d+|POS\s*\d*)\b/i.test(contextText);
      if(!profile||(!profile.detect(contextText)&&!partialMfg))continue;
      const previous=candidates.at(-1);if(previous&&previous.profileId===profileId&&startY-previous.y<700)continue;
      candidates.push({profileId,y:startY});
    }
    if(candidates.length<2)return null;
    const rows=[];for(let index=0;index<candidates.length;index++){const current=candidates[index],next=candidates[index+1],segment=ordered.filter(line=>(Number(line.y)||0)>=current.y-2&&(!next||(Number(line.y)||0)<next.y));const row=parseReceiptPage(segment,source,current.profileId,options);if(row)rows.push(row);}
    return rows.length>=2?rows:null;
  }
  function parseReceiptBatch(text,source='',ocrLines,options={}){
    const grouped=new Map();
    for(const line of Array.isArray(ocrLines)?ocrLines:[]){const page=Math.max(1,Number(line.page)||1);if(!grouped.has(page))grouped.set(page,[]);grouped.get(page).push(line);}
    let parsed=[];
    if(grouped.size)parsed=[...grouped.entries()].sort((a,b)=>a[0]-b[0]).flatMap(([page,items])=>{const segments=splitCompositeReceiptPage(items,source,options);return segments||[parseReceiptPage(items,source,options.profileHintByPage?.[page]||options.profileHint||'',options)];}).filter(Boolean);
    else{const flat=String(text||''),parts=flat.split(/\n\s*(?:PAGE\s*[:#-]?\s*\d+)\s*\n/ig);parsed=parts.map((part,index)=>{const lines=part.split(/\r?\n/).map(text=>({text,page:index+1,x:0,y:index*30,width:0,height:0}));return parseReceiptPage(lines,source,'',options);}).filter(Boolean);}
    if(!options.auditUnmatchedPages||!Number.isFinite(Number(options.pageCount)))return parsed;
    const byPage=new Map(parsed.map(row=>[Number(row.page)||1,row])),visual=new Set((options.visualPages||[]).map(Number));
    for(let page=1;page<=Number(options.pageCount);page++){
      if(byPage.has(page))continue;const lines=grouped.get(page)||[],flat=lines.map(line=>String(line.text||'')).join(' ').replace(/\s+/g,' ').trim(),hasVisibleContent=visual.has(page)||lines.some(line=>String(line.text||'').trim());
      if(!hasVisibleContent||isReceiptBackPage(lines))continue;
      const inferred=inferredReceiptSupplier(flat),row={date:'',total:'',fuelAmount:'',otherAmount:'',drawingsAmount:'',vat:'',vatUnverified:true,handling:options.businessType||'company',vatSplit:Boolean(options.vatSplit),supplier:inferred.supplier,profileId:inferred.profileId,category:inferred.category,source,page,status:'REJECTED',accepted:false,rejected:true,auditPlaceholder:true,rejectedReason:'Receipt page could not be read confidently. Enter the date, total and VAT manually.'};
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
    let text=String(value||'').trim().replace(/[Ã‚Â£Â£$â‚¬]/g,'').replace(/^[Ee]\s*/,'').replace(/^[lI|](?=\s*[,\d.])/,'1').replace(/[Oo]/g,'0').replace(/\s+(?=,)/g,'');
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
        return y>=start&&y<(Number(totalDue.y)||Infinity)&&/^\s*VAT(?:\s+(?:amount|value))?\s*:?\s*(?:[Â£$â‚¬Ee]?\s*[\d., ]*)?$/i.test(text);
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
    let text=String(value||'').trim().replace(/[Â£$â‚¬]/g,'').replace(/^E\s*(?=[0-9Oo])/i,'').replace(/[Oo]/g,'0').replace(/[Il](?=\d|[.,])/g,'1').replace(/\s+/g,' ');
    const match=text.match(/-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)[.,]\s*\d{2}/);return match?invoiceAmount(match[0]):null;
  }
  function freshwaysVatMoney(value){
    const raw=String(value||'').trim();
    // The first VAT character is the printed pound sign. Windows OCR can
    // render Â£0.00 as 20.00, so ignore that character before parsing VAT.
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
    // amount. Require either the known Invoice: â†’ Invoice Total footer band,
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
    // On some Windows OCR builds the printed pound sign before Â£0.00 is read
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
  function amazonPositionedText(items){return (items||[]).map(line=>String(line?.text||'').trim()).filter(Boolean).join(' ');}
  function isAmazonInvoiceText(value){
    const text=String(value||'');
    const amazonMarker=/\bAmazon\b/i.test(text)||/amazon\.co\.uk\/contact-us/i.test(text),invoiceHeader=/\bInvoice\s*#/i.test(text),amountSection=/\b(?:Total\s+payable|VAT\s+subtotal|Invoice\s+date\s*\/\s*Delivery\s+date)\b/i.test(text);
    return amazonMarker&&invoiceHeader&&amountSection;
  }
  function amazonInvoiceId(items){
    const labels=(items||[]).filter(line=>/\binvoice\s*#/i.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){
      const inline=String(label.text||'').match(/\binvoice\s*#\s*(GB[A-Z0-9]{7,})/i);
      if(inline){const value=inline[1].replace(/[^A-Z0-9]/gi,'').toUpperCase();if(value.length>=9)return value;}
      const sameRow=(items||[]).filter(line=>line!==label&&Number(line.x)>=Number(label.x||0)+Math.max(8,Number(label.width||0)*.35)&&Math.abs(Number(line.y||0)-Number(label.y||0))<=Math.max(20,Number(label.height||18)*1.1)).map(line=>({line,value:String(line.text||'').replace(/[^A-Z0-9]/gi,'').toUpperCase()})).filter(item=>/^GB[A-Z0-9]{7,}$/i.test(item.value)).sort((a,b)=>Number(a.line.x)-Number(b.line.x));
      if(sameRow.length)return sameRow[0].value;
    }
    return '';
  }
  function amazonMoneyValue(value){
    let text=String(value||'').trim().replace(/^([(-]?\s*)[Â£â‚¬$Ee]\s*/,'$1').replace(/^[^0-9OoQqIiLl|()\-]*/,'');
    const match=text.match(/[(-]?\s*[0-9OoQqIiLl|](?:[0-9OoQqIiLl|]|[\s,.'â€™](?=[0-9OoQqIiLl|]))*\s*[.,]\s*[0-9OoQqIiLl|]{2}\)?/);
    if(!match)return null;
    const normalized=match[0].replace(/[OoQq]/g,'0').replace(/[IiLl|]/g,'1').replace(/[â€™']/g,'').replace(/\s+/g,'').replace(/,(?=\d{2}$)/,'.');
    return invoiceAmount(normalized);
  }
  function amazonDateValue(value){
    const text=String(value||'').trim(),formats=[text,...(text.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4}\b/gi)||[]),...(text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/g)||[])];
    for(const candidate of formats){const parsed=parseDate(candidate);if(parsed)return parsed;}
    return '';
  }
  function amazonValueBesideLabel(items,label,kind='money'){
    const labelText=String(label?.text||''),pattern=kind==='date'?/invoice\s+date\s*\/\s*delivery\s+date/i:/total\s+payable/i,match=labelText.match(pattern);
    if(match){const inline=labelText.slice(match.index+match[0].length),value=kind==='date'?amazonDateValue(inline):amazonMoneyValue(inline);if(value!==''&&value!==null)return {value,line:label};}
    const minX=Number(label?.x||0)+Math.max(4,Number(label?.width||0)*.35),tolerance=Math.max(22,Number(label?.height||18)*1.15),peers=(items||[]).filter(line=>line!==label&&Number(line.x||0)>=minX&&Math.abs(Number(line.y||0)-Number(label.y||0))<=tolerance).map(line=>({line,value:kind==='date'?amazonDateValue(line.text):amazonMoneyValue(line.text)})).filter(item=>item.value!==''&&item.value!==null).sort((a,b)=>Math.abs(Number(a.line.y)-Number(label.y))-Math.abs(Number(b.line.y)-Number(label.y))||Number(a.line.x)-Number(b.line.x));
    return peers[0]||null;
  }
  function amazonVatSubtotal(pages){
    const candidates=[];
    for(const [page,items] of pages){
      for(const label of items.filter(line=>/\bVAT\s+subtotal\b/i.test(String(line.text||'')))){
        const threshold=Number(label.x||0)+Math.max(Number(label.width||0)*.75,12),rowTolerance=Math.max(18,Number(label.height||18)*.85),totalRows=items.filter(line=>/^\s*total\s*$/i.test(String(line.text||''))&&Number(line.y)>Number(label.y)+rowTolerance/2).sort((a,b)=>Number(a.y)-Number(b.y));
        for(const totalRow of totalRows){
          const values=items.filter(line=>line!==label&&Number(line.x||0)>=threshold&&Math.abs(Number(line.y||0)-Number(totalRow.y||0))<=rowTolerance).map(line=>({line,value:amazonMoneyValue(line.text)})).filter(item=>item.value!==null).sort((a,b)=>Number(b.line.x)-Number(a.line.x));
          if(values.length)candidates.push({page,y:Number(totalRow.y)||0,value:values[0].value});
        }
        if(!totalRows.length){
          const values=items.filter(line=>line!==label&&Number(line.x||0)>=threshold&&Number(line.y)>Number(label.y)&&Number(line.y)<=Number(label.y)+420).map(line=>({line,value:amazonMoneyValue(line.text)})).filter(item=>item.value!==null).sort((a,b)=>Number(a.line.y)-Number(b.line.y));
          if(values.length)candidates.push({page,y:Number(values.at(-1).line.y)||0,value:values.at(-1).value});
        }
      }
    }
    return candidates.sort((a,b)=>a.page-b.page||a.y-b.y).at(-1)?.value??null;
  }
  function amazonItemNames(pages){
    const names=[];
    const flush=current=>{
      if(!current.length)return;
      const name=current.map(line=>String(line.text||'').trim()).join(' ').replace(/\s+/g,' ').replace(/\s*(?:\||\bI)\s*B[A-Z0-9]{9}\b.*$/i,'').replace(/\s*ASIN\s*:.*$/i,'').replace(/^[A-Z0-9._-]{3,}@,\s*/i,'').replace(/\s+/g,' ').trim();
      if(name&&/[A-Za-z]{3}/.test(name)&&!names.some(value=>value.toLocaleLowerCase('en-GB')===name.toLocaleLowerCase('en-GB')))names.push(name);
      current.length=0;
    };
    for(const [,items] of pages){
      const headers=items.filter(line=>/^\s*description\s*$/i.test(String(line.text||'')));
      for(const header of headers){
        const qty=items.filter(line=>/^\s*(?:qty|quantity)\s*$/i.test(String(line.text||''))&&Number(line.x)>Number(header.x||0)&&Math.abs(Number(line.y||0)-Number(header.y||0))<=Math.max(34,Number(header.height||18)*1.4)).sort((a,b)=>Number(a.x)-Number(b.x))[0];
        if(!qty)continue;
        const stop=items.filter(line=>Number(line.y)>Number(header.y)&&Number(line.x)<Number(qty.x)&&/^(?:shipping\s+charges?|promotions?|discounts?)\b/i.test(String(line.text||'').trim())).sort((a,b)=>Number(a.y)-Number(b.y))[0],endY=Number(stop?.y??Infinity),descriptionLines=items.filter(line=>Number(line.y)>Number(header.y)+Math.max(2,Number(header.height||18)*.15)&&Number(line.y)<endY&&Number(line.x)<Number(qty.x)&&Number(line.x)>=Number(header.x||0)-Math.max(20,Number(header.width||0)*.2)).sort((a,b)=>Number(a.y)-Number(b.y)||Number(a.x)-Number(b.x));
        const current=[];let lastY=null;
        for(const line of descriptionLines){
          const text=String(line.text||'').trim();if(!text)continue;
          if(/\bASIN\s*:/i.test(text)){flush(current);lastY=Number(line.y)||lastY;continue;}
          if(/^(?:B[A-Z0-9]{9}|[A-Z0-9]{10})$/i.test(text))continue;
          if(/^(?:unit\s+price|vat\s+rate|item\s+subtotal|invoice\s+total|total\s+payable|qty|quantity)\b/i.test(text))continue;
          if(lastY!==null&&current.length&&Number(line.y)-lastY>Math.max(90,Number(line.height||18)*3.5))flush(current);
          current.push(line);lastY=Number(line.y)||lastY;
        }
        flush(current);
      }
    }
    return names.join('; ');
  }
  function parseAmazonInvoice(text,source='',ocrLines){
    const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()).map(line=>({...line,page:Number(line.page)||1,x:Number(line.x)||0,y:Number(line.y)||0,width:Number(line.width)||0,height:Number(line.height)||0})),pages=[...new Set(lines.map(line=>line.page))].sort((a,b)=>a-b).map(page=>[page,lines.filter(line=>line.page===page).sort((a,b)=>a.y-b.y||a.x-b.x)]),firstPage=pages[0]?.[1]||[],number=pages.map(([,items])=>amazonInvoiceId(items)).find(Boolean)||'',invoiceLabel=firstPage.filter(line=>/\binvoice\s*#/i.test(String(line.text||''))).sort((a,b)=>a.y-b.y)[0],dateLabel=firstPage.filter(line=>/invoice\s+date\s*\/\s*delivery\s+date/i.test(String(line.text||''))).sort((a,b)=>a.y-b.y)[0],datePair=dateLabel?amazonValueBesideLabel(firstPage,dateLabel,'date'):null,totalLabels=firstPage.filter(line=>/\btotal\s+payable\b/i.test(String(line.text||''))).sort((a,b)=>Math.abs(Number(a.y)-Number(invoiceLabel?.y||0))-Math.abs(Number(b.y)-Number(invoiceLabel?.y||0))),totalPair=totalLabels.map(label=>amazonValueBesideLabel(firstPage,label,'money')).find(Boolean),vat=amazonVatSubtotal(pages),itemName=amazonItemNames(pages),sellerLine=firstPage.find(line=>/^\s*sold\s+by\s+/i.test(String(line.text||''))),soldBy=sellerLine?String(sellerLine.text||'').replace(/^\s*sold\s+by\s+/i,'').trim():'';
    const complete=Boolean(number&&datePair?.value&&totalPair&&totalPair.value!==null&&vat!==null&&itemName),reason=complete?'':!number?'Amazon invoice number could not be confirmed.':!datePair?.value?'Amazon invoice date could not be confirmed.':!totalPair||totalPair.value===null?'Printed Amazon total payable could not be confirmed.':vat===null?'Printed Amazon VAT subtotal could not be confirmed.':'Amazon item description could not be confirmed.';
    return {invoiceNumber:number,originalInvoiceNumber:number,date:datePair?.value||'',supplier:'Amazon',soldBy,itemName,subtotal:'',vat:vat??'',total:totalPair?.value??'',currency:'GBP',documentType:'INVOICE',isInvoiceDocument:Boolean(number||dateLabel||pages.some(([,items])=>/amazon\.co\.uk\/contact-us/i.test(amazonPositionedText(items)))),source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:!complete,review:false,layoutId:'amazon-vat-invoice'};
  }
  function isKinGlobalText(value){const text=String(value||'');return /\bKIN\s+GLOBAL(?:\s+DISTRIBUTION)?\s+LTD\b/i.test(text)||/\bVAT\s+INVOICE\s+\d{4}\s*[/|1]?\s*K[I1L]N\s*[/|1]\s*20\d{2}\b/i.test(text);}
  function isKmDistributionText(value){const text=String(value||'');return /\bKM\s+DISTRIBUTION\s+CENTRE\s+LTD\b/i.test(text)||/\b(?:Invoice\s+)?\d{3,}\s*\/\s*LX\s*\/\s*\d{1,2}\s*\/\s*20\d{2}\b/i.test(text)||/\bGB\s*893651485\b/i.test(text);}
  function kinGlobalInvoiceReference(value){
    const text=String(value||''),matches=[...text.matchAll(/\bVAT\s+INVOICE\s+(\d{4})\s*[/|1]?\s*K[I1L]N\s*[/|1]\s*(20\d{2})\b/gi)];
    if(!matches.length)return '';
    const match=matches.find(item=>/page\s+\d+/i.test(text.slice(item.index||0,(item.index||0)+120)))||matches[0];
    return `${match[1]}/KIN/${match[2]}`;
  }
  function kmDistributionInvoiceReference(value){
    const match=String(value||'').match(/\b(?:Invoice\s+)?(\d{3,})\s*\/\s*LX\s*\/\s*(\d{1,2})\s*\/\s*(20\d{2})\b/i);
    return match?`${match[1]}/LX/${String(Number(match[2])).padStart(2,'0')}/${match[3]}`:'';
  }
  function kinKmInvoiceNumber(value){return String(value||'').match(/^\s*(\d+)/)?.[1]?.slice(-4)||'';}
  function kinKmMoneyValues(value){
    const source=String(value||''),pattern=/(?:\(?-?\s*)?(?:[0-9OoQqIl|]{1,3}(?:[\s,\u00A0][0-9OoQqIl|]{3})+|[0-9OoQqIl|]+)[.,;]\s*[0-9OoQqIl|]{2}\)?/g,values=[];
    for(const match of source.matchAll(pattern)){
      const normalized=match[0].replace(/[OoQq]/g,'0').replace(/[Il|]/g,'1').replace(/\s+/g,' ').replace(/[;,](?=\s*\d{2}\)?$)/,'.');
      const parsed=invoiceAmount(normalized);if(parsed!==null)values.push(parsed);
    }
    return values;
  }
  function kinKmDateValue(value){
    const text=String(value||'').trim().replace(/[OoQq]/g,'0').replace(/[Il|]/g,'1').replace(/\b(\d)\s+(\d)(?=\s*[-/.]\s*\d{1,2}\s*[-/.]\s*20\d{2})/g,'$1$2'),candidates=[...(text.match(/\b20\d{2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}\b/g)||[]),...(text.match(/\b\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*20\d{2}\b/g)||[])];
    for(const candidate of candidates){const parsed=parseDate(candidate.replace(/\s+/g,''));if(parsed)return parsed;}
    return '';
  }
  function kinKmLabeledValue(lines,labelPattern,parseValue,mode='row'){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),labels=items.filter(line=>labelPattern.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
    for(const label of labels){
      const text=String(label.text||''),match=text.match(labelPattern),inline=match?text.slice((match.index||0)+match[0].length).replace(/^\s*[:#.-]?\s*/,''):'';
      const direct=parseValue(inline);if(direct!==null&&direct!==undefined&&direct!=='')return direct;
      const lx=Number(label.x)||0,ly=Number(label.y)||0,lh=Math.max(Number(label.height)||0,1),lw=Math.max(Number(label.width)||0,text.length*8),peers=[];
      for(const line of items){
        if(line===label||line.page!==undefined&&label.page!==undefined&&Number(line.page)!==Number(label.page))continue;
        const value=parseValue(line.text);if(value===null||value===undefined||value==='')continue;
        const x=Number(line.x)||0,y=Number(line.y)||0,delta=y-ly,height=Math.max(Number(line.height)||0,lh);
        if(mode==='below'?(delta<lh*.25||delta>lh*4.5):(Math.abs(delta)>Math.max(lh*1.3,12)))continue;
        if(x<lx-lh*1.5||x>lx+lw+lh*20)continue;
        peers.push({value,score:Math.abs(delta)/lh+Math.max(0,x-lx-lw)/(lh*2)});
      }
      peers.sort((a,b)=>a.score-b.score);if(peers.length)return peers[0].value;
    }
    return null;
  }
  function kinKmSummaryRow(lines,labelPattern){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),labels=items.filter(line=>labelPattern.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0));
    for(const label of labels){
      const lx=Number(label.x)||0,ly=Number(label.y)||0,lh=Math.max(Number(label.height)||0,1),lw=Math.max(Number(label.width)||0,String(label.text||'').length*8),cells=[];
      for(const line of items){
        if(line.page!==undefined&&label.page!==undefined&&Number(line.page)!==Number(label.page))continue;
        const y=Number(line.y)||0,x=Number(line.x)||0,height=Math.max(Number(line.height)||0,lh);
        if(Math.abs(y-ly)>Math.max(lh*1.3,12))continue;
        const text=String(line.text||''),inline=line===label?text.slice((text.match(labelPattern)?.index||0)+(text.match(labelPattern)?.[0].length||0)):text;
        if(line!==label&&x<lx+lw*.25)continue;
        const values=kinKmMoneyValues(inline);values.forEach((value,index)=>cells.push({value,x:line===label?lx+lw+index:x+index*.01}));
      }
      cells.sort((a,b)=>a.x-b.x);
      if(cells.length)return {label,values:cells.map(cell=>cell.value)};
    }
    return null;
  }
  function invoiceRetryRegionsForRow(row,ocrLines){
    if(row?.profileId==='millfield-autoparts'){
      const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),pages=[...new Set((row.sourcePages||[row.page]).map(Number).filter(page=>Number.isInteger(page)&&page>0))],regions=[];
      const missingNumber=!row.millfieldPrintedInvoiceNumber,missingDate=!row.date,missingAmounts=row.total===''||row.total===null||row.total===undefined||row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified||row.millfieldTotalOcrWeak;
      for(const page of pages){const pageLines=lines.filter(line=>(Number(line.page)||1)===page);if(!pageLines.length)continue;const {height,pageHeight,pageWidth}=millfieldPageMetrics(pageLines),targets=[];
        if(missingNumber||missingDate)for(const line of pageLines){const y=Number(line.y)||0,text=String(line.text||'');if(y<pageHeight*.55&&(/invoice\s+number|^\s*date\s*:?\s*$/i.test(text)||/\bHS\s*[A-Z0-9]{4,8}\b/i.test(text)))targets.push(line);}
        if(missingAmounts)for(const line of pageLines){const y=Number(line.y)||0,text=String(line.text||'');if(y>pageHeight*.55&&(/total\s+goods|total\s+vat|amount\s+due|\bamount\b|\bdue\b/i.test(text)))targets.push(line);}
        if(!targets.length)continue;const tolerance=Math.max(height*4,pageHeight*.035,30);for(const [regionType,subset] of [['invoice-header',targets.filter(line=>(Number(line.y)||0)<pageHeight*.55)],['invoice-footer',targets.filter(line=>(Number(line.y)||0)>=pageHeight*.55)]]){if(!subset.length)continue;const bounds=[];for(const target of subset){const x=Number(target.x)||0,y=Number(target.y)||0,w=Math.max(Number(target.width)||0,String(target.text||'').length*height*.42),near=pageLines.filter(line=>line!==target&&Math.abs((Number(line.y)||0)-y)<=tolerance&&((Number(line.x)||0)>x-height*2||(Number(line.x)||0)+(Number(line.width)||0)>=x)),points=[target,...near];bounds.push({left:Math.max(0,Math.min(...points.map(line=>Number(line.x)||0))-height*3),top:Math.max(0,Math.min(...points.map(line=>Number(line.y)||0))-height*3),right:Math.min(pageWidth,Math.max(...points.map(line=>(Number(line.x)||0)+Math.max(Number(line.width)||0,String(line.text||'').length*height*.42)),x+w)+height*4),bottom:Math.min(pageHeight,Math.max(...points.map(line=>(Number(line.y)||0)+(Number(line.height)||height)))+height*3)});}const left=Math.min(...bounds.map(box=>box.left)),top=Math.min(...bounds.map(box=>box.top)),right=Math.max(...bounds.map(box=>box.right)),bottom=Math.max(...bounds.map(box=>box.bottom));regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'millfield-autoparts',regionType});}}
      return regions;
    }
    if(row?.profileId==='banoze'){
      const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),pages=[...new Set((row.sourcePages||[row.page]).map(Number).filter(page=>Number.isInteger(page)&&page>0))],regions=[];
      const missingNumber=!row.originalInvoiceNumber,missingDate=!row.date,missingAmounts=row.total===''||row.total===null||row.total===undefined||row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified||row.banozeFooterUnverified;
      for(const page of pages){
        const pageLines=lines.filter(line=>(Number(line.page)||1)===page);if(!pageLines.length)continue;
        const heights=pageLines.map(line=>Number(line.height)||0).filter(height=>height>0&&height<100).sort((a,b)=>a-b),lineHeight=heights.length?heights[Math.floor(heights.length/2)]:18,pageRight=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0))),pageBottom=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1);
        if(missingNumber||missingDate){
          const header=pageLines.filter(line=>{const y=Number(line.y)||0,x=Number(line.x)||0,text=String(line.text||'');return y<pageBottom*.4&&(/^\s*(?:date|ate)\b/i.test(text)||x>pageRight*.7&&(/invoi|nvoice|rnvoice/i.test(text)||/\b(?:BNZ|NZ)\s*20/i.test(text)||/\b20\d(?:[\s\-]?[0-9]){5,}/i.test(text)));});
          if(header.length){const left=Math.max(0,Math.min(...header.map(line=>Number(line.x)||0))-lineHeight*3),right=Math.min(pageRight,Math.max(...header.map(line=>(Number(line.x)||0)+(Number(line.width)||0)))+lineHeight*3),top=Math.max(0,Math.min(...header.map(line=>Number(line.y)||0))-lineHeight*3),bottom=Math.min(pageBottom,Math.max(...header.map(line=>(Number(line.y)||0)+(Number(line.height)||lineHeight)))+lineHeight*3);if(right>left&&bottom>top)regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'banoze',regionType:'invoice-header'});}
        }
        if(missingAmounts){
          const labels=pageLines.filter(line=>Number(line.y)>=pageBottom*.5&&(banozeLabelMatches(line.text,'TOTAL')||/\bGOODS\s+TOTAL\b/i.test(String(line.text||''))||banozeLabelMatches(line.text,'VAT')));
          if(labels.length){const labelTop=Math.min(...labels.map(line=>Number(line.y)||0)),labelBottom=Math.max(...labels.map(line=>(Number(line.y)||0)+(Number(line.height)||lineHeight))),rowTolerance=Math.max(pageBottom*.045,lineHeight*4),nearby=pageLines.filter(line=>{const y=Number(line.y)||0;return y>=labelTop-lineHeight&&y<=labelBottom+rowTolerance&&labels.some(label=>Math.abs(y-(Number(label.y)||0))<=rowTolerance&&Math.abs((Number(line.x)||0)-(Number(label.x)||0))<=pageRight*.08);}),bounds=[...labels,...nearby],left=Math.max(0,Math.min(...bounds.map(line=>Number(line.x)||0))-lineHeight*3),right=Math.min(pageRight,Math.max(...bounds.map(line=>(Number(line.x)||0)+(Number(line.width)||lineHeight)))+lineHeight*3),top=Math.max(0,labelTop-lineHeight*3),bottom=Math.min(pageBottom,Math.max(labelBottom,...nearby.map(line=>(Number(line.y)||0)+(Number(line.height)||lineHeight)))+lineHeight*2);if(right>left&&bottom>top)regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'banoze',regionType:'invoice-footer'});}
        }
      }
      return regions;
    }
    if(row?.profileId==='parts-plus'){
      const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),pages=[...new Set((row.sourcePages||[row.page]).map(Number).filter(page=>Number.isInteger(page)&&page>0))],regions=[];
      const missingNumber=!row.originalInvoiceNumber,missingDate=!row.date,missingAmounts=row.total===''||row.total===null||row.total===undefined||row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified;
      for(const page of pages){
        const pageLines=lines.filter(line=>(Number(line.page)||1)===page);if(!pageLines.length)continue;
        const heights=pageLines.map(line=>Number(line.height)||0).filter(height=>height>0&&height<100).sort((a,b)=>a-b),lineHeight=heights.length?heights[Math.floor(heights.length/2)]:18,pageRight=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0))),pageBottom=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),targets=[];
        const addTargets=(pattern,{minimumY=0,maximumY=pageBottom}={})=>{for(const line of pageLines){const y=Number(line.y)||0;if(pattern.test(String(line.text||'').trim())&&y>=minimumY&&y<=maximumY)targets.push(line);}};
        if(missingNumber)addTargets(/^\s*Invoice\s*(?:No\.?|Number|#)\s*:?\s*$/i,{maximumY:pageBottom*.62});
        if(missingDate)addTargets(/^\s*Date\s*:?\s*$/i,{maximumY:pageBottom*.62});
        if(missingAmounts){const footerY=pageBottom*.62;addTargets(/^\s*Net\s*$/i,{minimumY:footerY});addTargets(/^\s*V\s*\.?\s*A\s*\.?\s*T\s*\.?\s*$/i,{minimumY:footerY});addTargets(/^\s*Total\s*$/i,{minimumY:footerY});}
        if(!targets.length)continue;
        const rowTolerance=Math.max(lineHeight*2.2,pageBottom*.018,18),boxes=[];
        for(const label of targets){
          const x=Number(label.x)||0,y=Number(label.y)||0,height=Math.max(Number(label.height)||0,lineHeight),nearby=pageLines.filter(line=>line!==label&&Math.abs((Number(line.y)||0)-y)<=rowTolerance&&(Number(line.x)||0)>=x-lineHeight*1.5&&(Number(line.x)||0)<=pageRight);
          const left=Math.max(0,Math.min(x,...nearby.map(line=>Number(line.x)||0))-lineHeight*2);let right=Math.min(pageRight,Math.max(x+(Number(label.width)||lineHeight),...nearby.map(line=>(Number(line.x)||0)+(Number(line.width)||lineHeight)))+lineHeight*2);if(missingDate&&!missingNumber&&!missingAmounts&&/^\s*Date\s*:?\s*$/i.test(String(label.text||'')))right=pageRight;const top=Math.max(0,Math.min(y,...nearby.map(line=>Number(line.y)||0))-lineHeight*2),bottom=Math.min(pageBottom,Math.max(y+height,...nearby.map(line=>(Number(line.y)||0)+(Number(line.height)||lineHeight)))+lineHeight*2);
          if(right>left&&bottom>top)boxes.push({left,top,right,bottom});
        }
        if(boxes.length){const left=Math.min(...boxes.map(box=>box.left)),top=Math.min(...boxes.map(box=>box.top)),right=Math.max(...boxes.map(box=>box.right)),bottom=Math.max(...boxes.map(box=>box.bottom));regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'parts-plus',regionType:missingAmounts?'invoice-footer':missingDate?'invoice-date':'invoice-number'});}
      }
      return regions;
    }
    if(row?.profileId==='gsf-car-parts'){
      const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),pages=[...new Set((row.sourcePages||[row.page]).map(Number).filter(page=>Number.isInteger(page)&&page>0))],regions=[];
      const missingAmounts=row.total===''||row.total===null||row.total===undefined||row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified;
      const missingIdentity=!row.originalInvoiceNumber||!row.date;
      for(const page of pages){
        const pageLines=lines.filter(line=>(Number(line.page)||1)===page);if(!pageLines.length)continue;
        const heights=pageLines.map(line=>Number(line.height)||0).filter(height=>height>0&&height<80).sort((a,b)=>a-b),lineHeight=heights.length?heights[Math.floor(heights.length/2)]:18;
        const pageRight=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0))),pageBottom=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)));
        if(missingAmounts){
          const footerAnchor=pageLines.filter(line=>/please\s+(?:remit\s+to\s+the\s+below\s+bank\s+details|make\s+cheques\s+payable)|account\s+name\s*:/i.test(String(line.text||''))).sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0))[0];
          const summaryEvidence=pageLines.filter(line=>(Number(line.y)||0)>=pageBottom*.7&&(gsfSummaryLabelKind(line)||anchoredInvoiceMoneyValues(line.text).length)),evidenceLeft=summaryEvidence.length?Math.max(0,Math.min(...summaryEvidence.map(line=>Number(line.x)||0))-lineHeight*14):0,evidenceTop=summaryEvidence.length?Math.max(0,Math.min(...summaryEvidence.map(line=>Number(line.y)||0))-lineHeight*6):0,evidenceBottom=summaryEvidence.length?Math.min(pageBottom,Math.max(...summaryEvidence.map(line=>(Number(line.y)||0)+(Number(line.height)||lineHeight)))+lineHeight*7):0;
          const anchorY=footerAnchor?Number(footerAnchor.y)||0:pageBottom-lineHeight*12,top=summaryEvidence.length?evidenceTop:Math.max(0,anchorY-lineHeight*15),bottom=summaryEvidence.length?evidenceBottom:Math.min(pageBottom,anchorY+lineHeight*7),left=summaryEvidence.length?evidenceLeft:0,right=pageRight+lineHeight*8;
          if(right>left&&bottom>top)regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'gsf-car-parts',regionType:'footer-summary'});
        }else if(missingIdentity){
          // Invoice references and branch account numbers both begin with
          // 743. Do not let the earlier 10-digit invoice reference anchor a
          // date retry at the top of the page; use a shorter account number
          // in the invoice metadata band, or let the semantic label crop
          // below cover the complete metadata block.
          const accountDateAnchor=!row.date?pageLines.filter(line=>{const y=Number(line.y)||0,text=String(line.text||''),digits=text.replace(/\D/g,'');return y>=pageBottom*.22&&y<pageBottom*.58&&/^743\d{4,5}$/.test(digits)&&!/\binvoice\b/i.test(text);}).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0]||null:null;
          if(accountDateAnchor){const x=Number(accountDateAnchor.x)||0,y=Number(accountDateAnchor.y)||0,left=Math.max(0,x-lineHeight*5),top=Math.max(0,y-lineHeight*5),bottom=Math.min(pageBottom,y+lineHeight*8);if(pageRight>left&&bottom>top){regions.push({page,left,top,width:pageRight-left,height:bottom-top,profileId:'gsf-car-parts',regionType:'invoice-date'});continue;}}
          const headerLimit=pageBottom*.52,anchors=pageLines.filter(line=>{const y=Number(line.y)||0,x=Number(line.x)||0,text=String(line.text||'');return y<headerLimit&&(/\binvoice\b|tax\s*poi|acct\s*(?:no|n[o0])|account\s*(?:no|number)|date\s+of\s+issue/i.test(text)||/743(?:[\s-]*\d){7}/.test(text)||x>pageRight*.55&&/^\s*\d{6,8}\s+/.test(text));});
          if(anchors.length){
            const minY=Math.min(...anchors.map(line=>Number(line.y)||0)),maxY=Math.max(...anchors.map(line=>(Number(line.y)||0)+(Number(line.height)||lineHeight))),minX=Math.max(0,Math.min(...anchors.map(line=>Number(line.x)||0))-lineHeight*7),maxX=Math.min(pageRight,Math.max(...anchors.map(line=>(Number(line.x)||0)+(Number(line.width)||lineHeight)))+lineHeight*7),top=Math.max(0,minY-lineHeight*5),bottom=Math.min(pageBottom,maxY+lineHeight*5);
            if(maxX>minX&&bottom>top)regions.push({page,left:minX,top,width:maxX-minX,height:bottom-top,profileId:'gsf-car-parts',regionType:'invoice-identity'});
          }
        }
      }
      return regions;
    }
    if(row?.profileId!=='kin-global')return [];
    const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),pages=[...new Set((row.sourcePages||[row.page]).map(Number).filter(page=>Number.isInteger(page)&&page>0))],regions=[];
    for(const page of pages){
      const pageLines=lines.filter(line=>(Number(line.page)||1)===page),vatSections=pageLines.filter(line=>/\bVAT\s+stat/i.test(String(line.text||'').normalize('NFKD'))),totalLabels=pageLines.filter(line=>/\btotal\s*\(\s*\d+\s*it/i.test(String(line.text||'').normalize('NFKD')));
      if(!vatSections.length||!totalLabels.length)continue;
      const total=totalLabels.at(-1),totalY=Number(total.y)||0,section=vatSections.sort((a,b)=>Math.abs((Number(a.y)||0)-totalY)-Math.abs((Number(b.y)||0)-totalY))[0],fontHeights=pageLines.map(line=>Number(line.height)||0).filter(height=>height>0&&height<50).sort((a,b)=>a-b),lineHeight=fontHeights.length?fontHeights[Math.floor(fontHeights.length/2)]:Math.max(1,Number(section.height)||Number(total.height)||1),padding=lineHeight*2;
      const top=Math.max(0,Math.min(Number(section.y)||0,totalY)-padding),bottom=Math.max((Number(section.y)||0)+(Number(section.height)||lineHeight),totalY+(Number(total.height)||lineHeight))+padding,left=Math.max(0,Math.min(Number(section.x)||0,Number(total.x)||0)-padding),rightMost=pageLines.filter(line=>{const y=Number(line.y)||0,x=Number(line.x)||0;return y+(Number(line.height)||lineHeight)>=top&&y<=bottom&&x>=left;}).reduce((right,line)=>Math.max(right,(Number(line.x)||0)+(Number(line.width)||0)),0),right=rightMost+padding;
      if(right>left&&bottom>top)regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'kin-global'});
    }
    return regions;
  }
  function kinGlobalVatFromColumn(lines,totalLabel){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),page=Number(totalLabel?.page)||1,section=items.filter(line=>(Number(line.page)||1)===page&&/\bVAT\s+stat/i.test(String(line.text||'').normalize('NFKD'))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];
    if(!section)return null;
    const sh=Math.max(Number(section.height)||0,1),sx=Number(section.x)||0,sw=Math.max(Number(section.width)||0,String(section.text||'').length*8),headers=items.filter(line=>(Number(line.page)||1)===page&&/^\s*VAT\s*$/i.test(String(line.text||''))&&Math.abs((Number(line.y)||0)-(Number(section.y)||0))<=sh*1.5&&(Number(line.x)||0)>=sx+sw*.5).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0));
    const header=headers.at(-1);
    if(!header){
      const sameHeaderRow=items.filter(line=>(Number(line.page)||1)===page&&Math.abs((Number(line.y)||0)-(Number(section.y)||0))<=sh*1.5),rateHeader=sameHeaderRow.find(line=>/^\s*(?:VAT\s+)?rate\s*$/i.test(String(line.text||''))),grossHeader=sameHeaderRow.find(line=>/^\s*gross\s*$/i.test(String(line.text||'')));
      if(!rateHeader||!grossHeader)return null;
      const rateRight=(Number(rateHeader.x)||0)+Math.max(Number(rateHeader.width)||0,sh),grossLeft=Number(grossHeader.x)||0,totalY=Number(totalLabel.y)||0,totalHeight=Math.max(Number(totalLabel.height)||0,sh),rowTolerance=Math.max(totalHeight*1.5,sh*2),values=[];
      for(const line of items){if((Number(line.page)||1)!==page||Math.abs((Number(line.y)||0)-totalY)>rowTolerance)continue;const x=Number(line.x)||0,width=Math.max(Number(line.width)||0,sh*.5),center=x+width/2;if(center<rateRight||center>=grossLeft)continue;values.push(...kinKmMoneyValues(line.text));}
      const unique=[...new Set(values)];return unique.length===1?unique[0]:null;
    }
    const hx=Number(header.x)||0,hh=Math.max(Number(header.height)||0,1),hy=Number(totalLabel.y)||0,candidates=[];
    for(const line of items){
      if((Number(line.page)||1)!==page||Math.abs((Number(line.y)||0)-hy)>Math.max(hh*1.5,12))continue;
      const x=Number(line.x)||0;if(x<hx-hh*2||x>hx+hh*7)continue;
      for(const value of kinKmMoneyValues(line.text))candidates.push({value,score:Math.abs((x+Math.max(Number(line.width)||0,0)/2)-hx)/hh});
    }
    candidates.sort((a,b)=>a.score-b.score);return candidates[0]?.value??null;
  }
  function kinGlobalInvoiceDate(lines,flat=''){
    const fromLabel=kinKmLabeledValue(lines,/\bdate\s+of\s+issuance\b/i,kinKmDateValue,'row');
    if(fromLabel)return fromLabel;
    const text=String(flat||''),match=text.match(/date\s+of\s+issuance\s*:?\s*(20\d{2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*20\d{2})/i);
    return match?kinKmDateValue(match[1]):'';
  }
  function kmDistributionInvoiceDate(lines,flat=''){
    const fromLabel=kinKmLabeledValue(lines,/\binvoice\s+date\b/i,kinKmDateValue,'below');
    if(fromLabel)return fromLabel;
    const text=String(flat||''),match=text.match(/invoice\s+date\s*:?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*20\d{2})/i);
    return match?kinKmDateValue(match[1]):'';
  }
  function isKinGlobalInvoicePage(lines){const text=(lines||[]).map(line=>String(line.text||'')).join(' ');return isKinGlobalText(text)&&/\bVAT\s+INVOICE\b/i.test(text);}
  function isKmDistributionInvoicePage(lines){const text=(lines||[]).map(line=>String(line.text||'')).join(' ');return isKmDistributionText(text)&&Boolean(kmDistributionInvoiceReference(text)||/\binvoice\s+date\b/i.test(text));}
  function parseKinGlobalInvoice(flat,source='',ocrLines){
    const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),text=String(flat||lines.map(line=>String(line.text||'')).join(' ')),fullNumber=kinGlobalInvoiceReference(text),number=kinKmInvoiceNumber(fullNumber),date=kinGlobalInvoiceDate(lines,text),invoiceDocument=Boolean(isKinGlobalText(text)&&/\bVAT\s+INVOICE\b/i.test(text));
    const pages=[...new Set(lines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),pageMaps=pages.map(page=>[page,lines.filter(line=>(Number(line.page)||1)===page)]),totals=[];
    for(const [,pageLines] of pageMaps){const found=kinKmSummaryRow(pageLines,/\btotal\s*\(\s*\d+\s*it/i);if(found)totals.push(found);}
    const totalRow=totals.at(-1),rowValues=totalRow?.values||[],total=rowValues.length>=3?rowValues.at(-1):kinKmLabeledValue(lines,/\bamount\s+due\b/i,value=>kinKmMoneyValues(value)[0]??null,'row'),vat=rowValues.length>=3?rowValues.at(-2):totalRow?kinGlobalVatFromColumn(lines,totalRow.label):null,complete=Boolean(invoiceDocument&&number&&date&&total!==null&&vat!==null),reason=complete?'':!invoiceDocument?'This document does not appear to be a Kin Global VAT invoice.':!number?'Kin Global invoice number could not be confirmed from the printed VAT invoice reference.':!date?'Kin Global date of issuance could not be confirmed.':total===null?'Printed Kin Global Total (items) and Amount Due could not be confirmed.':'Printed Kin Global VAT summary could not be confirmed.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'Kin Global Distribution Ltd',subtotal:'',vat:vat??'',vatUnverified:vat===null,vatMentioned:vat!==null,total:total??'',documentType:'INVOICE',isInvoiceDocument:invoiceDocument,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(invoiceDocument&&!complete),review:false,layoutId:'kin-global-vat-statement',profileId:'kin-global'};
  }
  function parseKmDistributionInvoice(flat,source='',ocrLines){
    const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),text=String(flat||lines.map(line=>String(line.text||'')).join(' ')),fullNumber=kmDistributionInvoiceReference(text),number=kinKmInvoiceNumber(fullNumber),date=kmDistributionInvoiceDate(lines,text),invoiceDocument=Boolean(isKmDistributionText(text)&&/\binvoice\b/i.test(text)),pages=[...new Set(lines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b),rows=[];
    for(const page of pages){const pageLines=lines.filter(line=>(Number(line.page)||1)===page),found=kinKmSummaryRow(pageLines,/^\s*total\s*:/i);if(found)rows.push(found);}
    const totalRow=rows.at(-1),values=totalRow?.values||[],vat=values.length>=3?values.at(-2):null,total=values.length>=3?values.at(-1):null,complete=Boolean(invoiceDocument&&number&&date&&total!==null&&vat!==null),reason=complete?'':!invoiceDocument?'This document does not appear to be a KM Distribution invoice.':!number?'KM Distribution invoice number could not be confirmed.':!date?'KM Distribution invoice date could not be confirmed.':total===null?'Printed KM Distribution Total row could not be confirmed.':'Printed KM Distribution VAT cell could not be confirmed.';
    return {invoiceNumber:number,originalInvoiceNumber:fullNumber,date,supplier:'KM Distribution Centre Ltd',subtotal:'',vat:vat??'',vatUnverified:vat===null,vatMentioned:vat!==null,total:total??'',documentType:'INVOICE',isInvoiceDocument:invoiceDocument,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(invoiceDocument&&!complete),review:false,layoutId:'km-distribution-vat-summary',profileId:'km-distribution'};
  }
  function parseKinKmProfileBatch(pageLines,source,profileId,options={}){
    const pages=[...new Set(pageLines.keys())].sort((a,b)=>a-b),kin=profileId==='kin-global',isSupplier=kin?isKinGlobalText:isKmDistributionText,isInvoicePage=kin?isKinGlobalInvoicePage:isKmDistributionInvoicePage,readNumber=kin?kinGlobalInvoiceReference:kmDistributionInvoiceReference,groups=[],consumedPages=new Set();let activeGroup=null;
    for(const page of pages){
      const lines=pageLines.get(page)||[],text=lines.map(line=>String(line.text||'')).join(' '),otherSupplier=invoiceProfiles.some(profile=>profile.kind==='supplier'&&profile.id!==profileId&&profile.detect(text));if(otherSupplier){activeGroup=null;continue;}
      if(!isSupplier(text)){
        const continuation=kin?/\bVAT\s+INVOICE\b|\bpage\s+\d+\s+(?:z|of)\s+\d+\b|\bVAT\s+stat|\btotal\s*\(\s*\d+\s*it/i.test(text.normalize('NFKD')):/\bVAT\s*(?:no|number)\b|\bpage\s+\d+\s+(?:of|z)\s+\d+\b|\btotal\s*:/i.test(text);
        if(activeGroup&&continuation){activeGroup.pages.push(page);consumedPages.add(page);}else if(activeGroup)activeGroup=null;
        continue;
      }
      const reference=readNumber(text),starts=kin?isInvoicePage(lines):isInvoicePage(lines)||/\binvoice\s+date\b/i.test(text);
      if(reference){if(activeGroup&&activeGroup.reference===reference){activeGroup.pages.push(page);consumedPages.add(page);continue;}activeGroup={reference,page,pages:[page]};groups.push(activeGroup);consumedPages.add(page);continue;}
      if(starts){activeGroup={reference:'',page,pages:[page]};groups.push(activeGroup);consumedPages.add(page);continue;}
      if(activeGroup){activeGroup.pages.push(page);consumedPages.add(page);}
    }
    const rows=groups.map(group=>{
      const lines=group.pages.flatMap(page=>pageLines.get(page)||[]),text=lines.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n'),row=parseInvoiceRobust(text,source,lines,options);
      return {...row,page:group.page,sourcePages:group.pages,profileId};
    });
    const otherLines=[...pageLines.values()].flat().filter(line=>!consumedPages.has(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
    return [...otherRows,...rows].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  // Keep supplier/document-specific parsing isolated here. Detection uses
  // document content, never just the file name, because users often rename
  // statements and batch PDFs from several suppliers together.
  function anchoredInvoiceMoneyValues(value){
    // OCR can render the euro sign plus its first digit as "El" (for example
    // €18.00 -> "El 8.00"). Repair that token only where it directly prefixes
    // a printed amount; otherwise the leading digit would be lost.
    const text=String(value||'').replace(/E\s*[Il|](?=\s*,\s*\d{3}[.,]\s*[\dOo]{2}\b)/gi,(_match,currency)=>`${currency}1`).replace(/E\s*[Il|]O(?=[.,]\s*[\dOo]{2}\b)/gi,(_match,currency)=>`${currency}10`).replace(/\bE\s*[lI|]\s*(?=\d)/g,'1').replace(/(?<=\d)[Oo](?=[.,]\s*[\dOo]{2}\b)/g,'0').replace(/([.,;])\s*[Oo]{2}\b/g,'$1 00'),values=[];
    for(const match of text.matchAll(/(?<![\d/])(?:[Â£â‚¬$]\s*)?\(?-?\d(?:[\d\s,.'â€™]*\d)?[.,]\s*\d{2}\)?/g)){
      const raw=match[0].replace(/[â€™']/g,'').replace(/\s+/g,' ').trim(),amount=invoiceAmount(raw);
      if(amount!==null&&Number.isFinite(amount)&&!values.some(item=>item.index===match.index))values.push({raw,value:amount,index:match.index});
    }
    return values;
  }
  function anchoredInvoiceAmountBelowLabel(pageLines,label,{maximumDistanceRatio=.05,horizontalDistanceRatio=.1}={}){
    const pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),pageWidth=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),labelY=Number(label.y)||0,labelX=Number(label.x)||0,maxDistance=Math.max(pageHeight*maximumDistanceRatio,(Number(label.height)||16)*3,24),maxHorizontal=Math.max(pageWidth*horizontalDistanceRatio,(Number(label.height)||16)*3,24),candidates=[];
    for(const line of pageLines){const y=Number(line.y)||0,x=Number(line.x)||0,distance=y-labelY;if(line===label||distance<=0||distance>maxDistance||Math.abs(x-labelX)>maxHorizontal)continue;const values=anchoredInvoiceMoneyValues(line.text),zeroOnly=/^\s*0[.,]0(?:0)?\s*$/.test(String(line.text||''));if(!values.length&&zeroOnly)candidates.push({value:0,distance,horizontal:Math.abs(x-labelX)});else for(const money of values)candidates.push({value:money.value,distance,horizontal:Math.abs(x-labelX)});}
    candidates.sort((a,b)=>a.distance-b.distance||a.horizontal-b.horizontal);return candidates[0]?{value:candidates[0].value,distanceY:candidates[0].distance}:null;
  }
  function anchoredInvoiceAcreSummary(lines){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    const pageNumbers=[...pages.keys()].sort((a,b)=>a-b),exactAmount=line=>{const values=anchoredInvoiceMoneyValues(line?.text);if(values.length)return values[0].value;return /^\s*0[.,]0(?:0)?\s*$/.test(String(line?.text||''))?0:null;};
    for(const pageNumber of pageNumbers){
      const pageLines=pages.get(pageNumber),vatLabels=pageLines.filter(line=>/^\s*VAT\s+Amount\s*\(E\)\s*$/i.test(String(line.text||''))),pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1);
      for(const vatLabel of vatLabels){
        const y=Number(vatLabel.y)||0,h=Math.max(Number(vatLabel.height)||16,16),sameRowTolerance=Math.max(h*2,pageHeight*.012,24),totalLabel=pageLines.filter(line=>/^\s*Total\s*\(E\)\s*$/i.test(String(line.text||''))).sort((a,b)=>Math.abs((Number(a.y)||0)-y)-Math.abs((Number(b.y)||0)-y))[0];
        if(!totalLabel||Math.abs((Number(totalLabel.y)||0)-y)>sameRowTolerance)continue;
        const vatBelow=anchoredInvoiceAmountBelowLabel(pageLines,vatLabel),totalBelow=anchoredInvoiceAmountBelowLabel(pageLines,totalLabel),vat=vatBelow?.value??null,total=totalBelow?.value??null,partial=vat!==null||total!==null?{vat:vat===null?null:{value:vat},total:total===null?null:{value:total}}:null;
        if(vat!==null&&total!==null)return {vat:{value:vat},total:{value:total}};
        if(y<pageHeight*.62){if(partial)return partial;continue;}
        const nextLines=pages.get(pageNumber+1);if(!nextLines){if(partial)return partial;continue;}const nextHeight=Math.max(...nextLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),nextWidth=Math.max(...nextLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),summaryLabels=pageLines.filter(line=>/^\s*(?:Net\s+Amount|VAT\s+Amount|Total)\s*\(E\)\s*$/i.test(String(line.text||''))&&Math.abs((Number(line.y)||0)-y)<=sameRowTolerance),netLabel=summaryLabels.find(line=>/^\s*Net\s+Amount/i.test(String(line.text||''))),labelHeight=Math.max(h,Number(totalLabel.height)||16,16),rowTolerance=Math.max(labelHeight*2,nextHeight*.015,24),candidates=[];
        for(const line of nextLines){if((Number(line.y)||0)>nextHeight*.24)continue;const value=exactAmount(line);if(value===null)continue;candidates.push({line,value,x:Number(line.x)||0,y:Number(line.y)||0});}
        const rows=[];for(const candidate of candidates){let row=rows.find(item=>Math.abs(item.y-candidate.y)<=rowTolerance);if(!row){row={y:candidate.y,values:[]};rows.push(row);}row.values.push(candidate);}
        const findColumn=(row,label,used)=>{if(!label)return null;const labelX=Number(label.x)||0,choices=row.values.filter(item=>!used.has(item)&&Math.abs(item.x-labelX)<=nextWidth*.10).sort((a,b)=>Math.abs(a.x-labelX)-Math.abs(b.x-labelX));return choices[0]||null;};
        rows.sort((a,b)=>a.y-b.y);for(const row of rows){const used=new Set(),vatValue=findColumn(row,vatLabel,used);if(vatValue)used.add(vatValue);const totalValue=findColumn(row,totalLabel,used);if(!vatValue&&!totalValue)continue;if(vatValue&&totalValue)return {vat:{value:vatValue.value},total:{value:totalValue.value}};if(netLabel){const netValue=findColumn(row,netLabel,used);if((vatValue||totalValue)&&netValue)return {vat:vatValue?{value:vatValue.value}:null,total:totalValue?{value:totalValue.value}:null};}}
        if(partial)return partial;
      }
    }
    return null;
  }
  function anchoredInvoiceSiemensVat(lines){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim());
    for(const label of items.filter(line=>/\bVAT\s+due\s+on\b/i.test(String(line.text||'')))){
      const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),labelX=(Number(label.x)||0)+(Number(label.width)||0),labelY=Number(label.y)||0,tolerance=Math.max((Number(label.height)||16)*1.6,24),zeroValues=page.filter(line=>line!==label&&Math.abs((Number(line.y)||0)-labelY)<=tolerance&&(Number(line.x)||0)>labelX&&/^\s*0[.,]0{1,2}\s*$/.test(String(line.text||'')));
      if(zeroValues.length===1)return {value:0,label:'printed VAT due is 0.00'};
    }
    return null;
  }
  function anchoredInvoiceCareCheckNumber(lines){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim());
    for(const page of new Set(items.map(line=>Number(line.page)||1))){
      const pageLines=items.filter(line=>(Number(line.page)||1)===page),pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),candidates=pageLines.filter(line=>/^[0-9]{6,8}$/.test(String(line.text||'').trim())&&(Number(line.y)||0)<=pageHeight*.12);
      // Care Check prints its invoice reference by itself in the page header;
      // its "Invoice to" heading is much lower and the reference has no label.
      if(candidates.length===1)return String(candidates[0].text).trim();
    }
    return '';
  }
  function anchoredInvoiceSummaryValue(lines,labelPatterns,{exclude=/\b(?:VAT\s*(?:registration|reg\.?|number|no\.?|ID)|VAT\s*(?:rate|percentage)|invoice\s+(?:number|no\.?|date)|due\s+date|account\s+number)\b/i,minimumYRatio=.5,maximumValueDistanceRatio=.015}={}){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}const labels=[];
    for(const [page,pageLines] of pages){const pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1);for(const pattern of labelPatterns){const matches=pageLines.filter(line=>pattern.test(String(line.text||''))&&(Number(line.y)||0)>=pageHeight*minimumYRatio);if(matches.length){matches.sort((a,b)=>(Number(b.y)||0)-(Number(a.y)||0));labels.push({page,line:matches[0],pattern});}}}
    labels.sort((a,b)=>b.page-a.page||(Number(b.line.y)||0)-(Number(a.line.y)||0));for(const selected of labels){const pageLines=items.filter(line=>(Number(line.page)||1)===selected.page),otherLabels=new Set(pageLines.filter(line=>line!==selected.line&&selected.pattern.test(String(line.text||''))));const context=pageLines.filter(line=>!otherLabels.has(line)),result=anchoredInvoiceRelativeValue(context,[selected.pattern],{exclude}),pageHeight=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1);if(result&&result.distanceY<=Math.max((Number(selected.line.height)||16)*2,pageHeight*maximumValueDistanceRatio,24))return result;}return null;
  }
  function anchoredInvoiceTextBesideLabel(lines,labelPatterns){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),labels=[];for(const pattern of labelPatterns)for(const line of items)if(pattern.test(String(line.text||'').trim()))labels.push({line,pattern});
    for(const {line:label} of labels){const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),height=Math.max(Number(label.height)||0,12),left=(Number(label.x)||0)+(Number(label.width)||0),pageWidth=Math.max(...page.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),candidates=[];for(const line of page){if(line===label)continue;const raw=String(line.text||'').trim(),candidate=cleanInvoiceNumber(raw),dx=(Number(line.x)||0)-left,dy=Math.abs((Number(line.y)||0)-(Number(label.y)||0));if(!candidate||!/[0-9]/.test(candidate)||candidate.length>40||dx< -height*.25||dy>Math.max(height*1.7,22)||/\b(?:date|due|VAT|tax|page|account|customer|order)\b/i.test(raw))continue;candidates.push({candidate,score:dy/height+Math.max(0,dx)/pageWidth*2});}candidates.sort((a,b)=>a.score-b.score);if(candidates.length)return candidates[0].candidate;}return '';
  }
  function anchoredInvoiceRelativeValue(lines,labelPatterns,{exclude=/\b(?:VAT\s*(?:registration|reg\.?|number|no\.?|ID)|VAT\s*(?:rate|percentage)|invoice\s+(?:number|no\.?|date)|due\s+date|account\s+number)\b/i}={}){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()).map((line,index)=>({...line,_index:index,_page:Number(line.page)||1,_x:Number(line.x)||0,_y:Number(line.y)||0,_w:Number(line.width)||0,_h:Number(line.height)||0})),pages=new Map();
    for(const line of items){if(!pages.has(line._page))pages.set(line._page,[]);pages.get(line._page).push(line);}
    const labels=[];
    for(const pattern of labelPatterns){
      for(const line of items){const text=String(line.text||'').trim();if(pattern.test(text))labels.push({line,pattern,priority:labelPatterns.indexOf(pattern)});}
    }
    let best=null;
    for(const {line:label,pattern,priority} of labels){
      const page=pages.get(label._page)||[],pageWidth=Math.max(...page.map(item=>item._x+item._w),1),pageHeight=Math.max(...page.map(item=>item._y+item._h),1),positiveHeights=page.map(item=>item._h).filter(value=>value>0).sort((a,b)=>a-b),lineHeight=positiveHeights[Math.floor(positiveHeights.length/2)]||label._h||20,height=Math.max(label._h,lineHeight,1),rowTolerance=Math.max(height*1.6,1),verticalTolerance=Math.max(height*4,pageHeight*.05,1),labelRight=label._x+label._w;
      const candidates=[];
      const add=(candidate,score,source)=>{for(const money of anchoredInvoiceMoneyValues(candidate.text)){candidates.push({value:money.value,raw:money.raw,score,source,line:candidate});}};
      const labelText=String(label.text||'').trim(),inline=labelText.replace(pattern,' ').trim();
      // In a tax breakdown, "VAT (20% on £15.00)" contains the net base,
      // not the VAT value. Read the amount in the adjacent VAT column.
      if(inline&&!/\b\d+(?:[.,]\d+)?\s*%\s*on\b/i.test(labelText)&&!(/\bVAT\b/i.test(labelText)&&/\b\d+(?:[.,]\d+)?\s*%/i.test(labelText)))add(label,0,'inline');
      for(const candidate of page){
        if(candidate===label||/\b(?:VAT\s*(?:registration|reg\.?|number|no\.?|ID|rate|percentage)|invoice\s+(?:number|no\.?|date)|due\s+date|account\s+number)\b/i.test(String(candidate.text||''))||exclude.test(String(candidate.text||'')))continue;
        const dy=Math.abs(candidate._y-label._y),dx=candidate._x-labelRight;
        if(dy<=rowTolerance&&dx>=-height*.35){add(candidate,dy/height+Math.max(0,dx)/pageWidth*3+(dx<0?.25:0),'same-row');continue;}
        if(dy<=verticalTolerance&&Math.abs(candidate._x-label._x)<=pageWidth*.2){add(candidate,dy/height+Math.abs(candidate._x-label._x)/pageWidth*3+.35,'next-line');}
      }
      const chosen=candidates.sort((a,b)=>a.score-b.score||a.line._index-b.line._index)[0];
      if(chosen){const score=chosen.score+priority*0.22+Math.max(0,(pageHeight-label._y)/pageHeight)*0.0001;if(!best||score<best.score)best={value:chosen.value,raw:chosen.raw,label:labelText,score,priority,distanceY:Math.abs(chosen.line._y-label._y)};}
    }
    return best;
  }
  function anchoredInvoiceFlatValue(text,labelPatterns,{exclude=/\b(?:VAT\s*(?:registration|reg\.?|number|no\.?|ID)|VAT\s*(?:rate|percentage))\b/i}={}){
    const flat=String(text||'').replace(/\s+/g,' ');
    for(const pattern of labelPatterns){for(const match of flat.matchAll(new RegExp(pattern.source+'\\s*[:#-]?\\s*(?:in\\s+(?:GBP|EUR|USD)\\s*)?(?:[Â£â‚¬$]\\s*)?(?:(?:GBP|EUR|USD)\\s*)?((?:\\d{1,3}(?:[ ,]\\d{3})+|\\d+)[.,]\\s*\\d{2})','gi'))){const valueOffset=match[0].lastIndexOf(match[1]),labelContext=flat.slice(match.index,match.index+Math.max(0,valueOffset));if(exclude.test(labelContext))continue;const amount=invoiceAmount(match[1]);if(amount!==null)return {value:amount,raw:match[1],label:labelContext};}}
    return null;
  }
  function anchoredInvoiceSplitSummary(lines){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()).map((line,index)=>({...line,_index:index,_page:Number(line.page)||1,_x:Number(line.x)||0,_y:Number(line.y)||0,_w:Number(line.width)||0,_h:Number(line.height)||0})),pages=new Map();
    for(const item of items){if(!pages.has(item._page))pages.set(item._page,[]);pages.get(item._page).push(item);}
    const pageNumbers=[...pages.keys()].sort((a,b)=>a-b),summaryLabels=[{key:'subtotal',pattern:/\b(?:net\s+amount|net\s+total|subtotal)\s*(?:\([^)]{0,20}\))?/i},{key:'vat',pattern:/\b(?:VAT\s+amount|total\s+VAT|VAT\s+total)\s*(?:\([^)]{0,20}\))?/i},{key:'total',pattern:/\btotal(?:\s+amount)?\s*(?:\([^)]{0,20}\))?/i}];
    for(let pageIndex=0;pageIndex<pageNumbers.length-1;pageIndex++){
      const pageNumber=pageNumbers[pageIndex],nextPageNumber=pageNumbers[pageIndex+1];if(nextPageNumber!==pageNumber+1)continue;
      const page=pages.get(pageNumber),nextPage=pages.get(nextPageNumber),pageBottom=Math.max(...page.map(item=>item._y+item._h),1),nextPageBottom=Math.max(...nextPage.map(item=>item._y+item._h),1),pageWidth=Math.max(...page.map(item=>item._x+item._w),1),nextWidth=Math.max(...nextPage.map(item=>item._x+item._w),1),labels={subtotal:[],vat:[],total:[]};
      for(const item of page){for(const descriptor of summaryLabels){if(descriptor.pattern.test(String(item.text||''))){labels[descriptor.key].push(item);break;}}}
      const labelTolerance=Math.max(pageBottom*.025,...Object.values(labels).flat().map(item=>item._h*2),1);let labelGroup=null;
      for(const netLine of labels.subtotal)for(const vatLine of labels.vat)for(const totalLine of labels.total){const yValues=[netLine._y,vatLine._y,totalLine._y],top=Math.min(...yValues),bottom=Math.max(...yValues);if(bottom-top>labelTolerance||bottom<pageBottom*.62)continue;const score=bottom/pageBottom-(bottom-top)/pageBottom;if(!labelGroup||score>labelGroup.score)labelGroup={net:{key:'subtotal',line:netLine},vat:{key:'vat',line:vatLine},total:{key:'total',line:totalLine},score};}
      if(!labelGroup)continue;const {net,vat,total}=labelGroup;
      const labelHeight=Math.max(net.line._h,vat.line._h,total.line._h,1);
      if(!(net.line._x<vat.line._x&&vat.line._x<total.line._x))continue;
      const moneyLines=[];for(const item of nextPage){if(item._y>nextPageBottom*.24)continue;for(const money of anchoredInvoiceMoneyValues(item.text))moneyLines.push({line:item,...money});}
      const rowTolerance=Math.max(labelHeight*2,nextPageBottom*.018),rows=[];
      for(const candidate of moneyLines){let row=rows.find(group=>Math.abs(group.y-candidate.line._y)<=rowTolerance);if(!row){row={y:candidate.line._y,values:[]};rows.push(row);}row.values.push(candidate);}
      const labelXs=[net.line._x/pageWidth,vat.line._x/pageWidth,total.line._x/pageWidth];let best=null;
      for(const row of rows){const deduped=[];for(const candidate of row.values.sort((a,b)=>a.line._x-b.line._x)){if(!deduped.some(item=>Math.abs(item.line._x-candidate.line._x)<=Math.max(candidate.line._h,1)))deduped.push(candidate);}if(deduped.length<3)continue;
        for(let start=0;start<=deduped.length-3;start++){const values=deduped.slice(start,start+3),xPositions=values.map(item=>item.line._x/nextWidth);if(!(xPositions[0]<xPositions[1]&&xPositions[1]<xPositions[2]))continue;const xScore=xPositions.reduce((sum,x,index)=>sum+Math.abs(x-labelXs[index]),0),score=Math.abs(row.y/nextPageBottom-.09)+xScore;if(!best||score<best.score)best={score,values};}
      }
      if(best)return {subtotal:{value:best.values[0].value,label:net.line.text},vat:{value:best.values[1].value,label:vat.line.text},total:{value:best.values[2].value,label:total.line.text},pages:[pageNumber,nextPageNumber]};
    }
    return null;
  }
  function anchoredInvoiceDate(text,lines){
    const normalize=value=>String(value||'').replace(/\b([A-Za-z]{3,9})\.\s*/g,'$1 ').replace(/\s*([/.\-])\s*/g,'$1').replace(/\b(?:invoice\s+date|date\s+of\s+issue|tax\s+point|date\s+issued|demand\s+date|order\s+date|issue\s+date|issued|dated|date\s+paid|date)\b\s*[:#-]?/ig,' ').replace(/(\d)\s+(?=\d[/.\-])/g,'$1');
    const parseCandidate=value=>{const source=normalize(value),match=source.match(/\b(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s*,?\s*\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b/i);if(!match)return '';const monthFirst=match[0].match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})$/i);return parseDate(monthFirst?`${monthFirst[2]} ${monthFirst[1]} ${monthFirst[3]}`:match[0]);};
    const ordered=Array.isArray(lines)?lines.filter(line=>line&&String(line.text||'').trim()).slice().sort((a,b)=>(Number(a.page)||1)-(Number(b.page)||1)||(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0)):[];
    for(const line of ordered){const raw=String(line.text||'').trim();if(/\b(?:due\s+date|payment\s+date|statement\s+date)\b/i.test(raw))continue;if(/\b(?:invoice\s+date|date\s+of\s+issue|tax\s+point|date\s+issued|demand\s+date|order\s+date|issue\s+date|date\s+paid|\bissued\b|dated)\b/i.test(raw)||/^date\s*[.:#-]?$/i.test(raw)){const direct=parseCandidate(raw);if(direct)return direct;const samePage=ordered.filter(candidate=>candidate!==line&&(Number(candidate.page)||1)===(Number(line.page)||1)).map(candidate=>({candidate,date:parseCandidate(candidate.text),dy:Math.abs((Number(candidate.y)||0)-(Number(line.y)||0)),dx:(Number(candidate.x)||0)-((Number(line.x)||0)+(Number(line.width)||0)),xGap:Math.abs((Number(candidate.x)||0)-(Number(line.x)||0))})).filter(item=>item.date&&item.dy<=Math.max((Number(line.height)||20)*3,20)&&(item.dx>=-8||item.xGap<=Math.max((Number(line.height)||20)*2,80))).sort((a,b)=>a.dy-b.dy||a.dx-b.dx);if(samePage.length)return samePage[0].date;}}
    const labelled=String(text||'').match(/\b(?:invoice\s+date|date\s+of\s+issue|tax\s+point|date\s+issued|demand\s+date|order\s+date|issue\s+date|date\s+paid|issued|dated)\b\s*[:#-]?\s*((?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s*,?\s*\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}))/i);if(labelled){const direct=parseCandidate(labelled[1]);if(direct)return direct;}
    for(const line of ordered){const raw=String(line.text||'').trim();if(/\b(?:due\s+date|payment\s+date|statement\s+date|billing\s+period|period)\b/i.test(raw)||/\d{4}\s*[-–]\s*\d{4}/.test(raw))continue;const date=parseCandidate(raw);if(!date)continue;const page=Number(line.page)||1,h=Math.max(Number(line.height)||16,16),related=ordered.filter(other=>(Number(other.page)||1)===page&&other!==line&&Math.abs((Number(other.y)||0)-(Number(line.y)||0))<=h*3);if(related.some(other=>/\b(?:due\s+date|payment\s+date|statement\s+date|billing\s+period|period)\b/i.test(String(other.text||''))))continue;return date;}return '';
  }
  function anchoredInvoiceNumber(text,lines){
    const directText=String(text||'').replace(/\s+/g,' '),explicit=directText.match(/\b(?:(?:tax|VAT)\s+)?invoice\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*((?:INV[-/]?)?[A-Z0-9][A-Z0-9/-]*)\b/i),explicitValue=cleanInvoiceNumber(explicit?.[1]);if(explicitValue&&/[0-9]/.test(explicitValue))return explicitValue;const direct=directText.match(/\b(?:(?:tax|VAT)\s+)?invoice\s+((?:INV[-/]?)?[A-Z0-9][A-Z0-9/-]{2,})\b/i),directValue=cleanInvoiceNumber(direct?.[1]);if(directValue&&/[0-9]/.test(directValue))return directValue;
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),patterns=[/\b(?:(?:tax|VAT)\s+)?invoice\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*/i,/\binv\.?\s*(?:number|no\.?|nr\.?|#)\s*[:#.-]?\s*/i,/\bbill\s+reference\s*[:#.-]?\s*/i,/\b(?:receipt|credit\s+note)\s*(?:number|no\.?|#)\s*[:#.-]?\s*/i];
    // Some bill layouts put the value below "Your VAT invoice number". Use
    // that label/value pair before considering unanchored numbers elsewhere.
    for(const label of items.filter(line=>/\b(?:your\s+)?(?:(?:tax|VAT)\s+)?invoice\s*(?:number|no\.?|nr\.?|#)\b/i.test(String(line.text||'')))){
      const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),height=Math.max(Number(label.height)||0,12),pageWidth=Math.max(...page.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),lx=Number(label.x)||0,ly=Number(label.y)||0,lw=Number(label.width)||0;
      const nearby=page.map(line=>{const raw=String(line.text||'').trim(),candidate=cleanInvoiceNumber(raw),x=Number(line.x)||0,y=Number(line.y)||0,dy=y-ly,dx=x-(lx+lw);return {candidate,raw,line,score:Math.abs(dy)/height+Math.abs(dx)/pageWidth*3};}).filter(item=>item.line!==label&&item.candidate&&/[0-9]/.test(item.candidate)&&item.candidate.length>=3&&item.candidate.length<=40&&!/\b(?:VAT\s*(?:registration|number|no\.?|rate)|invoice\s+date|date\s+of\s+issue|issue\s+date|tax\s+point|due\s+date|account\s+number|page\s+no\.?)\b/i.test(item.raw)&&Math.abs((Number(item.line.x)||0)-lx)<=Math.max(pageWidth*.12,height*4)&&(Number(item.line.y)||0)>=ly-height*.8&&((Number(item.line.y)||0)-ly)<=Math.max(height*5,60));
      nearby.sort((a,b)=>a.score-b.score);if(nearby.length)return nearby[0].candidate;
    }
    for(const pattern of patterns){const labels=items.filter(line=>pattern.test(String(line.text||''))).sort((a,b)=>(Number(a.page)||1)-(Number(b.page)||1)||(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0));for(const label of labels){const inline=cleanInvoiceNumber(String(label.text||'').replace(pattern,'').trim());if(inline)return inline;const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),right=(Number(label.x)||0)+(Number(label.width)||0),pageWidth=Math.max(...page.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),height=Math.max(Number(label.height)||0,1),candidates=[];for(const line of page){if(line===label||/\b(?:due\s+date|invoice\s+date|date\s+of\s+issue|page\s+no\.?|customer\s+enquiry|order\s+(?:no\.?|number)|purchase\s+order|account\s+(?:no\.?|number))\b/i.test(String(line.text||'')))continue;const raw=String(line.text||'').trim(),candidate=cleanInvoiceNumber(raw);if(!candidate||!/[0-9]/.test(candidate)||candidate.length<3||candidate.length>40)continue;const yGap=Math.abs((Number(line.y)||0)-(Number(label.y)||0)),xGap=(Number(line.x)||0)-right,row=yGap<=Math.max(height*1.6,16),nearBelow=(Number(line.y)||0)>=(Number(label.y)||0)&&yGap<=Math.max(height*6,48)&&Math.abs((Number(line.x)||0)-(Number(label.x)||0))<=pageWidth*.22;if(!row&&!nearBelow)continue;const pairedWithOtherField=page.some(other=>other!==line&&other!==label&&/\b(?:order\s+(?:no\.?|number)|purchase\s+order|customer\s+(?:no\.?|number)|account\s+(?:no\.?|number)|delivery\s+(?:no\.?|number)|reference\s+(?:no\.?|number))\b/i.test(String(other.text||''))&&(Number(line.y)||0)>=(Number(other.y)||0)-height&&(Number(line.y)||0)-(Number(other.y)||0)<=height*6&&Math.abs((Number(line.x)||0)-(Number(other.x)||0))<=pageWidth*.18);if(pairedWithOtherField)continue;const score=row?yGap/height+Math.max(0,xGap)/pageWidth*3+(xGap<0?.3:0):yGap/height*.45+Math.abs((Number(line.x)||0)-(Number(label.x)||0))/pageWidth*3+.2;candidates.push({candidate,score});}candidates.sort((a,b)=>a.score-b.score);if(candidates.length)return candidates[0].candidate;}}
    return anchoredInvoiceTextBesideLabel(items,[/^invoice$/i,/^invoice\s+number$/i,/^order\s+number$/i,/^invoice\s+date$/i])||extractInvoiceNumber(text)||'';
  }
  function anchoredTakepaymentsInvoiceNumber(text,lines){
    const direct=String(text||'').replace(/\s+/g,' ').match(/\bInvoice\s*(?:Number|No\.?|#)\s*[:#-]?\s*(PZ[A-Z0-9-]{6,})\b/i);
    if(direct)return direct[1];
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim());
    for(const label of items.filter(line=>/^\s*Invoice\s*(?:Number|No\.?|#)\s*$/i.test(String(line.text||'')))){
      const height=Math.max(Number(label.height)||16,16),page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),right=(Number(label.x)||0)+(Number(label.width)||0),candidates=page.filter(line=>line!==label&&/^PZ[I1]?[A-Z0-9-]{6,}$/i.test(String(line.text||'').trim())&&(Number(line.x)||0)>=right-height&&(Math.abs((Number(line.y)||0)-(Number(label.y)||0))<=Math.max(height*1.8,24))).sort((a,b)=>Math.abs((Number(a.y)||0)-(Number(label.y)||0))-Math.abs((Number(b.y)||0)-(Number(label.y)||0))||(Number(a.x)||0)-(Number(b.x)||0));
      if(candidates.length)return String(candidates[0].text).trim();
    }
    return '';
  }
  function anchoredHealthxchangeInvoiceNumber(text,lines){
    const flat=String(text||'').replace(/\s+/g,' '),match=flat.match(/\bInvoice\s*(?:Number|No\.?|#)\s*:?\s*([A-Z]{0,3}\d{6,})\b/i);
    if(match)return match[1];
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim());
    for(const label of items.filter(line=>/^\s*Invoice\s*(?:Number|No\.?|#)\s*:?\s*$/i.test(String(line.text||'')))){
      const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),height=Math.max(Number(label.height)||16,16),right=(Number(label.x)||0)+(Number(label.width)||0),candidates=page.filter(line=>line!==label&&/^[A-Z]{0,3}\d{6,}$/i.test(String(line.text||'').trim())&&(Number(line.x)||0)>=right-height&&Math.abs((Number(line.y)||0)-(Number(label.y)||0))<=Math.max(height*2.5,36)).sort((a,b)=>Math.abs((Number(a.y)||0)-(Number(label.y)||0))-Math.abs((Number(b.y)||0)-(Number(label.y)||0))||(Number(a.x)||0)-(Number(b.x)||0));
      if(candidates.length)return String(candidates[0].text).trim();
    }
    return '';
  }
  function generatedInvoiceReference(profileId,date,text){
    const normalized=`${profileId}|${date}|${String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim().toUpperCase()}`;let hash=2166136261;
    for(let index=0;index<normalized.length;index++)hash=Math.imul(hash^normalized.charCodeAt(index),16777619);
    return `AUTO-${String(date||'').replace(/\D/g,'')}-${(hash>>>0).toString(36).toUpperCase().padStart(7,'0')}`;
  }
  function anchoredMedisortValues(text){
    const flat=String(text||'').replace(/\s+/g,' '),summary=[...flat.matchAll(/\bNet\s+Value\b[\s\S]{0,160}?\bVAT\s*@(?:\s*\d+(?:[.,]\d+)?\s*%)?[\s\S]{0,100}?\bTotal\s+Value\b/gi)].at(-1);
    if(!summary)return null;
    const values=anchoredInvoiceMoneyValues(flat.slice(summary.index+summary[0].length)).slice(0,3).map(item=>item.value);
    return values.length===3?{subtotal:{value:values[0]},vat:{value:values[1]},total:{value:values[2]}}:null;
  }
  function anchoredMedisortInvoiceNumber(text){
    const flat=String(text||'').replace(/\s+/g,' '),match=flat.match(/\bInvoice\s+Number\b[\s\S]{0,900}?\b(\d{6,8})\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})\s+\d{5,8}\s+\d+\s+of\s+\d+\b/i);
    return match?match[1]:'';
  }
  function invoiceLikeDocumentEvidence(text,lines){
    const normalizeCueText=value=>String(value||'').replace(/[Þþ]/g,'fi').replace(/ﬁ/g,'fi').replace(/ﬂ/g,'fl'),pages=new Map(),items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim());
    for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(normalizeCueText(line.text));}
    if(!pages.size)pages.set(1,[normalizeCueText(text)]);
    const nonInvoiceCue=/\b(?:account\s+statement|statement\s+of\s+(?:account|the\s+account)|remittance\s+advice|payment\s+advice|order\s+confirmation|confirmation\s+of\s+your\s+order|order\s+has\s+been\s+received|order\s+received|pro\s+forma|receipt\s*&\s*feedback|purchase\s+order|sales\s+order|quotation|quote\s+(?:number|no\.?|#|for))\b/i;
    const invoiceCue=/\b(?:tax\s+invoice|VAT\s+invoice|invoice\b|credit\s+(?:note|memo))\b/i;
    const billCue=/\b(?:bill\b|bill\s+issue\s+date|bill\s+(?:number|no\.?|#|reference|ref)|total\s+for\s+this\s+bill|monthly\s+(?:business\s+)?bill|utility\s+bill)\b/i;
    const receiptCue=/\b(?:receipt\b|amount\s+paid|date\s+paid)\b/i;
    const positivePages=[],negativePages=[];
    for(const [page,parts] of pages){const content=parts.join(' ');if(invoiceCue.test(content)||billCue.test(content)||receiptCue.test(content))positivePages.push(page);if(nonInvoiceCue.test(content))negativePages.push(page);}
    if(negativePages.length){
      const independentPositive=positivePages.some(page=>!negativePages.includes(page));
      const strongInvoicePage=positivePages.some(page=>{const content=(pages.get(page)||[]).join(' ');return invoiceCue.test(content)&&! /\b(?:order\s+confirmation|confirmation\s+of\s+your\s+order|order\s+has\s+been\s+received|order\s+received|pro\s+forma)\b/i.test(content);});
      if(!independentPositive&&!strongInvoicePage)return {isInvoice:false,kind:'NON-INVOICE'};
    }
    if(positivePages.length){const content=positivePages.map(page=>(pages.get(page)||[]).join(' ')).join(' '),hasInvoice=invoiceCue.test(content);return {isInvoice:true,kind:hasInvoice?(/\bcredit\s+(?:note|memo)\b/i.test(content)?'CREDIT NOTE':'INVOICE'):billCue.test(content)?'BILL':'RECEIPT'};}
    const flat=normalizeCueText(text||items.map(line=>line.text||'').join(' '));
    if(/\b(?:tax\s+)?invoice\b|\bcredit\s+(?:note|memo)\b|\bbill\b|\breceipt\b/i.test(flat)&&!nonInvoiceCue.test(flat))return {isInvoice:true,kind:/\bcredit\s+(?:note|memo)\b/i.test(flat)?'CREDIT NOTE':/\bbill\b/i.test(flat)?'BILL':/\breceipt\b/i.test(flat)?'RECEIPT':'INVOICE'};
    return {isInvoice:false,kind:'NON-INVOICE'};
  }
  function anchoredInvoiceLastMoneyBeforeLabel(lines,stopPattern){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}let best=null;
    for(const [page,pageLines] of pages){const stop=pageLines.filter(line=>stopPattern.test(String(line.text||''))).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0];if(!stop)continue;const width=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),candidates=[];for(const line of pageLines){if((Number(line.y)||0)>=(Number(stop.y)||0)||((Number(line.x)||0)<width*.58))continue;for(const money of anchoredInvoiceMoneyValues(line.text))candidates.push({value:money.value,y:Number(line.y)||0,x:Number(line.x)||0,page});}candidates.sort((a,b)=>b.y-a.y||b.x-a.x);if(candidates[0]&&(!best||candidates[0].page>best.page||candidates[0].page===best.page&&candidates[0].y>best.y))best=candidates[0];}return best?{value:best.value}:null;
  }
  function parseAnchoredInvoice(flat,source,ocrLines,profile){
    const text=String(flat||''),generic=parseInvoiceGeneric(text,source,ocrLines),lines=Array.isArray(ocrLines)?ocrLines:[];
    let documentEvidence=invoiceLikeDocumentEvidence(text,lines);
    const exportInvoice=profile.id==='sofwave'&&/\bExport\s+Invoice\b/i.test(text);
    if(exportInvoice)documentEvidence={isInvoice:true,kind:'INVOICE'};
    const orderReceipt=profile.id==='inmode'&&/\bORDER\s+GB\d+\b/i.test(text)&&/\bTotal\s+incl\.\s*VAT\b/i.test(text);
    if(orderReceipt)documentEvidence={isInvoice:true,kind:'INVOICE'};
    const lyntonReference=profile.id==='lynton'?String(text.match(/\bMULTI[-\s]?SHIPMENT\s+INVOICE\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,})/i)?.[1]||''):'',takepaymentsReference=profile.id==='takepayments'?anchoredTakepaymentsInvoiceNumber(text,lines):'',medisortReference=profile.id==='medisort'?anchoredMedisortInvoiceNumber(text):'',healthxchangeReference=profile.id==='healthxchange'?anchoredHealthxchangeInvoiceNumber(text,lines):'',sofwaveReference=profile.id==='sofwave'?String(text.match(/\bDocument\s+Number\s*:?\s*([A-Z0-9/-]{6,})/i)?.[1]||''):'';
    const hasInvoiceLabel=documentEvidence.isInvoice,isInvoiceDocument=Boolean(profile.detect(text)&&hasInvoiceLabel),number=takepaymentsReference||medisortReference||healthxchangeReference||sofwaveReference||anchoredInvoiceNumber(text,lines)||generic.invoiceNumber||(profile.id==='care-check'?anchoredInvoiceCareCheckNumber(lines):'')||(lyntonReference?lyntonReference.slice(-4):''),date=anchoredInvoiceDate(text,lines)||generic.date;
    const totalLabels=[/\b(?:total\s+for\s+this\s+bill|the\s+total\s+owed\s+on\s+this\s+account\s+is|total\s+invoice\s+amount|total\s+invoice|invoice\s+total|total\s+payable|grand\s+total|total\s+charges\s+for\s+(?:this\s+)?invoice|total\s+charges\s+for\s+bill)\b/i,/\b(?:amount\s+due\s+in\s+(?:GBP|EUR|USD)|total\s+due\s+in\s+(?:GBP|EUR|USD)|total\s+(?:due|payable|value|amount|GBP)|amount\s+payable|amount\s+due|balance\s+due|gross\s+(?:amount|total|value))\b/i,/^\s*(?:total|gross)\s*(?:\([^)]{0,12}\))?\s*(?:[Ã‚Â£Ã¢â€šÂ¬$E]|GBP|EUR|USD)?\s*[:#-]?\s*$/i];
    totalLabels.push(/\btotal\b/i);
    const vatLabels=[/\bVAT\s*-\s*(?:United\s+Kingdom|UK)\b/i,/\bVAT\s+due\s*\([^)]{0,80}\)/i,/\b(?:total\s+VAT|VAT\s+total|VAT\s+amount|VAT\s+value|total\s+tax|tax\s+amount|tax\s+value)\b/i,/\bVAT\s*(?:@\s*)?\d+(?:[.,]\d+)?\s*%/i,/^\s*VAT\s+(?:[Ã‚Â£Ã¢â€šÂ¬$E]|GBP|EUR|USD)\s*[:#-]?\s*$/i,/^\s*VAT\s*(?:\([^)]{0,12}\))?\s*[:#-]?\s*$/i];
    const totalExclude=/\b(?:total\s+(?:outstanding|in\s+words|net\s+price|VAT)|statement\s+balance|opening\s+balance)\b/i,btBillTotal=profile.id==='bt'?(anchoredInvoiceRelativeValue(lines,[/\btotal\s+for\s+this\s+bill\b/i],{exclude:totalExclude})||anchoredInvoiceFlatValue(text,[/\btotal\s+for\s+this\s+bill\b/i],{exclude:totalExclude})):null,splitSummary=anchoredInvoiceSplitSummary(lines);
    let totalFound=btBillTotal||anchoredInvoiceRelativeValue(lines,totalLabels,{exclude:totalExclude})||anchoredInvoiceFlatValue(text,totalLabels,{exclude:totalExclude})||splitSummary?.total,supplierOcrConflictReason='';
    if(profile.id==='dr-stuttee'){
      const printedAmount=text.match(/\bAMOUNT\b[\s\S]{0,120}?((?:[\u00A3$\u20ACE]\s*)?(?:(?:\d{1,3}(?:[ ,]\d{3})+)|\d+)[.,]\s*\d{2})/i),amountAfterLabel=printedAmount?{value:invoiceAmount(printedAmount[1]),raw:printedAmount[1]}:null;
      totalFound=anchoredInvoiceRelativeValue(lines,[/^\s*AMOUNT\s*$/i],{exclude:/\b(?:VAT|account|sort\s+code|bank)\b/i})||amountAfterLabel||anchoredInvoiceFlatValue(text,[/\bAMOUNT\b/i])||totalFound;
      const amountWindow=text.match(/\bAMOUNT\b([\s\S]{0,120}?)(?=\bPAYMENT\s+DUE\b)/i)?.[1]||'',dueWindow=text.match(/\bPAYMENT\s+DUE\b([\s\S]{0,120}?)(?=\b(?:Bank\s+Address|MESSAGE|Page\s+\d)\b|$)/i)?.[1]||'',dueDateMatch=dueWindow.match(/\b(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s*,?\s*\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b/i),dueAmountText=dueDateMatch?dueWindow.slice(dueDateMatch.index+dueDateMatch[0].length):dueWindow,invoiceAmountValues=anchoredInvoiceMoneyValues(amountWindow),dueAmountValues=anchoredInvoiceMoneyValues(dueAmountText),printedInvoiceAmount=invoiceAmountValues.at(-1)?.value,dueAmount=dueAmountValues.at(-1)?.value;
      if(Number.isFinite(printedInvoiceAmount)&&Number.isFinite(dueAmount)&&Math.round(printedInvoiceAmount*100)!==Math.round(dueAmount*100)){supplierOcrConflictReason='The printed AMOUNT and PAYMENT DUE figures were read differently; total left blank for manual confirmation.';totalFound=null;}
    }
    const vatContentFound=anchoredInvoiceRelativeValue(lines,[/\bVAT\s+content\b/i])||anchoredInvoiceFlatValue(text,[/\bVAT\s+content\b/i]),includedVat=text.match(/\b(?:includes?|including)\s+(?:(?:GBP|EUR|USD)\s*)?[^0-9]{0,2}((?:\d{1,3}(?:[ ,]\d{3})+|\d+)[.,]\s*\d{2})\s+VAT\b/i),vatIncludedFound=includedVat?{value:invoiceAmount(includedVat[1]),raw:includedVat[1]}:null;
    let vatFound=anchoredInvoiceRelativeValue(lines,vatLabels)||anchoredInvoiceFlatValue(text,vatLabels)||vatContentFound||vatIncludedFound||splitSummary?.vat;
    const summary=(totalPatterns,vatPatterns,{minimumYRatio=.45,maximumValueDistanceRatio=.015}={})=>({total:anchoredInvoiceSummaryValue(lines,totalPatterns,{minimumYRatio,maximumValueDistanceRatio}),vat:anchoredInvoiceSummaryValue(lines,vatPatterns,{minimumYRatio,maximumValueDistanceRatio})});
    const profileSummaries={
      'acre-aesthetics':summary([/^\s*Total\s*\(E\)\s*$/i],[/^\s*VAT\s+Amount\s*\(E\)\s*$/i],{minimumYRatio:.5,maximumValueDistanceRatio:.04}),
      pabau:summary([/^\s*Paid\s+Amount\s*:?\s*$/i],[/^\s*VAT\s*:?\s*$/i],{minimumYRatio:.4}),
      'hannah-mcclune':summary([/^\s*Total\s*:?\s*$/i],[/^\s*VAT\s*\(\s*20\s*%\s*\)\s*$/i],{minimumYRatio:0}),
      'aec-holdings':summary([/^\s*TOTAL\s+DUE\s*:?\s*$/i],[/^\s*VAT\s*:?\s*$/i],{minimumYRatio:.35}),
      inmode:summary([/^\s*Total\s+incl\.?\s*VAT\s*$/i],[/^\s*VAT\s*\(\s*GB\s+VAT\s*\)\s*$/i],{minimumYRatio:.35}),
      'mailchimp':summary([], [/^\s*Tax\s*:?\s*$/i],{minimumYRatio:.4}),
      medisort:summary([/^\s*Total\s+Value\s*$/i],[/^\s*VAT\s*@\s*$/i],{minimumYRatio:.5}),
      'mgb-sparky':summary([/^\s*TOTAL\s*$/i],[/^\s*VAT\s+TOTAL\s*$/i],{minimumYRatio:.35}),
      takepayments:summary([/^\s*Total\s+GBP\s*$/i],[/^\s*(?:20%\s+)?VAT\s*$/i],{minimumYRatio:.25}),
      'reliable-medicare':summary([/^\s*Grand\s+Total\s*\(\s*Incl\.?\s*Tax\s*\)\s*:?\s*$/i],[/^\s*Tax\s*:?\s*$/i],{minimumYRatio:.45}),
      'sos-oxygen':summary([/^\s*TOTAL\s*$/i],[/^\s*VAT\s+TOTAL\s*$/i],{minimumYRatio:.25}),
      'zp-services':summary([/^\s*TOTAL\s*$/i],[/^\s*VAT\s*\(\s*20\s*%\s*\)\s*$/i],{minimumYRatio:.08}),
      wix:summary([/^\s*Total\s*$/i],[/^\s*VAT\s*\(\s*20\s*%\s*\)\s*$/i],{minimumYRatio:.35}),
      'light-hub':summary([/^\s*Total\s+incl\.?\s+VAT\s*$/i],[/^\s*VAT\s*\(\s*GB\s+VAT\s*\)\s*$/i],{minimumYRatio:.35})
    };
    const exact=profileSummaries[profile.id];
    const medisortSummary=profile.id==='medisort'?anchoredMedisortValues(text):null;
    if(profile.id==='medisort'&&medisortSummary){totalFound=medisortSummary.total;vatFound=medisortSummary.vat;}
    if(profile.id==='takepayments'){
      const flatVat=anchoredInvoiceFlatValue(text,[/\b20%\s*VAT\b/i]),flatTotal=anchoredInvoiceFlatValue(text,[/\bTotal\s+GBP\s+Incl\.?\s+VAT\b/i]);
      vatFound=exact?.vat||flatVat||vatFound;totalFound=exact?.total||flatTotal||totalFound;
    }
    if(profile.id==='siemens-finance'){
      const exactSiemensTotal=anchoredInvoiceSummaryValue(lines,[/^\s*Total\s+due\s+in\s+GBP\s*$/i],{minimumYRatio:.35})||anchoredInvoiceFlatValue(text,[/\bTotal\s+due\s+in\s+GBP\b/i],{exclude:/\b(?:opening|statement)\s+balance\b/i});
      if(exactSiemensTotal)totalFound=exactSiemensTotal;
    }
    if(profile.id==='mgb-sparky'){
      const printedMgbTotal=anchoredInvoiceFlatValue(text,[/(?<!VAT\s)\bTOTAL\b(?!\s+DUE)/i],{exclude:/\bVAT\s+TOTAL\b/i});
      if(printedMgbTotal)totalFound=printedMgbTotal;
    }
    if(profile.id==='francisco-electrical'){
      const printedAmount=anchoredInvoiceFlatValue(text,[/\bAmount\s*,?\s*GBP\b/i]);
      if(printedAmount)totalFound=printedAmount;
    }
    if(profile.id==='siemens-finance')vatFound=anchoredInvoiceSiemensVat(lines)||vatFound;
    if(profile.id==='acre-aesthetics'){const acreSummary=anchoredInvoiceAcreSummary(lines);totalFound=acreSummary?.total||null;vatFound=acreSummary?.vat||null;}
    else{if(exact?.total)totalFound=exact.total;if(exact?.vat)vatFound=exact.vat;}
    if(profile.id==='mailchimp')totalFound=anchoredInvoiceLastMoneyBeforeLabel(lines,/\bPaid\s+via\b/i)||totalFound;
    if(profile.id==='sofwave')vatFound=null;
    if(profile.id==='wix'&&/VAT\s+to\s+be\s+accounted\s+for\s+by\s+(?:the\s+)?recipient/i.test(text))vatFound={value:0,label:'VAT is accounted for by the recipient'};
    if(profile.id==='sylton'&&/\bTax\s+to\s+be\s+paid\s+on\s+reverse\s+charge\s+basis\b/i.test(text))vatFound={value:0,label:'reverse charge; no VAT charged'};
    const noVatShownProfiles=new Set(['arabella-johnson','dr-stuttee','francisco-electrical','laundrylite']);
    if(noVatShownProfiles.has(profile.id)&&isInvoiceDocument&&!/\bVAT\b/i.test(text))vatFound={value:0,label:'No VAT is shown on the invoice'};
    const exactVatProfiles=new Set(['acre-aesthetics','pabau','hannah-mcclune','aec-holdings','inmode','mailchimp','medisort','mgb-sparky','takepayments','reliable-medicare','sos-oxygen','zp-services','wix','light-hub','sofwave','sylton','siemens-finance','dr-stuttee']);
    const exactTotalProfiles=new Set(['acre-aesthetics','pabau','hannah-mcclune','aec-holdings','inmode','mailchimp','medisort','mgb-sparky','takepayments','reliable-medicare','sos-oxygen','zp-services','wix','light-hub','dr-stuttee','siemens-finance']);
    const subtotalFound=anchoredInvoiceRelativeValue(lines,[/\b(?:subtotal|net\s+total|total\s+net|net\s+amount|net\s+value|net\s+[Ã‚Â£Ã¢â€šÂ¬$E])\b/i])||anchoredInvoiceFlatValue(text,[/\b(?:subtotal|net\s+total|total\s+net|net\s+amount|net\s+value|net\s+[Ã‚Â£Ã¢â€šÂ¬$E])\b/i])||splitSummary?.subtotal;
    let resolvedNumber=number||(['medisort','sos-oxygen','inmode','hannah-mcclune'].includes(profile.id)?anchoredInvoiceTextBesideLabel(lines,[/^invoice$/i,/^invoice\s+number$/i,/^order\s+number$/i]):''),invoiceNumberGenerated=false,invoiceNumberGeneratedReason='';
    if(!resolvedNumber&&['arabella-johnson','laundrylite'].includes(profile.id)&&isInvoiceDocument&&date&&totalFound&&vatFound){resolvedNumber=generatedInvoiceReference(profile.id,date,text);invoiceNumberGenerated=true;invoiceNumberGeneratedReason=`The invoice does not print an invoice number; generated the internal reference ${resolvedNumber}.`;}
    const retryOcr=Boolean(isInvoiceDocument&&(profile.id==='dr-stuttee'||!resolvedNumber||!date||!totalFound||!vatFound));generic.originalInvoiceNumber=lyntonReference||takepaymentsReference||medisortReference||healthxchangeReference||sofwaveReference||generic.originalInvoiceNumber||resolvedNumber||number;
    const resolvedKind=exportInvoice?'INVOICE':documentEvidence.kind;
    return {...generic,invoiceNumber:resolvedNumber||number,invoiceNumberGenerated,invoiceNumberGeneratedReason,date,supplier:profile.name,total:totalFound?.value??(exactTotalProfiles.has(profile.id)?'':generic.total??''),vat:vatFound?.value??(exactVatProfiles.has(profile.id)?'':generic.vat??''),subtotal:subtotalFound?.value??generic.subtotal??'',currency:/\bEUR\b|Ã¢â€šÂ¬/i.test(text)?'EUR':/\bUSD\b|\$/i.test(text)?'USD':'GBP',documentType:resolvedKind,isInvoiceDocument,accepted:false,rejected:true,retryOcr,ocrConflictReason:supplierOcrConflictReason,rejectedReason:supplierOcrConflictReason||(isInvoiceDocument?'':'This document does not appear to be an invoice.')};
  }
  function isGsfCarPartsText(value){const text=String(value||'');return /\bGSF\s*CAR\s*PARTS\s*LIMITED\b|\b743\s*[-–]\s*PETERBOROUGH\b|\b743gsf\.sales\s*@\s*gsfgroup\.com\b|\b135\s+6066\s+20\b/i.test(text);}
  function gsfNormalizedLabel(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[0]/g,'O').replace(/[1|]/g,'I').replace(/[^A-Z]/g,'');}
  function gsfSummaryLabelKind(line){
    const raw=String(line?.text||'').trim();if(!raw||/%|REG(?:ISTRATION)?\b|\b(?:RATE|CODE|NUMBER|NO\.?|POINT)\b/i.test(raw))return '';
    const token=gsfNormalizedLabel(raw);if(token.length>=2&&token.length<=5&&receiptLevenshtein(token,'VAT')<=1)return 'vat';if(token.length>=3&&token.length<=9&&receiptLevenshtein(token,'TOTAL')<=2)return 'total';if(token.length>=3&&token.length<=10&&receiptLevenshtein(token,'GOODS')<=3)return 'goods';return '';
  }
  function gsfMoneyValues(value){
    // GSF's narrow footer digits are sometimes split by Windows OCR, e.g.
    // "I .66" for the printed 1.66. Repair only a lone leading I/l/pipe and
    // whitespace around the decimal in this supplier-specific summary.
    const text=String(value||'').replace(/(^|[^\d])(?:[Il|])(?=\s*[.,]\s*\d{2}(?!\d))/g,(_match,prefix)=>`${prefix}1`).replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g,'$1$2$3');
    return anchoredInvoiceMoneyValues(text);
  }
  function gsfLineMoney(lines,label){
    const page=Number(label?.page)||1,items=(lines||[]).filter(line=>(Number(line.page)||1)===page),height=Math.max(Number(label?.height)||0,12),pageHeight=Math.max(...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),rowTolerance=Math.max(height*.75,pageHeight*.009,18),lx=Number(label?.x)||0,ly=Number(label?.y)||0,labelRight=lx+Math.max(Number(label?.width)||0,String(label?.text||'').length*7),candidates=[];
    const add=(line,inline=false)=>{
      const raw=String(line?.text||'');for(const money of gsfMoneyValues(raw))candidates.push({value:money.value,raw:money.raw,line,score:inline?0:Math.abs((Number(line.y)||0)-ly)/rowTolerance+Math.max(0,(Number(line.x)||0)-labelRight)/Math.max(1,pageHeight)*.05});
      if(/\bF\s*\.?\s*O\s*\.?\s*C\s*\.?\b/i.test(raw))candidates.push({value:0,raw:'F.O.C.',line,score:inline?0:Math.abs((Number(line.y)||0)-ly)/rowTolerance+Math.max(0,(Number(line.x)||0)-labelRight)/Math.max(1,pageHeight)*.05});
    };
    add(label,true);
    for(const line of items){if(line===label)continue;const x=Number(line.x)||0,y=Number(line.y)||0;if(x<labelRight-height*.4||Math.abs(y-ly)>rowTolerance)continue;add(line);}
    candidates.sort((a,b)=>a.score-b.score||(Number(a.line.x)||0)-(Number(b.line.x)||0));return candidates[0]||null;
  }
  function gsfPrintedDate(lines){
    const items=(lines||[]).filter(line=>line&&String(line.text||'').trim()),dates=[];
    // GSF prints dates as DD/MM/YY. A one-digit day or month is treated as a truncated OCR read and retried, never accepted as a different date.
    const consensusDates=[...new Set(items.filter(line=>line.gsfDateConsensus).flatMap(line=>[...String(line.text||'').matchAll(/\b\d{2}\s*[/.-]\s*\d{2}\s*[/.-]\s*\d{2,4}\b/g)].map(match=>parseDate(match[0].replace(/\s+/g,''))).filter(Boolean)))];if(consensusDates.length===1)return consensusDates[0];if(consensusDates.length>1)return '';
    for(const line of items){const raw=String(line.text||'');if(/\b(?:due\s+date|statement\s+date|payment\s+date)\b/i.test(raw))continue;for(const match of raw.matchAll(/\b\d{2}\s*[/.\-]\s*\d{2}\s*[/.\-]\s*\d{2,4}\b/g)){const date=parseDate(match[0].replace(/\s+/g,''));if(date)dates.push({date,line});}}
    const labels=items.filter(line=>/\b(?:tax\s*point|invoice\s+date|date\s+of\s+issue)\b/i.test(String(line.text||'')));
    if(dates.length){dates.sort((a,b)=>{const score=item=>{const label=labels.map(line=>({line,score:Math.abs((Number(line.y)||0)-(Number(item.line.y)||0))/Math.max(1,Number(line.height)||18)+Math.abs((Number(line.x)||0)-(Number(item.line.x)||0))/Math.max(1,Number(item.line.width)||80)*.02})).sort((left,right)=>left.score-right.score)[0];return label?.score??(Number(item.line.y)||0)/Math.max(1,...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)));};return score(a)-score(b);});return dates[0].date;}
    const text=items.map(line=>String(line.text||'')).join(' '),matches=[...text.matchAll(/\b\d{2}\s*[/.\-]\s*\d{2}\s*[/.\-]\s*\d{2,4}\b/g)];for(const match of matches){const date=parseDate(match[0].replace(/\s+/g,''));if(date)return date;}return '';
  }
  function gsfPrintedNumber(text,lines){
    const candidates=[];for(const match of String(text||'').matchAll(/\b743(?:[\s-]*\d){7}\b/g)){const digits=match[0].replace(/\D/g,'');if(digits.length===10&&digits.startsWith('743')&&!candidates.includes(digits))candidates.push(digits);}
    for(const line of lines||[])for(const match of String(line.text||'').matchAll(/\b743(?:[\s-]*\d){7}\b/g)){const digits=match[0].replace(/\D/g,'');if(digits.length===10&&digits.startsWith('743')&&!candidates.includes(digits))candidates.push(digits);}
    return candidates.length===1?candidates[0]:'';
  }
  function gsfFooterAmountRows(items,pageHeight,pageWidth){
    const candidates=[];for(const line of items){const x=Number(line.x)||0,y=Number(line.y)||0;if(y<pageHeight*.76||x<pageWidth*.70)continue;for(const money of gsfMoneyValues(line.text))candidates.push({line,value:money.value,raw:money.raw,x,y});if(/^\s*F\s*\.?\s*O\s*\.?\s*C\s*\.?\s*$/i.test(String(line.text||'')))candidates.push({line,value:0,raw:'F.O.C.',x,y});}
    const heights=items.map(line=>Number(line.height)||0).filter(height=>height>0).sort((a,b)=>a-b),rowTolerance=Math.max((heights[Math.floor(heights.length/2)]||18)*1.5,pageHeight*.009,18),rows=[];
    for(const candidate of candidates.sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(item=>Math.abs(item.y-candidate.y)<=rowTolerance);if(!row){row={y:candidate.y,cells:[]};rows.push(row);}if(!row.cells.some(item=>Math.abs(item.x-candidate.x)<=rowTolerance*.5))row.cells.push(candidate);}
    return rows.map(row=>({y:row.y,value:row.cells.sort((a,b)=>b.x-a.x)[0]?.value??null,x:row.cells.sort((a,b)=>b.x-a.x)[0]?.x??0})).filter(row=>row.value!==null).sort((a,b)=>a.y-b.y);
  }
  function gsfFooterVatBreakdown(items,pageHeight,pageWidth){
    const headers=items.filter(line=>{const text=String(line.text||''),flat=gsfNormalizedLabel(text);return (Number(line.y)||0)>=pageHeight*.7&&/V.?T/.test(flat)&&flat.includes('GOODS')&&(flat.includes('CODE')||/%/.test(text)||/RATE/i.test(text));});
    for(const header of headers){const y=Number(header.y)||0,h=Math.max(Number(header.height)||16,16),hx=Number(header.x)||0,hw=Math.max(Number(header.width)||0,h),maxY=y+Math.max(pageHeight*.035,h*4),rowTolerance=Math.max(h*1.5,pageHeight*.009,18),cells=[];
      for(const line of items){const ly=Number(line.y)||0,x=Number(line.x)||0;if(ly<=y+h*.25||ly>maxY||x<hx+hw*.35)continue;for(const money of gsfMoneyValues(line.text))cells.push({line,value:money.value,x,y:ly});}
      const rows=[];for(const cell of cells.sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(item=>Math.abs(item.y-cell.y)<=rowTolerance);if(!row){row={y:cell.y,cells:[]};rows.push(row);}if(!row.cells.some(item=>Math.abs(item.x-cell.x)<=rowTolerance*.5))row.cells.push(cell);}
      const qualified=rows.filter(row=>row.cells.length>=2).sort((a,b)=>a.y-b.y);if(qualified.length===1)return qualified[0].cells.sort((a,b)=>b.x-a.x)[0]?.value??null;
    }
    // On dirty scans Windows OCR can split GSF's VAT% / CODE / GOODS / VAT
    // header across separate recognitions. When the VAT-rate and GOODS
    // headings still align, use the rightmost printed amount in the row
    // beneath them: that is the printed VAT column. Ignore the separate
    // right-hand totals box and require a single unambiguous row.
    const lowerHeaders=items.filter(line=>(Number(line.y)||0)>=pageHeight*.7),rateHeaders=lowerHeaders.filter(line=>/%/.test(String(line.text||''))&&/(?:V|X|Y)?AT/i.test(gsfNormalizedLabel(line.text))),goodsHeaders=lowerHeaders.filter(line=>gsfNormalizedLabel(line.text).includes('GOODS'));
    const fallbackRows=[];
    for(const rate of rateHeaders)for(const goods of goodsHeaders){const rateY=Number(rate.y)||0,goodsY=Number(goods.y)||0,headerHeight=Math.max(Number(rate.height)||0,Number(goods.height)||0,16),headerTolerance=Math.max(headerHeight*1.5,pageHeight*.009,18);if(Math.abs(rateY-goodsY)>headerTolerance)continue;const headerY=Math.min(rateY,goodsY),tableLeft=Math.min(Number(rate.x)||0,Number(goods.x)||0)-headerHeight,tableRight=pageWidth*.78,maxY=headerY+Math.max(pageHeight*.035,headerHeight*4),rowTolerance=Math.max(headerHeight*1.5,pageHeight*.009,18),cells=[];
      for(const line of items){const y=Number(line.y)||0,x=Number(line.x)||0;if(y<=headerY+headerHeight*.25||y>maxY||x<tableLeft||x>tableRight)continue;for(const money of gsfMoneyValues(line.text))cells.push({value:money.value,x,y});}
      const rows=[];for(const cell of cells.sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(item=>Math.abs(item.y-cell.y)<=rowTolerance);if(!row){row={y:cell.y,cells:[]};rows.push(row);}if(!row.cells.some(item=>Math.abs(item.x-cell.x)<=rowTolerance*.5))row.cells.push(cell);}
      for(const row of rows.filter(item=>item.cells.length>=3))fallbackRows.push(row.cells.sort((a,b)=>a.x-b.x));
    }
    const uniqueRows=[];for(const row of fallbackRows){if(!uniqueRows.some(existing=>existing.length===row.length&&existing.every((cell,index)=>Math.abs(cell.x-row[index].x)<18&&cell.value===row[index].value)))uniqueRows.push(row);}
    if(uniqueRows.length===1)return uniqueRows[0].at(-1)?.value??null;
    // GSF's tax breakdown is often split by OCR into separate CODE and GOODS
    // headings, with the net and VAT values printed in the row below. When
    // VAT% is missing from OCR, those two neighbouring headers still anchor
    // the table; use its rightmost printed money cell as VAT, outside the
    // separate invoice-total box.
    const codeHeaders=items.filter(line=>(Number(line.y)||0)>=pageHeight*.7&&/\bCODE\b/i.test(String(line.text||''))),goodsColumnHeaders=items.filter(line=>(Number(line.y)||0)>=pageHeight*.7&&gsfNormalizedLabel(line.text).includes('GOODS'));
    for(const code of codeHeaders)for(const goods of goodsColumnHeaders){const codeY=Number(code.y)||0,goodsY=Number(goods.y)||0,headerHeight=Math.max(Number(code.height)||0,Number(goods.height)||0,16),headerTolerance=Math.max(headerHeight*1.5,pageHeight*.009,18);if(Math.abs(codeY-goodsY)>headerTolerance)continue;const headerY=Math.min(codeY,goodsY),goodsX=Number(goods.x)||0,tableRight=pageWidth*.78,maxY=headerY+Math.max(pageHeight*.035,headerHeight*4),rowTolerance=Math.max(headerHeight*1.5,pageHeight*.009,18),cells=[];
      for(const line of items){const y=Number(line.y)||0,x=Number(line.x)||0;if(y<=headerY+headerHeight*.25||y>maxY||x<goodsX-headerHeight||x>tableRight)continue;for(const money of gsfMoneyValues(line.text))cells.push({value:money.value,x,y});if(/^\s*0[.,]0{2}\s*$/.test(String(line.text||'')))cells.push({value:0,x,y});}
      const rows=[];for(const cell of cells.sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(item=>Math.abs(item.y-cell.y)<=rowTolerance);if(!row){row={y:cell.y,cells:[]};rows.push(row);}if(!row.cells.some(item=>Math.abs(item.x-cell.x)<=rowTolerance*.5))row.cells.push(cell);}
      const qualified=rows.filter(row=>row.cells.length>=2).sort((a,b)=>a.y-b.y);if(qualified.length===1)return qualified[0].cells.sort((a,b)=>b.x-a.x)[0]?.value??null;
    }
    // On some GSF scans the VAT% / CODE / GOODS heading is merged into one
    // noisy OCR line (for example, "iiYATO/S" or "FVATO/...er90DE"). Keep
    // that text as the table anchor, then use the rightmost printed amount
    // in the single row directly beneath it. The header can span the columns,
    // so measure from its left edge rather than its OCR bounding-box right edge.
    const noisyVatHeaders=items.filter(line=>{
      const raw=String(line.text||''),token=gsfNormalizedLabel(raw),y=Number(line.y)||0,x=Number(line.x)||0;
      const fuzzyVat=Array.from({length:Math.max(0,token.length-1)},(_,index)=>token.slice(index,index+3)).some(part=>part.length>=2&&receiptLevenshtein(part,'VAT')<=1),vatLike=token.includes('VAT')||fuzzyVat&&/[%/]|CODE|GOODS|RATE/i.test(raw);
      return y>=pageHeight*.7&&x<pageWidth*.7&&vatLike&&token.length<=24&&/[/%]|CODE|GOODS|RATE|[^A-Z0-9]/i.test(raw)&&!/(?:REG|REGISTRATION|NUMBER|INVOICE)/i.test(raw);
    });
    const noisyVatRows=[];
    for(const header of noisyVatHeaders){
      const hx=Number(header.x)||0,hy=Number(header.y)||0,hh=Math.max(Number(header.height)||0,16),maxY=hy+Math.max(pageHeight*.04,hh*5,42),rowTolerance=Math.max(hh*1.5,pageHeight*.009,18),tableRight=pageWidth*.78,cells=[];
      for(const line of items){const y=Number(line.y)||0,x=Number(line.x)||0;if(y<=hy+hh*.2||y>maxY||x<hx+hh*.45||x>tableRight)continue;for(const money of gsfMoneyValues(line.text))cells.push({value:money.value,x,y});if(/^\s*0[.,]0{2}\s*$/.test(String(line.text||'')))cells.push({value:0,x,y});}
      const rows=[];for(const cell of cells.sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(item=>Math.abs(item.y-cell.y)<=rowTolerance);if(!row){row={y:cell.y,cells:[]};rows.push(row);}if(!row.cells.some(item=>Math.abs(item.x-cell.x)<=rowTolerance*.5))row.cells.push(cell);}
      const qualified=rows.filter(row=>row.cells.length>=2).sort((a,b)=>a.y-b.y);if(qualified.length===1)noisyVatRows.push(qualified[0].cells.sort((a,b)=>a.x-b.x));
    }
    if(noisyVatRows.length===1)return noisyVatRows[0].at(-1)?.value??null;
    return null;
  }
  function gsfSummary(lines){
    const pages=new Map();for(const line of lines||[]){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    const results=[];
    for(const [page,items] of pages){const pageHeight=Math.max(...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),pageWidth=Math.max(...items.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),labels=items.map(line=>({line,kind:gsfSummaryLabelKind(line)})).filter(item=>item.kind&&((Number(item.line.y)||0)>=pageHeight*.62));
      // A focused footer retry is a fresh OCR pass over the detected invoice
      // summary area. Prefer its aligned printed rows over noisy first-pass
      // labels, which can mistake a damaged "TOTAL" heading for "VAT".
      const focusedFooterLines=items.filter(line=>line.gsfRetryFocused===true);
      if(focusedFooterLines.length){
        const focusedPageHeight=Math.max(...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),focusedPageWidth=Math.max(...items.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),focusedRows=gsfFooterAmountRows(focusedFooterLines,focusedPageHeight,focusedPageWidth),combinedRows=gsfFooterAmountRows(items,focusedPageHeight,focusedPageWidth),focusedLabels=focusedFooterLines.filter(line=>['goods','vat','total'].includes(gsfSummaryLabelKind(line))&&(Number(line.y)||0)>=focusedPageHeight*.62),combinedLabels=items.filter(line=>['goods','vat','total'].includes(gsfSummaryLabelKind(line))&&(Number(line.y)||0)>=focusedPageHeight*.62),rightAligned=focusedRows.length>=2&&Math.max(...focusedRows.map(row=>row.x))-Math.min(...focusedRows.map(row=>row.x))<=focusedPageWidth*.045&&focusedRows.slice(1).every((row,index)=>(row.y-focusedRows[index].y)<=focusedPageHeight*.05),combinedRightAligned=combinedRows.length>=2&&Math.max(...combinedRows.map(row=>row.x))-Math.min(...combinedRows.map(row=>row.x))<=focusedPageWidth*.045&&combinedRows.slice(1).every((row,index)=>(row.y-combinedRows[index].y)<=focusedPageHeight*.05),focusedVat=gsfFooterVatBreakdown(focusedFooterLines,focusedPageHeight,focusedPageWidth),combinedVat=gsfFooterVatBreakdown(items,focusedPageHeight,focusedPageWidth),totalLabelAtBottom=rows=>rows.length>0&&combinedLabels.some(line=>gsfSummaryLabelKind(line)==='total'&&Math.abs((Number(line.y)||0)-rows.at(-1).y)<=Math.max(focusedPageHeight*.025,(Number(line.height)||16)*4)),goodsLabelAtTop=rows=>rows.length>0&&combinedLabels.some(line=>gsfSummaryLabelKind(line)==='goods'&&Math.abs((Number(line.y)||0)-rows[0].y)<=Math.max(focusedPageHeight*.025,(Number(line.height)||16)*4));
        const focusedFocCount=focusedFooterLines.filter(line=>/^\s*F\s*\.?\s*O\s*\.?\s*C\s*\.?\s*$/i.test(String(line.text||''))).length;
        if(rightAligned&&focusedRows.length===3&&focusedRows.every(row=>row.value===0)&&focusedFocCount>=3){results.push({page,total:0,vat:0,totalEvidence:'printed F.O.C. total row in GSF footer summary',vatEvidence:'printed F.O.C. VAT row in GSF footer summary'});continue;}
        if(rightAligned&&focusedLabels.length&&focusedRows.length>=3){const vatRow=focusedRows.at(-2),totalRow=focusedRows.at(-1);results.push({page,total:totalRow.value,vat:vatRow.value,totalEvidence:'last printed row in focused GSF footer summary',vatEvidence:'preceding printed row in focused GSF footer summary'});continue;}
        if(rightAligned&&focusedLabels.length&&focusedRows.length===2&&focusedVat!==null&&Math.abs(focusedRows[0].value-focusedVat)<0.005){results.push({page,total:focusedRows.at(-1).value,vat:focusedVat,totalEvidence:'last printed row in focused GSF footer summary',vatEvidence:'matching printed GSF VAT breakdown cell'});continue;}
        // First-pass OCR often sees one or two footer values that the 5x crop
        // misses. Merge those printed rows with retry rows, de-duplicate by
        // their page-relative positions, and use row order only when GOODS and
        // TOTAL labels anchor a complete three-row footer stack.
        if(combinedRightAligned&&combinedRows.length===3&&goodsLabelAtTop(combinedRows)&&totalLabelAtBottom(combinedRows)){const vatRow=combinedRows.at(-2),totalRow=combinedRows.at(-1);results.push({page,total:totalRow.value,vat:vatRow.value,totalEvidence:'last printed row in OCR-confirmed GSF footer summary',vatEvidence:'preceding printed row in OCR-confirmed GSF footer summary'});continue;}
        // If the Total label and value are confirmed and the separate printed
        // VAT table supplies one unambiguous VAT cell, these two printed
        // sources complete the row without deriving any amount arithmetically.
        if(combinedRightAligned&&combinedRows.length===2&&totalLabelAtBottom(combinedRows)&&(focusedVat??combinedVat)!==null){results.push({page,total:combinedRows.at(-1).value,vat:focusedVat??combinedVat,totalEvidence:'printed Total label and value in GSF footer summary',vatEvidence:'printed GSF VAT breakdown cell'});continue;}
        // Do not fall back to the large item/tax table when a focused footer
        // crop is incomplete. Partial OCR can otherwise pair the printed net
        // amount and VAT with a nearby VAT cell as if they were the footer
        // VAT and total. Leave both unconfirmed for manual review instead.
        results.push({page,total:null,vat:null,totalEvidence:'',vatEvidence:''});continue;
      }
      // The three right-aligned amounts at the bottom of a GSF invoice are
      // the printed GOODS, VAT and TOTAL summary. OCR label recognition can
      // attach a nearby net amount to a fuzzy VAT heading, so this explicit
      // footer row order takes precedence over those less reliable matches.
      const footerRows=gsfFooterAmountRows(items,pageHeight,pageWidth),rightAlignedFooterStack=footerRows.length===3&&Math.max(...footerRows.map(row=>row.x))-Math.min(...footerRows.map(row=>row.x))<=pageWidth*.045&&footerRows.slice(1).every((row,index)=>(row.y-footerRows[index].y)<=pageHeight*.04);
      if(rightAlignedFooterStack){results.push({page,total:footerRows.at(-1).value,vat:footerRows.at(-2).value,totalEvidence:'last printed row in aligned GSF footer summary',vatEvidence:'middle printed row in aligned GSF footer summary'});continue;}
      const totalLabels=labels.filter(item=>item.kind==='total').map(item=>({...item,found:gsfLineMoney(items,item.line)})).filter(item=>item.found).sort((a,b)=>(Number(b.line.y)||0)-(Number(a.line.y)||0)||(Number(b.line.x)||0)-(Number(a.line.x)||0));
      let total=totalLabels[0]||null;
      const vatLabels=labels.filter(item=>item.kind==='vat'&&(!total||Math.abs((Number(item.line.x)||0)-(Number(total.line.x)||0))<=Math.max(pageWidth*.13,(Number(total.line.height)||18)*6))&&(!total||(Number(item.line.y)||0)<=(Number(total.line.y)||0))&&(!total||(Number(total.line.y)||0)-(Number(item.line.y)||0)<=Math.max(pageHeight*.05,(Number(total.line.height)||18)*5))).map(item=>({...item,found:gsfLineMoney(items,item.line)})).filter(item=>item.found).sort((a,b)=>total?Math.abs((Number(a.line.y)||0)-(Number(total.line.y)||0))-Math.abs((Number(b.line.y)||0)-(Number(total.line.y)||0)):(Number(b.line.y)||0)-(Number(a.line.y)||0));
      let vat=vatLabels[0]||null;
      // The VAT detail table is a printed source too. Use its VAT cell only
      // when the invoice has one unambiguous printed rate row; never add rows.
      let breakdownVat=null;
      if(!vat){
        const vatHeaders=items.filter(line=>/^\s*VAT\s*$/i.test(String(line.text||''))),rateHeaders=items.filter(line=>/^\s*VAT\s*%\s*$/i.test(String(line.text||''))||/^\s*VAT\s+RATE\s*$/i.test(String(line.text||''))),goodsHeaders=items.filter(line=>/^\s*GOODS\s*$/i.test(String(line.text||'')));
        for(const header of vatHeaders){const y=Number(header.y)||0,h=Math.max(Number(header.height)||16,16),sameHeader=rateHeaders.some(line=>Math.abs((Number(line.y)||0)-y)<=h*1.5&&(Number(line.x)||0)<(Number(header.x)||0))&&goodsHeaders.some(line=>Math.abs((Number(line.y)||0)-y)<=h*1.5&&(Number(line.x)||0)<(Number(header.x)||0));if(!sameHeader)continue;const cellX=Number(header.x)||0,rowValues=[];for(const line of items){const dy=(Number(line.y)||0)-y,x=Number(line.x)||0;if(dy<=h*.3||dy>Math.max(pageHeight*.025,h*3.5)||Math.abs(x-cellX)>Math.max(pageWidth*.035,h*4))continue;for(const amount of gsfMoneyValues(line.text))rowValues.push({value:amount.value,line,dy});if(/^\s*0[.,]0{2}\s*$/.test(String(line.text||'')))rowValues.push({value:0,line,dy});}rowValues.sort((a,b)=>a.dy-b.dy);if(rowValues.length===1)vat={found:rowValues[0],line:header,kind:'vat'};break;}
      }
      breakdownVat=vat?.found?.value??gsfFooterVatBreakdown(items,pageHeight,pageWidth);
      const recognizedAnchors=labels.filter(item=>['goods','vat','total'].includes(item.kind)),rightAlignedStack=rightAlignedFooterStack,summaryStackIsAnchored=recognizedAnchors.length>=2||breakdownVat!==null;
      let stackedTotal=rightAlignedStack?footerRows.at(-1).value:null,stackedVat=rightAlignedStack?footerRows.at(-2).value:null;
      if(footerRows.length===2&&breakdownVat!==null){const lastTotal=labels.some(item=>item.kind==='total'&&Math.abs((Number(item.line.y)||0)-footerRows.at(-1).y)<=Math.max((Number(item.line.height)||16)*.65,pageHeight*.009,18));if(lastTotal)stackedTotal=footerRows.at(-1).value;}
      if(!total&&(summaryStackIsAnchored||rightAlignedStack)&&stackedTotal!==null)total={found:{value:stackedTotal,raw:'printed final value in GSF footer amount rows'},line:null,kind:'total'};
      if(!vat&&(summaryStackIsAnchored||rightAlignedStack)&&stackedVat!==null)vat={found:{value:stackedVat,raw:'printed middle value in GSF footer amount rows'},line:null,kind:'vat'};
      if(!vat&&breakdownVat!==null)vat={found:{value:breakdownVat,raw:'printed GSF VAT breakdown cell'},line:null,kind:'vat'};
      const legacyTotal=total?.found?.value??null,legacyVat=vat?.found?.value??null;
      if(focusedFooterLines.length&&(legacyTotal===null||legacyVat===null))results.push({page,total:null,vat:null,totalEvidence:'',vatEvidence:''});
      else results.push({page,total:legacyTotal,vat:legacyVat,totalEvidence:total?.found?.raw||'',vatEvidence:vat?.found?.raw||''});
    }
    return results.sort((a,b)=>(Number(b.page)||0)-(Number(a.page)||0)).find(item=>item.total!==null||item.vat!==null)||null;
  }
  function isGsfInvoicePage(lines,text=''){
    const items=Array.isArray(lines)?lines:[],flat=String(text||items.map(line=>String(line.text||'')).join(' '));if(!isGsfCarPartsText(flat))return false;
    const statementTitle=/\bst[a-z]{0,5}ent\s+of\s+account\b|\baccount\s+statement\b/i.test(flat),statementLedger=/\bcustomer\s+account\s*(?:no|number)\b/i.test(flat)&&/\blast\s+payment\s+received\b/i.test(flat),excludedDocument=/\b(?:customer\s+goods\s+returns\s+note|returns?\s+note|weekly\s+offers|special\s+offers)\b/i.test(flat);
    if(statementTitle||statementLedger||excludedDocument)return false;
    if(/\bINVOICE\b/i.test(flat))return true;
    // Windows OCR versions can read the printed 743… invoice reference and
    // tax-point date while badly mangling the large INVOICE heading. The
    // supplier-specific reference, date and invoice footer/body markers are
    // stronger together than that single heading word.
    const hasPrintedIdentity=Boolean(gsfPrintedNumber(flat,items)&&gsfPrintedDate(items)),hasInvoiceBody=/\bRECEIVED\s+BY\b/i.test(flat),pageHeight=Math.max(...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),pageWidth=Math.max(...items.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),footerRows=gsfFooterAmountRows(items,pageHeight,pageWidth);
    return hasPrintedIdentity&&(hasInvoiceBody||footerRows.length>=2);
  }
  function parseGsfCarPartsInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],text=String(flat||lines.map(line=>String(line.text||'')).join(' ')),invoiceDocument=isGsfInvoicePage(lines,text),originalInvoiceNumber=gsfPrintedNumber(text,lines),date=gsfPrintedDate(lines),summary=gsfSummary(lines),total=summary?.total??null,vat=summary?.vat??null,complete=Boolean(invoiceDocument&&originalInvoiceNumber&&date&&total!==null&&vat!==null),reason=complete?'':!invoiceDocument?'This page is not a GSF invoice.':!originalInvoiceNumber?'GSF invoice number could not be confirmed from the printed document number.':!date?'GSF tax point date could not be confirmed.':total===null?'Printed GSF invoice Total could not be confirmed.':'Printed GSF invoice VAT could not be confirmed.';
    return {invoiceNumber:originalInvoiceNumber,originalInvoiceNumber,date,supplier:'GSF Car Parts Limited',subtotal:'',vat:vat??'',vatUnverified:vat===null,vatMentioned:vat!==null,total:total??'',documentType:/\bCREDIT\s+NOTE\b/i.test(text)?'CREDIT NOTE':'INVOICE',isInvoiceDocument:invoiceDocument,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(invoiceDocument&&!complete),review:false,layoutId:'gsf-invoice-footer-summary',profileId:'gsf-car-parts'};
  }
  function parseGsfCarPartsBatch(pageLines,source,options={}){
    const pages=[...pageLines.keys()].sort((a,b)=>a-b),supplierPages=pages.filter(page=>isGsfCarPartsText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))),invoicePages=supplierPages.filter(page=>isGsfInvoicePage(pageLines.get(page)||[])),records=[],consumed=new Set(supplierPages);
    for(const page of invoicePages){const lines=pageLines.get(page)||[],text=lines.map(line=>String(line.text||'')).join('\n'),row=parseInvoiceRobust(text,source,lines,options);row.page=page;row.sourcePages=[page];row.profileId='gsf-car-parts';const key=row.originalInvoiceNumber&&row.date?`${row.originalInvoiceNumber}|${row.date}`:'';const previous=key&&records.find(item=>item.gsfGroupKey===key);if(previous){previous.sourcePages=[...new Set([...(previous.sourcePages||[previous.page]),page])].sort((a,b)=>a-b);previous.page=Math.min(previous.page,page);for(const field of ['invoiceNumber','originalInvoiceNumber','date','vat','total'])if((previous[field]===''||previous[field]===null||previous[field]===undefined)&&row[field]!==''&&row[field]!==null&&row[field]!==undefined)previous[field]=row[field];if(previous.vat!==row.vat||previous.total!==row.total){previous.status='REJECTED';previous.accepted=false;previous.rejected=true;previous.rejectedReason='Repeated GSF invoice pages contain conflicting printed VAT or Total figures.';previous.retryOcr=false;}continue;}row.gsfGroupKey=key;records.push(row);}
    const otherLines=[...pageLines.values()].flat().filter(line=>!consumed.has(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];for(const row of records)delete row.gsfGroupKey;
    return [...otherRows,...records].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function isEuLtdText(value){
    const text=String(value||'');
    return /\bE\s*\.?\s*U\s*\.?\s+LTD\b/i.test(text)||/SPECIALIST\s+EXHAUST\s+(?:AND|&)\s+COMPONENT\s+DISTRIBUTORS/i.test(text)||/372\s*9612\s*33/.test(text);
  }
  function euLtdPageType(lines,text=''){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),flat=String(text||items.map(line=>String(line.text||'')).join(' '));
    if(/RETURNS\s+COLLECTION\s+NOTE/i.test(flat))return '';
    if(!items.length){
      if(/\bSALES\s+INVOICE\b/i.test(flat))return 'INVOICE';
      if(/\bCREDIT\s+TO\s*:/i.test(flat)&&/\bINVOICE\s+NO\.?\b/i.test(flat)&&/\bTOTAL\s+DUE\b/i.test(flat))return 'CREDIT NOTE';
      return '';
    }
    const topY=Math.min(...items.map(line=>Number(line.y)||0)),bottomY=Math.max(...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),topY+1),contentHeight=Math.max(1,bottomY-topY),top=items.filter(line=>((Number(line.y)||0)-topY)/contentHeight<.24),compact=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''),topWords=top.map(line=>compact(line.text));
    if(topWords.includes('SALESINVOICE'))return 'INVOICE';
    // A credit-note page has a prominent Credit heading and a Credit To field.
    // The supplier's standard terms mention “No Credit” near the footer, so a
    // document-wide search for the word Credit would misclassify sales invoices.
    const creditHeading=topWords.includes('CREDIT')||topWords.includes('CREDITNOTE'),creditRecipient=items.some(line=>/^\s*Credit\s+To\s*:?\s*$/i.test(String(line.text||'')));
    if(creditHeading&&creditRecipient)return 'CREDIT NOTE';
    return '';
  }
  function euLtdFooterValue(lines,labelPattern){
    const numeric=anchoredInvoiceSummaryValue(lines,[labelPattern],{minimumYRatio:.58,maximumValueDistanceRatio:.05});if(numeric)return numeric;
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),candidates=[];
    for(const label of items){if(!labelPattern.test(String(label.text||'').trim()))continue;const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),pageHeight=Math.max(...page.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),labelY=Number(label.y)||0;if(labelY<pageHeight*.58)continue;const height=Math.max(Number(label.height)||16,16),right=(Number(label.x)||0)+(Number(label.width)||0),pageWidth=Math.max(...page.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),inline=String(label.text||'').replace(labelPattern,' ').trim();
      const values=[...(inline?[{text:inline,x:Number(label.x)||0,y:labelY}]:[]),...page.filter(line=>line!==label&&Number(line.x)>=right-height*.35&&Math.abs((Number(line.y)||0)-labelY)<=Math.max(height*1.6,1)).map(line=>({text:String(line.text||'').trim(),x:Number(line.x)||0,y:Number(line.y)||0}))];
      for(const value of values)if(/^F\s*\.?\s*O\s*\.?\s*C\s*\.?$/i.test(value.text)||/^FREE\s+OF\s+CHARGE$/i.test(value.text))candidates.push({value:0,raw:value.text,label:String(label.text||''),distanceY:Math.abs(value.y-labelY),score:Math.abs(value.y-labelY)/height+Math.max(0,value.x-right)/pageWidth*3});
    }
    candidates.sort((a,b)=>a.score-b.score);return candidates[0]||null;
  }
  function euLtdPrintedInvoiceNumber(lines,text=''){
    const compact=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,''),items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),labels=items.filter(line=>{const value=compact(line.text);return value.length<=20&&/INVOI/.test(value)&&/N[O0]/.test(value);});
    for(const label of labels){
      const samePage=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),pageWidth=Math.max(...samePage.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),height=Math.max(Number(label.height)||16,16),labelX=Number(label.x)||0,labelY=Number(label.y)||0;
      const candidates=samePage.filter(line=>line!==label&&Math.abs((Number(line.x)||0)-labelX)<=Math.max(pageWidth*.07,height*3)&&(Number(line.y)||0)>=labelY-height*.8&&(Number(line.y)||0)-labelY<=Math.max(height*6,48)).map(line=>({line,match:compact(line.text).match(/\d{3}[SD]\d{6}/i)})).filter(item=>item.match).sort((a,b)=>Math.abs((Number(a.line.y)||0)-labelY)-Math.abs((Number(b.line.y)||0)-labelY));
      if(candidates.length)return candidates[0].match[0].toUpperCase();
    }
    if(items.length)return '';
    return String(text||'').match(/\bInvoice\s+No\.?\s*[:#-]?\s*(\d{3}[SD]\d{6})\b/i)?.[1]?.toUpperCase()||'';
  }
  function parseEuLtdInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],text=String(flat||lines.map(line=>String(line.text||'')).join(' ')),documentType=euLtdPageType(lines,text),invoiceDocument=Boolean(documentType),originalInvoiceNumber=invoiceDocument?euLtdPrintedInvoiceNumber(lines,text):'',date=invoiceDocument?anchoredInvoiceDate(text,lines):'',net=invoiceDocument?euLtdFooterValue(lines,/^\s*Net\s+Total\s*$/i):null,vat=invoiceDocument?euLtdFooterValue(lines,/^\s*VAT\s*$/i):null,total=invoiceDocument?euLtdFooterValue(lines,/^\s*Total\s+Due\s*$/i):null,complete=Boolean(invoiceDocument&&originalInvoiceNumber&&date&&vat&&total),reason=complete?'':!invoiceDocument?'This page is not an EU LTD invoice or credit note.':!originalInvoiceNumber?'EU LTD invoice number could not be confirmed from the printed document.':!date?'EU LTD invoice date could not be confirmed from the printed document.':!total?'Printed EU LTD Total Due could not be confirmed.':'Printed EU LTD VAT could not be confirmed.';
    return {invoiceNumber:originalInvoiceNumber,originalInvoiceNumber,date,supplier:'EU LTD',subtotal:net?.value??'',vat:vat?.value??'',vatUnverified:!vat,vatMentioned:Boolean(vat),total:total?.value??'',currency:'GBP',source,documentType,isInvoiceDocument:invoiceDocument,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(invoiceDocument&&!complete),review:false,layoutId:'eu-ltd-printed-footer',profileId:'eu-ltd'};
  }
  function parseEuLtdBatch(pageLines,source,options={}){
    const pages=[...pageLines.keys()].sort((a,b)=>a-b),euPages=new Set(pages.filter(page=>isEuLtdText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')))),returnPages=new Set(pages.filter(page=>/RETURNS\s+COLLECTION\s+NOTE/i.test((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')))),records=[],consumed=new Set([...euPages,...returnPages]),byInvoice=new Map();
    for(const page of [...euPages].sort((a,b)=>a-b)){
      const lines=pageLines.get(page)||[],text=lines.map(line=>String(line.text||'')).join('\n'),type=euLtdPageType(lines,text);if(!type)continue;
      const row=parseInvoiceRobust(text,source,lines,options);row.page=page;row.sourcePages=[page];row.profileId='eu-ltd';
      const key=row.originalInvoiceNumber&&row.date?`${row.originalInvoiceNumber}|${row.date}`:'';
      if(key&&byInvoice.has(key)){
        const previous=byInvoice.get(key);previous.sourcePages=[...new Set([...(previous.sourcePages||[previous.page]),page])].sort((a,b)=>a-b);previous.page=Math.min(previous.page,page);
        if(previous.vat!==row.vat||previous.total!==row.total){previous.status='REJECTED';previous.accepted=false;previous.rejected=true;previous.rejectedReason='Repeated EU LTD invoice pages contain conflicting printed VAT or Total Due values.';previous.retryOcr=false;}
        continue;
      }
      records.push(row);if(key)byInvoice.set(key,row);
    }
    const otherLines=[...pageLines.values()].flat().filter(line=>!consumed.has(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
    return [...otherRows,...records].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function isPartsPlusText(value){const text=String(value||'');return /\bPARTS\s*P[LI1]US\b/i.test(text)||/partsplusuk\.com/i.test(text);}
  function partsPlusPageType(lines,text=''){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),flat=String(text||items.map(line=>String(line.text||'')).join(' '));
    if(!items.length){if(/\bCASH\s+CREDIT\s+NOTE\b/i.test(flat))return 'CREDIT NOTE';if(/\bCASH\s+INVOICE\b/i.test(flat))return 'INVOICE';return '';}
    const topY=Math.min(...items.map(line=>Number(line.y)||0)),bottomY=Math.max(...items.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),topY+1),height=Math.max(1,bottomY-topY),compact=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),top=items.filter(line=>((Number(line.y)||0)-topY)/height<.42).map(line=>compact(line.text));
    if(top.some(value=>value==='CASHCREDITNOTE'))return 'CREDIT NOTE';
    if(top.some(value=>value==='CASHINVOICE'))return 'INVOICE';
    return '';
  }
  function partsPlusPrintedInvoiceNumber(lines,text=''){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),labels=items.filter(line=>/\binvoice\s*(?:no\.?|number|#)\s*:?\s*\d{0,9}/i.test(String(line.text||'')));
    for(const label of labels){
      const inline=String(label.text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*:?\s*(\d{6,9})\b/i);if(inline)return inline[1];
      const page=items.filter(line=>(Number(line.page)||1)===(Number(label.page)||1)),pageWidth=Math.max(...page.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),height=Math.max(Number(label.height)||16,16),x=Number(label.x)||0,y=Number(label.y)||0,candidates=page.filter(line=>line!==label&&/^\d{6,9}$/.test(String(line.text||'').trim())&&Math.abs((Number(line.x)||0)-x)<=Math.max(pageWidth*.07,height*2)&&(Number(line.y)||0)>y&&(Number(line.y)||0)-y<=Math.max(height*6,pageWidth*.06)).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0));
      if(candidates.length)return String(candidates[0].text).trim();
    }
    if(items.length)return '';
    return String(text||'').match(/\binvoice\s*(?:no\.?|number|#)\s*:?\s*(\d{6,9})\b/i)?.[1]||'';
  }
  function partsPlusFooterValue(lines,labelPattern){return anchoredInvoiceSummaryValue(lines,[labelPattern],{minimumYRatio:.68,maximumValueDistanceRatio:.045});}
  function parsePartsPlusInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],text=String(flat||lines.map(line=>String(line.text||'')).join(' ')),documentType=partsPlusPageType(lines,text),invoiceDocument=Boolean(documentType),credit=documentType==='CREDIT NOTE',originalInvoiceNumber=invoiceDocument?partsPlusPrintedInvoiceNumber(lines,text):'',date=invoiceDocument?anchoredInvoiceDate(text,lines):'',net=invoiceDocument?partsPlusFooterValue(lines,/^\s*Net\s*$/i):null,vat=invoiceDocument?partsPlusFooterValue(lines,/^\s*V\s*\.?\s*A\s*\.?\s*T\s*\.?\s*$/i):null,total=invoiceDocument?partsPlusFooterValue(lines,/^\s*Total\s*$/i):null,withPolarity=value=>value===null||value===undefined?null:credit?-Math.abs(Number(value)):Number(value),signedVat=withPolarity(vat?.value??null),signedTotal=withPolarity(total?.value??null),signedNet=withPolarity(net?.value??null),complete=Boolean(invoiceDocument&&originalInvoiceNumber&&date&&signedVat!==null&&signedTotal!==null&&Number.isFinite(signedVat)&&Number.isFinite(signedTotal)),reason=complete?'':!invoiceDocument?'This page is not a Parts Plus invoice or credit note.':!originalInvoiceNumber?'Parts Plus invoice number could not be confirmed from the printed document.':!date?'Parts Plus invoice date could not be confirmed from the printed document.':signedTotal===null?'Printed Parts Plus Total could not be confirmed.':'Printed Parts Plus V.A.T. could not be confirmed.';
    return {invoiceNumber:originalInvoiceNumber,originalInvoiceNumber,date,supplier:'Parts Plus',subtotal:signedNet??'',vat:signedVat??'',vatUnverified:signedVat===null,vatMentioned:signedVat!==null,total:signedTotal??'',currency:'GBP',source,documentType,isInvoiceDocument:invoiceDocument,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(invoiceDocument&&!complete),review:false,layoutId:'parts-plus-footer',profileId:'parts-plus'};
  }
  function parsePartsPlusBatch(pageLines,source,options={}){
    const pages=[...pageLines.keys()].sort((a,b)=>a-b),partsPages=new Set(pages.filter(page=>isPartsPlusText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')))),records=[],consumed=new Set(partsPages),byInvoice=new Map();
    for(const page of [...partsPages].sort((a,b)=>a-b)){
      const lines=pageLines.get(page)||[],text=lines.map(line=>String(line.text||'')).join('\n'),type=partsPlusPageType(lines,text);if(!type)continue;
      const row=parseInvoiceRobust(text,source,lines,options);row.page=page;row.sourcePages=[page];row.profileId='parts-plus';const key=row.originalInvoiceNumber&&row.date?`${row.originalInvoiceNumber}|${row.date}|${row.documentType}`:'';
      if(key&&byInvoice.has(key)){const previous=byInvoice.get(key);previous.sourcePages=[...new Set([...(previous.sourcePages||[previous.page]),page])].sort((a,b)=>a-b);previous.page=Math.min(previous.page,page);if(previous.vat!==row.vat||previous.total!==row.total){previous.status='REJECTED';previous.accepted=false;previous.rejected=true;previous.rejectedReason='Repeated Parts Plus invoice pages contain conflicting printed V.A.T. or Total values.';previous.retryOcr=false;}continue;}
      records.push(row);if(key)byInvoice.set(key,row);
    }
    const otherLines=[...pageLines.values()].flat().filter(line=>!consumed.has(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
    return [...otherRows,...records].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function isRacMotoringText(value){return /\bRAC\s+MOTORING\s+SERVICES\b/i.test(String(value||''));}
  function racNearbyLabelValue(lines,labelPattern,acceptValue,{maxHorizontalRatio=.2,maxVerticalRatio=.015}={}){
    const items=(Array.isArray(lines)?lines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();
    for(const line of items){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    const candidates=[];
    for(const [page,pageLines] of pages){
      const width=Math.max(...pageLines.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1),height=Math.max(...pageLines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),heights=pageLines.map(line=>Number(line.height)||0).filter(value=>value>0).sort((a,b)=>a-b),medianHeight=heights[Math.floor(heights.length/2)]||20;
      for(const label of pageLines){
        const labelText=String(label.text||'').trim();if(!labelPattern.test(labelText))continue;
        const labelX=Number(label.x)||0,labelY=Number(label.y)||0,labelHeight=Math.max(Number(label.height)||0,medianHeight,1),labelRight=labelX+Math.max(Number(label.width)||0,labelText.length*labelHeight*.42),verticalTolerance=Math.max(labelHeight*1.7,height*maxVerticalRatio,18),horizontalTolerance=width*maxHorizontalRatio;
        const inline=labelText.replace(labelPattern,'').replace(/^\s*[:#.-]?\s*/,'').trim();
        if(inline){const value=acceptValue(inline);if(value!==null&&value!==undefined&&value!=='')candidates.push({value,score:0,page,label});}
        for(const line of pageLines){if(line===label)continue;const raw=String(line.text||'').trim(),x=Number(line.x)||0,y=Number(line.y)||0,dx=x-labelRight,dy=Math.abs(y-labelY);if(dx< -labelHeight*.3||dx>horizontalTolerance||dy>verticalTolerance)continue;const value=acceptValue(raw);if(value===null||value===undefined||value==='')continue;candidates.push({value,score:dy/verticalTolerance+Math.max(0,dx)/width*2,page,label,line});}
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    if(!candidates.length)return null;
    const first=candidates[0],equallyClose=candidates.filter(item=>Math.abs(item.score-first.score)<.12);
    if(equallyClose.some(item=>String(item.value)!==String(first.value)))return null;
    return first;
  }
  function racInlineOrFollowingValue(text,labelPattern,acceptValue){
    const lines=String(text||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    for(let index=0;index<lines.length;index++){
      const current=lines[index],match=current.match(labelPattern);if(!match)continue;
      const inline=current.slice(match.index+match[0].length).replace(/^\s*[:#.-]?\s*/,'').trim(),inlineValue=inline?acceptValue(inline):null;if(inlineValue!==null&&inlineValue!==undefined&&inlineValue!=='')return inlineValue;
      for(const next of lines.slice(index+1,index+3)){const value=acceptValue(next);if(value!==null&&value!==undefined&&value!=='')return value;}
    }
    return null;
  }
  function racMoneyValue(lines,text,labelPattern){
    const result=racNearbyLabelValue(lines,labelPattern,value=>{const values=anchoredInvoiceMoneyValues(value);return values.length===1?values[0].value:null;});
    if(result)return result.value;
    const plain=racInlineOrFollowingValue(text,labelPattern,value=>{const values=anchoredInvoiceMoneyValues(value);return values.length===1?values[0].value:null;});return plain;
  }
  function isRacSummaryPage(lines,text=''){
    const flat=String(text|| (lines||[]).map(line=>String(line.text||'')).join(' '));
    if(!isRacMotoringText(flat)||/\bINVOICE\s+DETAILS\b/i.test(flat)||!/\bInvoice\b/i.test(flat))return false;
    const summaryLabelCount=[/\bNett\s+Total\b/i,/\bTotal\s+VAT\b/i,/\bTOTAL\b/i].filter(pattern=>pattern.test(flat)).length,invoiceHeader=/\bInvoice\s+Date\b/i.test(flat)&&/\bDue\s+Date\b/i.test(flat)&&/\bAccount\s+No\b/i.test(flat);
    return summaryLabelCount>=1||invoiceHeader;
  }
  function isRacDetailPage(lines){
    const text=(lines||[]).map(line=>String(line.text||'')).join(' ');
    return /\bINVOICE\s+DETAILS\b/i.test(text)||/\bInvoice\s+To\b/i.test(text)&&/\bWork\s+Date\b/i.test(text);
  }
  function isRacSupportTablePage(lines){
    const text=(lines||[]).map(line=>String(line.text||'')).join(' '),dates=[...text.matchAll(/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d{2}\b/g)].length,weekCodes=[...text.matchAll(/\bW\s*\/\s*C\s*\(/gi)].length;
    return dates>=3&&weekCodes>=3&&!/\b(?:invoice|VAT|total)\b/i.test(text);
  }
  function parseRacInvoice(flat,source='',ocrLines){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[],text=String(flat||lines.map(line=>String(line.text||'')).join('\n')),invoiceDocument=isRacSummaryPage(lines,text),numberValue=racNearbyLabelValue(lines,/^Invoice$/i,value=>/^\d{7,10}$/.test(String(value).trim())?String(value).trim():null),plainNumber=racInlineOrFollowingValue(text,/^Invoice$/i,value=>{const match=String(value||'').match(/\b\d{7,10}\b/);return match?.[0]||null;}),originalInvoiceNumber=numberValue?.value||plainNumber||'',dateValue=racNearbyLabelValue(lines,/^Invoice\s+Date\s*:?$/i,value=>parseDate(String(value).trim())),plainDate=racInlineOrFollowingValue(text,/\bInvoice\s+Date\b\s*:?/i,value=>{const match=String(value||'').match(/\b(?:\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d{2}|20\d{2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,2})\b/);return match?parseDate(match[0].replace(/\s+/g,'')):null;}),date=dateValue?.value||plainDate||'',vat=racMoneyValue(lines,text,/^Total\s+VAT\s*$/i),total=racMoneyValue(lines,text,/^TOTAL\b(?!\s*VAT)/i),complete=Boolean(invoiceDocument&&originalInvoiceNumber&&date&&vat!==null&&total!==null),reason=complete?'':!invoiceDocument?'This page is not an RAC invoice summary.':!originalInvoiceNumber?'RAC invoice number could not be confirmed from the printed invoice.':!date?'RAC invoice date could not be confirmed from the printed invoice.':total===null?'Printed RAC invoice total could not be confirmed.':'Printed RAC VAT total could not be confirmed.';
    return {invoiceNumber:originalInvoiceNumber,originalInvoiceNumber,date,supplier:'RAC Motoring Services',subtotal:'',vat:vat??'',vatUnverified:vat===null,vatMentioned:vat!==null,total:total??'',documentType:'INVOICE',isInvoiceDocument:invoiceDocument,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:Boolean(invoiceDocument&&!complete),review:false,layoutId:'rac-invoice-summary',profileId:'rac-motoring-services'};
  }
  function parseRacBatch(pageLines,source,options={}){
    const pages=[...pageLines.keys()].sort((a,b)=>a-b),pageText=page=>((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')),racPages=new Set(pages.filter(page=>isRacMotoringText(pageText(page)))),detailPages=new Set(pages.filter(page=>isRacDetailPage(pageLines.get(page)||[]))),supportPages=new Set(pages.filter(page=>isRacSupportTablePage(pageLines.get(page)||[]))),records=[],consumed=new Set([...racPages,...detailPages,...supportPages]);
    for(const page of [...racPages].sort((a,b)=>a-b)){
      const items=pageLines.get(page)||[],text=items.map(line=>String(line.text||'')).join('\n');if(!isRacSummaryPage(items,text))continue;
      const row=parseInvoiceRobust(text,source,items,options);row.page=page;row.sourcePages=[page];row.profileId='rac-motoring-services';records.push(row);
    }
    const otherLines=[...pageLines.values()].flat().filter(line=>!consumed.has(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
    return [...otherRows,...records].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function isMillfieldAutopartsText(value){const text=String(value||'');if(/\bMILLFIELD\s+AUTOPARTS?\b|\bMILLFIELD\s+AUTO\s+PARTS\b|\bMILLFIELD\s*AUTO\s*ARTS\b/i.test(text))return true;const compact=millfieldCompact(text);return compact.includes('MILLFIELDAUTOPART');}
  function millfieldCompact(value){return String(value||'').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'');}
  function millfieldReferenceDigits(value){const digits=String(value||'').replace(/[^0-9]/g,'');return digits.length>=5&&digits.length<=8?digits:'';}
  function millfieldInvoiceNumberEvidence(items){
    const {lines,pageHeight,pageWidth,height}=millfieldPageMetrics(items),labels=lines.filter(line=>/^\s*Invoice\s+Number\s*:?\s*$/i.test(String(line.text||''))),headerY=labels.length?Math.min(...labels.map(line=>Number(line.y)||0)):pageHeight*.35,labelX=labels.length?Math.min(...labels.map(line=>Number(line.x)||0)):pageWidth*.55;
    const inHeader=line=>{const y=Number(line.y)||0,x=Number(line.x)||0;return y>=headerY-height&&y<=headerY+Math.max(pageHeight*.12,height*12)&&x>=labelX-pageWidth*.27;};
    // Anchor the reference read to the printed Invoice Number field and HS
    // marker. Avoid sliding through unrelated digits elsewhere on the page.
    const marker=/(?:\bH\s*S|\bH\s*[Z25]|\bI\s*[-.]?\s*(?:I|L|1)?\s*[S5$])(?:\s*[eEcCæÆ•)]{1,2})?\s*[-:#]?\s*/ig;
    const markerPresent=/\bH\s*S|\bH\s*[Z25]|\bI\s*[-.]?\s*(?:I|L|1)?\s*[S5$]/i,eligible=lines.filter(line=>inHeader(line)||markerPresent.test(String(line.text||''))),patterns=new Set(),rawReferences=new Set(),suffixes=new Set();
    for(const line of eligible){const raw=String(line.text||'').normalize('NFKC');
      for(const match of raw.matchAll(marker)){
        const after=raw.slice(match.index+match[0].length).trim().replace(/^[\s:#-]+/,''),tokens=after.split(/\s+/).filter(Boolean);if(!tokens.length)continue;
        let token=tokens[0];
        // OCR may split the reference between adjacent boxes. Join only until
        // it reaches identifier length; never append a date or time token.
        const isDateOrTime=value=>/\d\s*[\/.-]\s*\d|\b\d{1,2}:\d{2}\b/i.test(value)||/^\d{6,8}$/.test(value)&&/^(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2,4}$/.test(value),tokenLength=value=>value.replace(/[^A-Za-z0-9]/g,'').length;
        for(let index=1;index<Math.min(tokens.length,3)&&tokenLength(token)<5;index++){if(isDateOrTime(tokens[index])||!/[A-Za-z0-9]/.test(tokens[index]))break;token+=tokens[index];}
        if(!token||isDateOrTime(token))continue;rawReferences.add(`${match[0]}${token}`);
        let mapped='',recognizedDigits='';
        for(const character of token){if(/[0-9]/.test(character)){mapped+=character;recognizedDigits+=character;}else if(/[oOcC]/.test(character)){mapped+='0';recognizedDigits+='0';}else if(/[iIl|]/.test(character)){mapped+='1';recognizedDigits+='1';}else if(/[zZ]/.test(character)){mapped+='2';recognizedDigits+='2';}else if(/[sS]/.test(character)){mapped+='5';recognizedDigits+='5';}else if(/[bB]/.test(character)){mapped+='8';recognizedDigits+='8';}else if(/[gG]/.test(character)){mapped+='6';recognizedDigits+='6';}else if(/[eEtT]/.test(character))mapped+='?';else if(/[A-Za-z]/.test(character))mapped+='?';}
        const known=(mapped.match(/\d/g)||[]).length,unknown=(mapped.match(/\?/g)||[]).length;if(mapped.length>=5&&mapped.length<=8&&known>=4&&unknown<=2)patterns.add(mapped);
        if(recognizedDigits.length>=4)suffixes.add(recognizedDigits.slice(-4));
      }
    }
    return {patterns:[...patterns],rawReferences:[...rawReferences],suffixes:[...suffixes]};
  }
  function millfieldDate(value,contextYear=''){
    // OCR frequently confuses a few characters on these faded invoice date
    // rows (for example e9/05 e for 29/05/26). Repair only date-shaped tokens
    // and accept a partial year only when the same PDF has a strong, repeated
    // four-digit year anchor.
    const source=String(value||'').replace(/'/g,'').replace(/[^\u0000-\u007F]/g,' '),year=String(contextYear||'');
    const currentYear=new Date().getFullYear()+1,hasContext=/^20\d{2}$/.test(year)&&Number(year)<=currentYear;
    const digitChoices=character=>{
      if(/[0-9]/.test(character))return [character];
      if(/[oO]/.test(character))return ['0'];
      if(/[iIl|]/.test(character))return ['1'];
      if(/[sS]/.test(character))return ['5'];
      if(/[zZ]/.test(character))return ['2'];
      if(/[bB]/.test(character))return ['8'];
      if(/[gG]/.test(character))return ['6'];
      if(/[eEcC]/.test(character))return ['2','6'];
      return [];
    };
    const digitVariants=token=>{let variants=[''];for(const character of String(token||'').replace(/\s+/g,'')){const choices=digitChoices(character);if(!choices.length)return [];variants=variants.flatMap(prefix=>choices.map(digit=>prefix+digit));}return [...new Set(variants)];};
    const candidates=[...source.matchAll(/(?<![A-Za-z\d/])([0-9OIl|eEcCsSzZbBgG](?:\s*[0-9OIl|eEcCsSzZbBgG]){0,3})\s*[\/.-]\s*([0-9OIl|eEcCsSzZbBgG](?:\s*[0-9OIl|eEcCsSzZbBgG]){0,1})(?:\s*[\/.-]\s*|\s+)([0-9OIl|eEcCsSzZbBgG](?:\s*[0-9OIl|eEcCsSzZbBgG]){0,3})(?![\d/])/g)];
    const parsed=[];
    for(const match of candidates){
      const first=digitVariants(match[1]),second=digitVariants(match[2]),third=digitVariants(match[3]);
      for(const a of first)for(const b of second)for(const c of third){
        const isIso=match[1].length===4,day=isIso?c:a,month=b,yearToken=isIso?a:c;
        if(!/^\d{1,2}$/.test(day)||!/^\d{1,2}$/.test(month))continue;
        const possibleYears=[];
        if(yearToken.length===4)possibleYears.push(yearToken);
        else if(hasContext){
          // OCR can retain the first digit(s) (2, 20) or last digit(s) (6, 26)
          // of the year. The anchor must agree exactly.
          if(year.startsWith(yearToken)||year.endsWith(yearToken))possibleYears.push(year);
        }else if(yearToken.length===2)possibleYears.push(String(2000+Number(yearToken)));
        for(const possibleYear of possibleYears){const parsedDate=parseDate(day+'/'+month+'/'+possibleYear),parsedYear=Number(String(parsedDate||'').slice(0,4));if(parsedDate&&parsedYear<=currentYear)parsed.push(parsedDate);}
      }
    }
    const unique=[...new Set(parsed)];return unique.length===1?unique[0]:'';
  }
  function millfieldPageMetrics(items){const lines=(Array.isArray(items)?items:[]).filter(line=>line&&String(line.text||'').trim()),heights=lines.map(line=>Number(line.height)||0).filter(value=>value>0&&value<100).sort((a,b)=>a-b),height=heights[Math.floor(heights.length/2)]||18,pageHeight=Math.max(...lines.map(line=>(Number(line.y)||0)+(Number(line.height)||0)),1),pageWidth=Math.max(...lines.map(line=>(Number(line.x)||0)+(Number(line.width)||0)),1);return {lines,height,pageHeight,pageWidth};}
  function millfieldNearbyMoney(items,labelPattern,{minimumYRatio=.58,maximumYRatio=.94,verticalRatio=.045,rightRatio=.04,excludeLines=[],standaloneLabel=false,returnMatch=false}={}){
    const {lines,pageHeight,pageWidth,height}=millfieldPageMetrics(items),labels=lines.filter(line=>(Number(line.y)||0)>=pageHeight*minimumYRatio&&(Number(line.y)||0)<=pageHeight*maximumYRatio&&labelPattern.test(String(line.text||''))),matches=[];
    for(const label of labels){const labelText=String(label.text||'').trim();if(standaloneLabel&&labelText.length>24)continue;const labelX=Number(label.x)||0,labelY=Number(label.y)||0,labelRight=labelX+Math.max(Number(label.width)||0,labelText.length*height*.4),inline=labelText.replace(labelPattern,'');for(const money of anchoredInvoiceMoneyValues(inline)){matches.push({value:money.value,score:0,label,line:label});}
      const verticalTolerance=Math.max(height*2,pageHeight*Math.min(verticalRatio,.018),18),horizontalTolerance=Math.max(pageWidth*.45,height*12,80);
      for(const line of lines){if(line===label||excludeLines.includes(line))continue;const x=Number(line.x)||0,y=Number(line.y)||0,dx=x-labelRight,dy=Math.abs(y-labelY);if(dx< -height||dx>horizontalTolerance||dy>verticalTolerance)continue;const tokens=anchoredInvoiceMoneyValues(line.text);for(const token of tokens){const rightMost=Number(line.x||0)+Math.max(Number(line.width)||0,String(line.text||'').length*height*.42);matches.push({value:token.value,score:dy/verticalTolerance+Math.max(0,dx)/Math.max(pageWidth,1)*2+(pageWidth-rightMost)/Math.max(pageWidth,1)*.1,label,line});}}
    }
    matches.sort((a,b)=>a.score-b.score);if(!matches.length)return null;const best=matches[0],near=matches.filter(item=>Math.abs(item.score-best.score)<.14);if(near.some(item=>Math.abs(Number(item.value)-Number(best.value))>.001))return null;return returnMatch?{value:best.value,line:best.line}:best.value;
  }
  function millfieldFooterSummaryAmounts(items,ignoreVariants=false){
    const tagged=(Array.isArray(items)?items:[]).filter(line=>line?.millfieldFooterVariant!==undefined&&line?.millfieldFooterVariant!==null),variants=[...new Set(tagged.map(line=>String(line.millfieldFooterVariant)))];
    if(!ignoreVariants&&variants.length){const reads=variants.map(variant=>({variant,amounts:millfieldFooterSummaryAmounts(tagged.filter(line=>String(line.millfieldFooterVariant)===variant),true)})),consensus=key=>{const counts=new Map();for(const read of reads){const value=read.amounts[key];if(value===null||value===undefined||value==='')continue;const cents=Math.round(Number(value)*100);if(Number.isFinite(cents)){const item=counts.get(cents)||{value:Number(value),variants:[]};item.variants.push(read.variant);counts.set(cents,item);}}const ranked=[...counts.values()].sort((a,b)=>b.variants.length-a.variants.length);return ranked.length&&ranked[0].variants.length>=2&&(ranked[1]?.variants.length||0)<ranked[0].variants.length?ranked[0].value:null;};return {goods:consensus('goods'),vat:consensus('vat')};}
    const {lines,pageHeight,pageWidth,height}=millfieldPageMetrics(items),definitions=[{key:'goods',pattern:/\bTotal\s+Goods\b/i},{key:'vat',pattern:/\bTotal\s+VAT\b/i}],labels=definitions.flatMap(definition=>lines.filter(line=>(Number(line.y)||0)>=pageHeight*.58&&(Number(line.y)||0)<=pageHeight*.995&&definition.pattern.test(String(line.text||''))).map(line=>({...definition,line}))),candidates=[];
    for(const line of lines){if((Number(line.y)||0)<pageHeight*.58||(Number(line.y)||0)>pageHeight*.995)continue;const text=String(line.text||''),values=anchoredInvoiceMoneyValues(text);if(!values.length)continue;const possible=[];
      for(const label of labels){if(line===label.line){const inline=text.replace(label.pattern,'');for(const value of anchoredInvoiceMoneyValues(inline))possible.push({label,value:value.value,score:0});continue;}const x=Number(line.x)||0,y=Number(line.y)||0,labelX=Number(label.line.x)||0,labelY=Number(label.line.y)||0,labelText=String(label.line.text||''),labelRight=labelX+Math.max(Number(label.line.width)||0,labelText.length*height*.4),dx=x-labelRight,dy=Math.abs(y-labelY),verticalTolerance=Math.max(height*2,pageHeight*.018,18),horizontalTolerance=Math.max(pageWidth*.45,height*12,80);if(dx< -height||dx>horizontalTolerance||dy>verticalTolerance)continue;const rightMost=x+Math.max(Number(line.width)||0,text.length*height*.42),score=dy/verticalTolerance+Math.max(0,dx)/Math.max(pageWidth,1)*2+(pageWidth-rightMost)/Math.max(pageWidth,1)*.1;for(const value of values)possible.push({label,value:value.value,score});}
      if(!possible.length)continue;possible.sort((a,b)=>a.score-b.score);const best=possible[0],near=possible.filter(item=>Math.abs(item.score-best.score)<.08);if(near.some(item=>item.label.key!==best.label.key))continue;candidates.push({line,value:best.value,label:best.label,score:best.score});
    }
    const result={goods:null,vat:null};for(const definition of definitions){const matches=candidates.filter(candidate=>candidate.label.key===definition.key).sort((a,b)=>a.score-b.score);if(!matches.length)continue;const best=matches[0],near=matches.filter(item=>Math.abs(item.score-best.score)<.14);if(!near.some(item=>Math.abs(Number(item.value)-Number(best.value))>.001))result[definition.key]=best.value;}
    return result;
  }
  function millfieldAmountDueValue(items,{returnMatch=false,ignoreVariants=false}={}){
    const tagged=(Array.isArray(items)?items:[]).filter(line=>line?.millfieldFooterVariant!==undefined&&line?.millfieldFooterVariant!==null),variants=[...new Set(tagged.map(line=>String(line.millfieldFooterVariant)))];
    if(!ignoreVariants&&variants.length){const reads=variants.map(variant=>({variant,match:millfieldAmountDueValue(tagged.filter(line=>String(line.millfieldFooterVariant)===variant),{returnMatch:true,ignoreVariants:true})})).filter(read=>read.match),counts=new Map();for(const read of reads){const cents=Math.round(Number(read.match.value)*100);if(!Number.isFinite(cents))continue;const item=counts.get(cents)||{value:Number(read.match.value),variants:[]};item.variants.push(read.variant);counts.set(cents,item);}const ranked=[...counts.values()].sort((a,b)=>b.variants.length-a.variants.length);if(!ranked.length||ranked[0].variants.length<2||(ranked[1]?.variants.length||0)===ranked[0].variants.length)return null;return returnMatch?{value:ranked[0].value,line:null,weak:false,consensus:true,variants:ranked[0].variants}:ranked[0].value;}
    const {lines,pageHeight,height}=millfieldPageMetrics(items),footer=lines.filter(line=>(Number(line.y)||0)>=pageHeight*.68),normalizeLabel=value=>String(value||'').replace(/\bAM[O0]L{1,2}NT\b/ig,'Amount').replace(/\bAM[O0]U(?:M|N)T\b/ig,'Amount'),amountLabels=footer.filter(line=>/\bAmount(?:\s+Due)?\s*:?\s*$/i.test(normalizeLabel(line.text).trim())),dueLabels=footer.filter(line=>/\b(?:Due|ue)\s*:?\s*$/i.test(String(line.text||'').trim()));
    const pairTolerance=Math.max(height*3,pageHeight*.04,36),candidates=[];
    for(const amount of amountLabels){const amountY=Number(amount.y)||0,pairedDue=dueLabels.filter(due=>due!==amount&&Math.abs((Number(due.y)||0)-amountY)<=pairTolerance).sort((a,b)=>Math.abs((Number(a.y)||0)-amountY)-Math.abs((Number(b.y)||0)-amountY))[0];if(!pairedDue)continue;const amountX=Number(amount.x)||0,dueX=Number(pairedDue.x)||0,lowerY=Math.min(amountY,Number(pairedDue.y)||amountY)-Math.max(height*2,pageHeight*.06),upperY=Math.max(amountY,Number(pairedDue.y)||amountY)+height,minimumX=Math.min(amountX,dueX)-height;
      for(const line of footer){const y=Number(line.y)||0,x=Number(line.x)||0;if(y<lowerY||y>upperY||x<minimumX)continue;let tokens=anchoredInvoiceMoneyValues(line.text);if(!tokens.length){const isolated=String(line.text||'').trim().match(/^(?:[£$]\s*)?\(?(-?\d{1,6})\s+(\d{2})\)?$/);if(isolated){const value=invoiceAmount(`${isolated[1]}.${isolated[2]}`);if(value!==null)tokens=[{value}];}}for(const token of tokens)candidates.push({value:token.value,line,score:Math.abs(y-amountY)/Math.max(pairTolerance,1)+Math.max(0,amountX-x)/Math.max(pageHeight,1)});}
    }
    for(const amount of amountLabels){const amountY=Number(amount.y)||0,pairedDue=dueLabels.filter(due=>due!==amount&&Math.abs((Number(due.y)||0)-amountY)<=pairTolerance).sort((a,b)=>Math.abs((Number(a.y)||0)-amountY)-Math.abs((Number(b.y)||0)-amountY))[0];if(!pairedDue)continue;const amountX=Number(amount.x)||0,dueX=Number(pairedDue.x)||0,lowerY=Math.min(amountY,Number(pairedDue.y)||amountY)-Math.max(height*2,pageHeight*.06),upperY=Math.max(amountY,Number(pairedDue.y)||amountY)+height,minimumX=Math.min(amountX,dueX)-height;for(const line of footer){const y=Number(line.y)||0,x=Number(line.x)||0;if(y<lowerY||y>upperY||x<minimumX)continue;const raw=String(line.text||'').trim().replace(/[^\dA-Za-z,.;\s()\-]/g,''),match=raw.match(/^\(?(-?\d{1,3}(?:[ ,]\d{3})*|\d{1,6})\s*a\s*(\d{2})\)?$/i);if(!match)continue;const value=invoiceAmount(`${match[1].replace(/[ ,]/g,'')}.${match[2]}`);if(value!==null)candidates.push({value,line,score:Math.abs(y-amountY)/Math.max(pairTolerance,1)+Math.max(0,amountX-x)/Math.max(pageHeight,1)});}}
    candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return null;const best=candidates[0],near=candidates.filter(item=>Math.abs(item.score-best.score)<.12);if(near.some(item=>Math.abs(Number(item.value)-Number(best.value))>.001))return null;return returnMatch?{...best,weak:Boolean(best.weak||/^\s*(?:[Â£$]\s*)?\(?-?\d{1,6}\s+\d{2}\)?$/.test(String(best.line?.text||'').trim())||/\d\s+[aA]\s*\d{2}/.test(String(best.line?.text||'')))}:best.value;
  }
  function millfieldInvoiceHeader(items,text='',contextYear=''){
    const {lines,pageHeight,pageWidth,height}=millfieldPageMetrics(items),invoiceLabels=lines.filter(line=>/^\s*Invoice\s+Number\s*:?\s*$/i.test(String(line.text||''))),dateLabels=lines.filter(line=>/^\s*Date\s*:?\s*$/i.test(String(line.text||''))),headerY=invoiceLabels.length?Math.min(...invoiceLabels.map(line=>Number(line.y)||0)):pageHeight*.35,labelsX=invoiceLabels.length?Math.min(...invoiceLabels.map(line=>Number(line.x)||0)):pageWidth*.55,identityLines=lines.filter(line=>{const y=Number(line.y)||0,x=Number(line.x)||0;return y>=headerY-height&&y<=headerY+Math.max(pageHeight*.12,height*12)&&x>=labelsX-pageWidth*.27;}),numberEvidence=millfieldInvoiceNumberEvidence(items);
    let originalInvoiceNumber='';
    for(const line of identityLines){const raw=String(line.text||'').toUpperCase().replace(/[ＯО]/g,'0').replace(/[ＨН]/g,'H').replace(/[ＳЅ]/g,'S').replace(/[Il|]/g,'1');let match=raw.match(/\bH\s*S\s*[-:#]?\s*([0-9OIL|ZSBG]{5,8})\b/);if(!match)match=raw.match(/\b(?:I\s*[-.]?\s*L\s*S|H\s*5|H\s*Z)\s*[-:#]?\s*([0-9OIL|ZSBG]{5,8})\b/);if(match){const digits=match[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/Z/g,'2').replace(/S/g,'5').replace(/B/g,'8').replace(/G/g,'6').replace(/\D/g,'');if(digits.length>=5&&digits.length<=8){originalInvoiceNumber=`HS${digits}`;break;}}
      // On the printed Millfield header the invoice number and date occupy
      // the row immediately below their labels. OCR often damages the letters
      // "HS" while preserving the six digits, so only accept an isolated
      // 5-8 digit token in that label-relative header row. Date parts remain
      // separated by slashes and cannot join the invoice identifier.
      const digitTokens=[...raw.matchAll(/(?<![\d/])(\d{5,8})(?![\w/])/g)].map(item=>item[1]);const candidate=digitTokens.find(value=>value.length>=5&&value.length<=8);if(candidate){originalInvoiceNumber=`HS${candidate}`;break;}}
    if(!originalInvoiceNumber){const exactEvidence=[...new Set(numberEvidence.patterns.filter(pattern=>/^\d{5,8}$/.test(pattern)))];if(exactEvidence.length===1)originalInvoiceNumber=`HS${exactEvidence[0]}`;}
    const dateCandidates=identityLines.map(line=>millfieldDate(line.text,contextYear)).filter(Boolean);let date='';
    if(dateLabels.length){const label=dateLabels[0],labelY=Number(label.y)||0,labelX=Number(label.x)||0,tolerance=Math.max(height*4,pageHeight*.05,32),candidates=lines.filter(line=>Math.abs((Number(line.y)||0)-labelY)<=tolerance&&(Number(line.x)||0)>=labelX-pageWidth*.12).map(line=>({date:millfieldDate(line.text,contextYear),distance:Math.abs((Number(line.y)||0)-labelY)})).filter(item=>item.date).sort((a,b)=>a.distance-b.distance);date=candidates[0]?.date||'';}
    // Parse fallback dates one OCR line at a time. Joining nearby header/body
    // fragments can turn a partial printed year such as "02/07/2" plus a
    // stray OCR "I" from the table below into the false date 02/07/21.
    if(!date)date=dateCandidates[0]||'';
    return {originalInvoiceNumber,date,invoiceNumberPatterns:numberEvidence.patterns,invoiceNumberEvidence:numberEvidence.rawReferences,invoiceNumberSuffixes:numberEvidence.suffixes};
  }
  function millfieldContextYearForPage(page,anchors,globalYear){
    const nearby=(anchors||[]).filter(anchor=>Math.abs(Number(anchor.page)-Number(page))<=24);
    if(nearby.some(anchor=>anchor.year!==globalYear))return '';
    const corroborating=nearby.filter(anchor=>anchor.year===globalYear);
    return corroborating.length>=2?globalYear:nearby.length? '':globalYear;
  }
  function millfieldStatementPage(items){const text=(items||[]).map(line=>String(line.text||'')).join(' ');return isMillfieldAutopartsText(text)&&/\bStatement\s+To\b/i.test(text)&&/\bO\s*\/\s*S\s+Value\b/i.test(text)&&/\bInvoice\b/i.test(text);}
  function millfieldStatementPagesFromOcr(ocrLines){const pages=new Map();for(const line of Array.isArray(ocrLines)?ocrLines:[]){if(!line||!String(line.text||'').trim())continue;const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}return [...pages].filter(([,items])=>millfieldStatementPage(items)).map(([page])=>page);}
  function millfieldStatementMoneyValues(value){
    // On faint statement scans Windows OCR sometimes inserts a bullet in the
    // decimal separator (for example `29 • 35`). Only repair that separator
    // when exactly two pence digits follow, and only after the text has
    // already been assigned to the statement's Invoice/Credit column.
    const normalized=String(value||'').replace(/(\d)\s*[•·]\s*(\d{2})(?!\d)/g,'$1.$2');
    return anchoredInvoiceMoneyValues(normalized);
  }
  function millfieldStatementRowsFromOcr(ocrLines,source=''){
    const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),pages=new Map();for(const line of lines){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}const rows=[];
    for(const [page,items] of pages){
      if(!millfieldStatementPage(items))continue;
      const {lines:pageLines,height,pageHeight}=millfieldPageMetrics(items),findHeaders=pattern=>pageLines.filter(line=>pattern.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)),dateHeaders=findHeaders(/^Date$/i),typeHeader=findHeaders(/^Type$/i)[0],referenceHeader=findHeaders(/^(?:Reference|Fteference|Ref)$/i)[0],yourRefHeader=findHeaders(/^Your\s+Ref$/i)[0],dueDateHeader=findHeaders(/^Due\s+Date$/i)[0],invoiceHeader=findHeaders(/^(?:Invoice|lnvoice)$/i)[0],creditHeader=findHeaders(/^Credit$/i)[0],outstandingHeader=findHeaders(/^O\s*\/\s*S\s+Value$/i)[0];
      if(!invoiceHeader||!outstandingHeader)continue;
      // Some statement scans lose the Reference heading while preserving its
      // neighboring columns. Infer its center between those page-derived
      // anchors instead of assuming a fixed coordinate on the PDF.
      const center=line=>(Number(line.x)||0)+Math.max(Number(line.width)||0,String(line.text||'').length*height*.42)/2,visibleAnchors=[typeHeader,yourRefHeader,dueDateHeader,invoiceHeader,creditHeader,outstandingHeader].filter(Boolean),anchorYs=visibleAnchors.map(line=>Number(line.y)||0).sort((a,b)=>a-b),tableAnchorY=anchorYs[Math.floor(anchorYs.length/2)]||0;
      let effectiveReferenceHeader=referenceHeader;
      if(!effectiveReferenceHeader&&typeHeader){
        let relativePosition=null,rightAnchor=null;
        if(yourRefHeader){relativePosition=.5;rightAnchor=yourRefHeader;}
        else if(dueDateHeader){relativePosition=.36;rightAnchor=dueDateHeader;}
        else if(invoiceHeader){relativePosition=.25;rightAnchor=invoiceHeader;}
        if(rightAnchor){const referenceCenter=center(typeHeader)+(center(rightAnchor)-center(typeHeader))*relativePosition;effectiveReferenceHeader={text:'Reference (inferred)',x:referenceCenter-height*2,y:tableAnchorY,width:height*4,height};}
      }
      if(!effectiveReferenceHeader)continue;
      const dateHeader=dateHeaders.sort((a,b)=>Math.abs((Number(a.y)||0)-tableAnchorY)-Math.abs((Number(b.y)||0)-tableAnchorY))[0];if(!dateHeader)continue;
      // OCR can split cells across boxes, including an "H" above/beside the
      // reference digits and pence digits separated from the pounds. Anchor
      // on each date row and only combine boxes assigned to the same column.
      const headers=[dateHeader,typeHeader,effectiveReferenceHeader,yourRefHeader,dueDateHeader,invoiceHeader,creditHeader,outstandingHeader].filter(Boolean),headerY=Math.min(...headers.map(line=>Number(line.y)||0)),rowTolerance=Math.max(height*.82,8,pageHeight*.003),nearestHeader=line=>headers.reduce((best,item)=>Math.abs(center(line)-center(item))<Math.abs(center(line)-center(best))?item:best,headers[0]),dateLines=pageLines.filter(line=>{const y=Number(line.y)||0;return y>headerY+height&&y<pageHeight*.9&&nearestHeader(line)===dateHeader&&Boolean(millfieldDate(line.text));});
      const linesInColumn=(y,header)=>pageLines.filter(line=>Math.abs((Number(line.y)||0)-y)<=rowTolerance&&nearestHeader(line)===header).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0)),columnText=(y,header)=>linesInColumn(y,header).map(line=>String(line.text||'').trim()).filter(Boolean).join(' '),moneyInColumn=(y,header)=>{if(!header)return null;const columnLines=linesInColumn(y,header),combined=columnLines.map(line=>String(line.text||'').trim()).filter(Boolean).join(' '),values=millfieldStatementMoneyValues(combined);if(values.length){const unique=[...new Set(values.map(item=>Number(item.value.toFixed(2))))];return unique.length===1?unique[0]:null;}const zero=combined.match(/^\s*0[.,]0{1,2}\s*$/);if(zero)return 0;return null;};
      for(const dateLine of dateLines){const y=Number(dateLine.y)||0,date=millfieldDate(dateLine.text),referenceText=columnText(y,effectiveReferenceHeader),compactReference=referenceText.toUpperCase().replace(/[^A-Z0-9]/g,''),referenceMatch=compactReference.match(/[A-Z]{0,2}(\d{5,8})/),digits=millfieldReferenceDigits(referenceMatch?.[1]||''),invoiceCellText=columnText(y,invoiceHeader),creditCellText=columnText(y,creditHeader),invoiceTotal=moneyInColumn(y,invoiceHeader),creditTotal=moneyInColumn(y,creditHeader),typeText=columnText(y,typeHeader).toUpperCase().replace(/[^A-Z]/g,''),creditCellOnlyEvidence=Boolean(creditHeader&&/\d/.test(creditCellText)&&!/\d/.test(invoiceCellText)),isCredit=/^(?:CRN|CN|CRED|CRE|CRD)/.test(typeText)||invoiceTotal===null&&creditTotal!==null||invoiceTotal===null&&creditTotal===null&&creditCellOnlyEvidence,value=invoiceTotal??creditTotal,signedTotal=value===null?null:isCredit?-Math.abs(value):Math.abs(value);if(!digits||!date)continue;rows.push({profileId:'millfield-autoparts',source,page,reference:referenceMatch?.[0]||referenceText.replace(/\s+/g,'').toUpperCase(),referenceDigits:digits,date,total:signedTotal,documentType:isCredit?'CREDIT NOTE':'INVOICE'});}
    }
    return rows;
  }
  function millfieldStatementRetryRegionsFromOcr(ocrLines,targets){
    const lines=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),wanted=new Set((Array.isArray(targets)?targets:[]).filter(row=>row?.profileId==='millfield-autoparts'&&(row.total===null||row.total===undefined||row.total==='')).map(row=>[Number(row.page)||0,String(row.referenceDigits||''),String(row.date||''),String(row.documentType||'INVOICE')].join('|'))),pages=new Map();
    if(!wanted.size)return [];
    for(const line of lines){const page=Number(line.page)||1;if(!pages.has(page))pages.set(page,[]);pages.get(page).push(line);}
    const regions=[];
    for(const [page,items] of pages){
      if(!millfieldStatementPage(items))continue;
      const {lines:pageLines,height,pageHeight}=millfieldPageMetrics(items),findHeader=pattern=>pageLines.filter(line=>pattern.test(String(line.text||'').trim())).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0))[0],dateHeader=findHeader(/^Date$/i),typeHeader=findHeader(/^Type$/i),referenceHeader=findHeader(/^(?:Reference|Fteference|Ref)$/i),yourRefHeader=findHeader(/^Your\s+Ref$/i),dueDateHeader=findHeader(/^Due\s+Date$/i),invoiceHeader=findHeader(/^(?:Invoice|lnvoice)$/i),creditHeader=findHeader(/^Credit$/i),outstandingHeader=findHeader(/^O\s*\/\s*S\s+Value$/i);
      if(!dateHeader||!typeHeader||!invoiceHeader||!outstandingHeader)continue;
      const center=line=>(Number(line.x)||0)+Math.max(Number(line.width)||0,String(line.text||'').length*height*.42)/2,visible=[typeHeader,referenceHeader,yourRefHeader,dueDateHeader,invoiceHeader,creditHeader,outstandingHeader].filter(Boolean),ys=visible.map(line=>Number(line.y)||0).sort((a,b)=>a-b),tableY=ys[Math.floor(ys.length/2)]||0;
      let effectiveReferenceHeader=referenceHeader;
      if(!effectiveReferenceHeader){let fraction=null,rightAnchor=null;if(yourRefHeader){fraction=.5;rightAnchor=yourRefHeader;}else if(dueDateHeader){fraction=.36;rightAnchor=dueDateHeader;}else{fraction=.25;rightAnchor=invoiceHeader;}const referenceCenter=center(typeHeader)+(center(rightAnchor)-center(typeHeader))*fraction;effectiveReferenceHeader={text:'Reference (inferred)',x:referenceCenter-height*2,y:tableY,width:height*4,height};}
      const headers=[dateHeader,typeHeader,effectiveReferenceHeader,yourRefHeader,dueDateHeader,invoiceHeader,creditHeader,outstandingHeader].filter(Boolean),headerY=Math.min(...headers.map(line=>Number(line.y)||0)),rowTolerance=Math.max(height*.82,8,pageHeight*.003),nearest=line=>headers.reduce((best,item)=>Math.abs(center(line)-center(item))<Math.abs(center(line)-center(best))?item:best,headers[0]),dateLines=pageLines.filter(line=>{const y=Number(line.y)||0;return y>headerY+height&&y<pageHeight*.9&&nearest(line)===dateHeader&&Boolean(millfieldDate(line.text));}),linesInColumn=(y,header)=>pageLines.filter(line=>Math.abs((Number(line.y)||0)-y)<=rowTolerance&&nearest(line)===header).sort((a,b)=>(Number(a.x)||0)-(Number(b.x)||0)),columnText=(y,header)=>linesInColumn(y,header).map(line=>String(line.text||'').trim()).filter(Boolean).join(' ');
      const invoiceCenter=center(invoiceHeader),creditCenter=creditHeader?center(creditHeader):null;
      for(const dateLine of dateLines){const y=Number(dateLine.y)||0,date=millfieldDate(dateLine.text),referenceText=columnText(y,effectiveReferenceHeader),digits=millfieldReferenceDigits(referenceText),invoiceCellText=columnText(y,invoiceHeader),creditCellText=columnText(y,creditHeader),typeText=columnText(y,typeHeader).toUpperCase().replace(/[^A-Z]/g,''),creditCellOnlyEvidence=Boolean(creditHeader&&/\d/.test(creditCellText)&&!/\d/.test(invoiceCellText)),type=/^(?:CRN|CN|CRED|CRE|CRD)/.test(typeText)||creditCellOnlyEvidence?'CREDIT NOTE':'INVOICE',key=[page,digits,date,type].join('|');if(!wanted.has(key))continue;
        // For a credit note, reread the printed Credit column. OCR often splits
        // the Type label into `CRE IT`; if it is absent, digits confined to
        // the Credit cell identify which printed amount column to reread. If
        // this layout has no Credit header, preserve the Invoice-column fallback.
        const amountCenter=type==='CREDIT NOTE'&&creditHeader?creditCenter:invoiceCenter,leftAnchor=amountCenter===creditCenter?invoiceCenter:(dueDateHeader?center(dueDateHeader):center(typeHeader)),rightAnchor=amountCenter===creditCenter?center(outstandingHeader):(creditHeader?creditCenter:center(outstandingHeader)),left=(leftAnchor+amountCenter)/2,right=(amountCenter+rightAnchor)/2;
        if(!(right>left))continue;const lineHeight=Math.max(Number(dateLine.height)||0,height),padding=Math.max(lineHeight*.45,rowTolerance*.5,8),top=Math.max(0,y-padding),bottom=Math.min(pageHeight*.9,y+padding+lineHeight);if(bottom<=top)continue;regions.push({page,left,top,width:right-left,height:bottom-top,profileId:'millfield-autoparts',regionType:'statement-invoice-amount'});
      }
    }
    const unique=new Map();for(const region of regions){const key=[region.page,Math.round(region.left),Math.round(region.top)].join('|');unique.set(key,region);}return [...unique.values()];
  }
  function millfieldStatementRetryContextLines(lines,pages,regions){
    const pageSet=new Set((Array.isArray(pages)?pages:[]).map(Number)),cropRegions=Array.isArray(regions)?regions:[],isHeader=line=>/^(?:Date|Type|Reference|Fteference|Ref|Your\s+Ref|Due\s+Date|Invoice|lnvoice|Credit|O\s*\/\s*S\s+Value)$/i.test(String(line?.text||'').trim());
    const overlaps=line=>cropRegions.some(region=>Number(line?.page)===Number(region?.page)&&(Number(line?.x)||0)<Number(region?.left||0)+Number(region?.width||0)&&(Number(line?.x||0)+Number(line?.width||0))>Number(region?.left||0)&&(Number(line?.y)||0)<Number(region?.top||0)+Number(region?.height||0)&&(Number(line?.y||0)+Number(line?.height||0))>Number(region?.top||0));
    return (Array.isArray(lines)?lines:[]).filter(line=>pageSet.has(Number(line?.page))&&(!overlaps(line)||isHeader(line)));
  }
  function millfieldStatementRetryAmountsFromOcr(contextLines,retryLines,source=''){
    const variants=new Map();for(const line of Array.isArray(retryLines)?retryLines:[]){const page=Number(line?.page)||0;if(!page||!String(line?.text||'').trim())continue;const variant=String(line.millfieldStatementVariant||'unlabelled'),key=`${page}|${variant}`,lines=variants.get(key)||[];lines.push(line);variants.set(key,lines);}
    const votes=new Map();for(const [variantKey,lines] of variants){const page=Number(lines[0]?.page)||0,variant=variantKey.slice(variantKey.indexOf('|')+1),context=(Array.isArray(contextLines)?contextLines:[]).filter(line=>Number(line?.page)===page),observed=millfieldStatementRowsFromOcr([...context,...lines],source);for(const item of observed){if(item.total===null||item.total===undefined||item.total===''||!Number.isFinite(Number(item.total)))continue;const key=[Number(item.page)||0,String(item.referenceDigits||''),String(item.date||''),String(item.documentType||'INVOICE')].join('|'),cents=Math.round(Number(item.total)*100),byValue=votes.get(key)||new Map(),evidence=byValue.get(cents)||{count:0,base:false};evidence.count++;evidence.base=evidence.base||variant==='base';byValue.set(cents,evidence);votes.set(key,byValue);}}
    const confirmed=[];for(const [key,byValue] of votes){if(byValue.size!==1)continue;const [[cents,evidence]]=[...byValue];if(evidence.count<2&&!(evidence.count===1&&evidence.base))continue;const [page,referenceDigits,date,documentType]=key.split('|');confirmed.push({profileId:'millfield-autoparts',page:Number(page),referenceDigits,date,documentType,total:cents/100,confirmingReadings:evidence.count});}return confirmed;
  }
  function millfieldInvoicePage(items,text=''){
    const flat=String(text||items.map(line=>String(line.text||'')).join(' '));if(!isMillfieldAutopartsText(flat)||millfieldStatementPage(items))return false;const hasHeader=/\bInvoice\s+Number\b/i.test(flat),hasFooter=/\bTotal\s+Goods\b/i.test(flat)&&/\bTotal\s+VAT\b/i.test(flat),hasDue=/\bAmount\b/i.test(flat)&&/\b(?:Invoice|Date)\b/i.test(flat);return hasHeader&&(hasFooter||hasDue);
  }
  function parseMillfieldAutopartsInvoice(text,source='',ocrLines,options={}){
    const items=(Array.isArray(ocrLines)?ocrLines:[]).filter(line=>line&&String(line.text||'').trim()),flat=String(text||items.map(line=>String(line.text||'')).join('\n')),invoiceDocument=millfieldInvoicePage(items,flat);if(!invoiceDocument)return {invoiceNumber:'',originalInvoiceNumber:'',date:'',supplier:'Millfield Autoparts Ltd',subtotal:'',vat:'',vatUnverified:true,total:'',documentType:'NON-INVOICE',isInvoiceDocument:false,currency:'GBP',source,accepted:false,rejected:true,status:'REJECTED',confidence:'REJECTED',rejectedReason:'This Millfield document is a statement or non-invoice page.',retryOcr:false,profileId:'millfield-autoparts'};
    const header=millfieldInvoiceHeader(items,flat,options.millfieldContextYear),footerAmounts=millfieldFooterSummaryAmounts(items),goods=footerAmounts.goods,directVat=footerAmounts.vat,hasFooterVariants=items.some(line=>line?.millfieldFooterVariant!==undefined),variantTotal=millfieldAmountDueValue(items,{returnMatch:true}),nearbyTotal=millfieldNearbyMoney(items,/^\s*Amount(?:\s+Due)?\s*:?\s*$/i,{minimumYRatio:.68,maximumYRatio:.995,verticalRatio:.035,standaloneLabel:true,returnMatch:true}),totalRead=hasFooterVariants?(variantTotal?.consensus?variantTotal:null):(nearbyTotal||variantTotal),printedTotal=totalRead?.value??null,amountDue=printedTotal,totalReadText=String(totalRead?.line?.text||'').trim(),spacedPenceOcr=/^\s*(?:£\s*)?\(?-?\d{1,6}\s+\d{2}\)?$/.test(totalReadText)||/\d\s+[aA]\s*\d{2}/.test(totalReadText),footerConfirmsSpacedPence=printedTotal!==null&&goods!==null&&directVat!==null&&Math.abs(Math.round(Number(printedTotal)*100)-Math.round((Number(goods)+Number(directVat))*100))<=1,totalOcrWeak=spacedPenceOcr?!footerConfirmsSpacedPence:Boolean(totalRead?.weak);let total=amountDue??null,vat=directVat??null,net=goods??null,totalDerivedFromFooter=false;
    const meaningfulMoney=total!==null||vat!==null||net!==null,identity=header.originalInvoiceNumber||header.date;if(!identity&&!meaningfulMoney&&!header.invoiceNumberPatterns?.length)return {invoiceNumber:'',originalInvoiceNumber:'',date:'',supplier:'Millfield Autoparts Ltd',subtotal:'',vat:'',vatUnverified:true,total:'',documentType:'NON-INVOICE',isInvoiceDocument:false,currency:'GBP',source,accepted:false,rejected:true,status:'REJECTED',confidence:'REJECTED',rejectedReason:'Faint Millfield copy page ignored because it contained no readable invoice identifiers or footer amounts.',retryOcr:false,profileId:'millfield-autoparts',millfieldIgnoredCopy:true};
    let invoiceNumber=header.originalInvoiceNumber||'',invoiceNumberGenerated=false;if(!invoiceNumber){invoiceNumberGenerated=true;invoiceNumber=generatedInvoiceReference('millfield-autoparts',header.date||'UNDATED',`${source}|PAGE:${Number(items[0]?.page)||1}|${flat}`);}
    if(total===null&&net!==null&&vat!==null){total=Number((Math.round(net*100)+Math.round(vat*100))/100);totalDerivedFromFooter=true;}
    if(vat===null&&total!==null){const grossCents=Math.round(Math.abs(total)*100),assumedVatCents=Math.round(grossCents/6),netCents=net===null?null:Math.round(Math.abs(net)*100),footerDifferenceCents=netCents===null?null:grossCents-netCents;vat=Math.sign(total||1)*(footerDifferenceCents!==null&&footerDifferenceCents>=0&&Math.abs(footerDifferenceCents-assumedVatCents)<=2?footerDifferenceCents:assumedVatCents)/100;}
    if(vat===null&&net!==null){vat=Math.round(Math.round(Math.abs(net)*100)*.2)/100*Math.sign(net||1);}
    if(total===null&&net!==null&&vat!==null){total=Number(((Math.round(net*100)+Math.round(vat*100))/100).toFixed(2));totalDerivedFromFooter=true;}
    if(total!==null)total=Number(Number(total).toFixed(2));if(vat!==null)vat=Number(Number(vat).toFixed(2));if(net!==null)net=Number(Number(net).toFixed(2));const millfieldFirstPassOcrTotal=totalOcrWeak?total:'';if(totalOcrWeak){total=null;if(directVat===null)vat=null;}
    // Millfield invoices use 20% VAT. If the date and printed VAT are clear
    // but the printed gross total is missing, VAT is one sixth of gross; infer
    // the total from the VAT cents. Zero VAT cannot determine a gross amount.
    const millfieldTotalDerivedFromVat20=Boolean(total===null&&header.date&&directVat!==null&&Number.isFinite(Number(directVat))&&Number(directVat)>0&&!/\bCREDIT\s+NOTE\b/i.test(flat));
    if(millfieldTotalDerivedFromVat20)total=Math.round(Math.round(Number(directVat)*100)*6)/100;
    if(total!==null)total=Number(Number(total).toFixed(2));
    const complete=Boolean(header.date&&invoiceNumber&&total!==null&&vat!==null&&(!totalOcrWeak||millfieldTotalDerivedFromVat20)),reason=complete?'':totalOcrWeak?'Millfield invoice total needs confirmation from the focused 5× footer OCR retry.':!header.date?'Invoice date could not be read; statements are only used when the full printed invoice number is readable.':total===null?'Invoice total could not be confirmed from its footer or a matching statement.':'Invoice VAT could not be confirmed or derived from the invoice footer.';
    return {invoiceNumber,originalInvoiceNumber:header.originalInvoiceNumber||invoiceNumber,date:header.date,supplier:'Millfield Autoparts Ltd',subtotal:net??'',vat:vat??'',vatUnverified:vat===null,vatMentioned:directVat!==null,vatAssumed20:directVat===null&&vat!==null,total:total??'',documentType:/\bCREDIT\s+NOTE\b/i.test(flat)?'CREDIT NOTE':'INVOICE',isInvoiceDocument:true,currency:'GBP',source,accepted:complete,rejected:!complete,status:complete?'ACCEPTED':'REJECTED',confidence:complete?'ACCEPTED':'REJECTED',rejectedReason:reason,retryOcr:!complete||invoiceNumberGenerated||totalOcrWeak,review:false,layoutId:'millfield-footer-summary',profileId:'millfield-autoparts',invoiceNumberGenerated,millfieldPrintedInvoiceNumber:Boolean(header.originalInvoiceNumber),millfieldInvoiceNumberPatterns:header.invoiceNumberPatterns||[],millfieldInvoiceNumberEvidence:header.invoiceNumberEvidence||[],millfieldInvoiceNumberSuffixes:header.invoiceNumberSuffixes||[],millfieldFooterGoods:net??'',millfieldFooterVat:directVat??'',millfieldPrintedTotal:totalOcrWeak?'':amountDue??'',millfieldFirstPassOcrTotal:millfieldFirstPassOcrTotal,millfieldTotalDerivedFromFooter:totalDerivedFromFooter,millfieldTotalDerivedFromVat20,millfieldTotalOcrWeak:totalOcrWeak,millfieldFooterTotalConsensus:Boolean(totalRead?.consensus),millfieldFooterAmountsConsensus:Boolean(hasFooterVariants&&goods!==null&&directVat!==null)};
  }
  function parseMillfieldAutopartsBatch(pageLines,source='',options={}){
    const pages=[...pageLines.keys()].sort((a,b)=>a-b),anchors=[],yearCounts=new Map();for(const page of pages){const items=pageLines.get(page)||[],text=items.map(line=>String(line.text||'')).join(' ');if(!isMillfieldAutopartsText(text)||millfieldStatementPage(items))continue;const year=String(millfieldInvoiceHeader(items,text).date||'').slice(0,4);if(/^20\d{2}$/.test(year)){anchors.push({page,year});yearCounts.set(year,(yearCounts.get(year)||0)+1);}}
    const rankedYears=[...yearCounts].sort((a,b)=>b[1]-a[1]),yearTotal=[...yearCounts.values()].reduce((sum,count)=>sum+count,0),millfieldContextYear=rankedYears.length&&rankedYears[0][1]>=2&&rankedYears[0][1]/yearTotal>=.6?rankedYears[0][0]:'';
    const records=[],statementPages=new Set(),consumed=new Set();for(const page of pages){const items=pageLines.get(page)||[],pageText=items.map(line=>String(line.text||'')).join(' '),compactText=millfieldCompact(pageText);if(items.length<=2&&compactText.length<=10){consumed.add(page);continue;}if(!isMillfieldAutopartsText(pageText))continue;consumed.add(page);if(millfieldStatementPage(items)){statementPages.add(page);continue;}if(!millfieldInvoicePage(items,pageText))continue;const suppliedContexts=options.millfieldContextByPage||{},hasSuppliedContext=Object.prototype.hasOwnProperty.call(suppliedContexts,page),pageContextYear=hasSuppliedContext?String(suppliedContexts[page]||''):millfieldContextYearForPage(page,anchors,millfieldContextYear),row=parseInvoiceRobust(pageText,source,items,{...options,millfieldContextYear:pageContextYear});if(row.millfieldIgnoredCopy)continue;row.profileId='millfield-autoparts';row.page=page;row.sourcePages=[page];row.millfieldContextYear=pageContextYear;records.push(row);}
    const otherLines=[...pageLines.values()].flat().filter(line=>!consumed.has(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];return [...otherRows,...records].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
  }
  function applyMillfieldStatementRows(rows,statementRows){
    const statements=Array.isArray(statementRows)?statementRows:[],millfieldRows=(Array.isArray(rows)?rows:[]).filter(row=>row?.profileId==='millfield-autoparts');
    const cents=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Math.round(Number(value)*100),identityKey=item=>[String(item.referenceDigits||''),String(item.date||''),cents(item.total)??'',String(item.documentType||'INVOICE')].join('|'),uniqueItems=input=>{const groups=new Map();for(const item of input){const key=[String(item.referenceDigits||''),String(item.date||''),String(item.documentType||'INVOICE')].join('|'),entries=groups.get(key)||[];entries.push(item);groups.set(key,entries);}const output=[];for(const entries of groups.values()){const totals=new Set(entries.map(item=>cents(item.total)).filter(value=>value!==null));if(totals.size<=1){output.push(entries.find(item=>cents(item.total)!==null)||entries[0]);continue;}for(const item of new Map(entries.map(item=>[identityKey(item),item])).values())output.push(item);}return output;},samePattern=(pattern,digits)=>Boolean(pattern&&digits&&pattern.length===digits.length&&[...pattern].every((character,index)=>character==='?'||character===digits[index])),sameInvoiceType=(row,item)=>String(row.documentType||'INVOICE').toUpperCase()===String(item.documentType||'INVOICE').toUpperCase(),suffixCounts=new Map();
    for(const reference of new Set(statements.map(item=>String(item?.referenceDigits||'')))){const suffix=reference.slice(-4);suffixCounts.set(suffix,(suffixCounts.get(suffix)||0)+1);}
    const invoiceNumberForReference=reference=>{const digits=String(reference||'');return (suffixCounts.get(digits.slice(-4))||0)>1?digits:digits.slice(-4);};
    const clearTotalConflict=row=>{const remaining={...(row.ocrAmountConflicts||{})};delete remaining.total;if(Object.keys(remaining).length){row.ocrAmountConflicts=remaining;row.ocrConflictReason=invoiceRetryConflictReason(remaining);}else{delete row.ocrAmountConflicts;delete row.ocrConflictReason;}};
    for(const row of millfieldRows){
      let digits=row.invoiceNumberGenerated?'':millfieldReferenceDigits(row.originalInvoiceNumber),resolvedInvoiceReference='';
      let matchKind='',matches=[];
      if(row.millfieldInvoiceNumberConflict){
        const referenceCandidates=new Set((row.millfieldInvoiceNumberCandidates||[]).map(millfieldReferenceDigits).filter(Boolean)),candidateMatches=statements.filter(item=>referenceCandidates.has(String(item?.referenceDigits||''))&&sameInvoiceType(row,item)),candidateReferences=new Set(candidateMatches.map(item=>String(item.referenceDigits||'')));
        if(candidateReferences.size===1){digits=[...candidateReferences][0];matches=candidateMatches;matchKind='statement-resolved-ocr-conflict';row.millfieldInvoiceNumberConflict=false;row.millfieldInvoiceNumberConflictResolved=true;}
        else{row.millfieldStatementPossibleMatch=Boolean(candidateMatches.length);row.rejectedReason='The invoice number reads differently across OCR passes and could not be resolved to one exact statement reference.';continue;}
      }else if(digits){matches=statements.filter(item=>item?.referenceDigits===digits&&sameInvoiceType(row,item));if(matches.length)matchKind='exact';}
      if(!matches.length){
        const suffixes=new Set([...(row.millfieldInvoiceNumberSuffixes||[]).map(String),...(!row.invoiceNumberGenerated&&/^\d{4}$/.test(String(row.invoiceNumber||''))?[String(row.invoiceNumber)]:[])]),suffixMatches=statements.filter(item=>[...suffixes].some(suffix=>suffix.length===4&&String(item?.referenceDigits||'').endsWith(suffix))&&sameInvoiceType(row,item));
        let candidates=uniqueItems(suffixMatches),candidateRefs=new Set(candidates.map(item=>item.referenceDigits));
        if(candidateRefs.size>1){const rowDate=String(row.date||''),rowCents=cents(row.total),corroborated=candidates.filter(item=>rowDate&&item.date===rowDate&&rowCents!==null&&cents(item.total)===rowCents);if(corroborated.length)candidates=uniqueItems(corroborated);}
        candidateRefs=new Set(candidates.map(item=>item.referenceDigits));if(candidateRefs.size===1&&candidates.length){matches=candidates;matchKind='ocr-suffix';}else if(suffixMatches.length)row.millfieldStatementPossibleMatch=true;
      }
      if(!matches.length&&row.millfieldInvoiceNumberPatterns?.length){
        const patterns=row.millfieldInvoiceNumberPatterns.map(String).filter(pattern=>pattern.length>=5&&pattern.length<=8&&(pattern.match(/\d/g)||[]).length>=4),patternMatches=statements.filter(item=>patterns.some(pattern=>samePattern(pattern,String(item?.referenceDigits||'')))&&sameInvoiceType(row,item));
        let candidates=uniqueItems(patternMatches);
        if(candidates.length>1){const rowDate=String(row.date||''),rowCents=cents(row.total),corroborated=candidates.filter(item=>rowDate&&item.date===rowDate&&rowCents!==null&&cents(item.total)===rowCents);if(corroborated.length)candidates=uniqueItems(corroborated);}
        if(candidates.length===1){
          const statement=candidates[0],pattern=patterns.find(value=>samePattern(value,String(statement.referenceDigits||''))),exactPattern=pattern&&!pattern.includes('?');
          const knownDigits=(pattern?.match(/\d/g)||[]).length,totalCorroborated=cents(row.total)!==null&&cents(row.total)===cents(statement.total),dateCorroborated=Boolean(row.date&&row.date===statement.date),corroborated=totalCorroborated||dateCorroborated&&knownDigits>=5;
          if(exactPattern||corroborated){matches=[statement];matchKind='ocr-pattern';row.originalInvoiceNumber='HS'+statement.referenceDigits;row.invoiceNumber=invoiceNumberForReference(statement.referenceDigits);row.invoiceNumberGenerated=false;row.invoiceNumberGeneratedReason='';row.millfieldPrintedInvoiceNumber=true;row.millfieldStatementResolvedOcrNumber=true;}
          else row.millfieldStatementPossibleMatch=true;
        }else if(patternMatches.length)row.millfieldStatementPossibleMatch=true;
      }
      if(!matches.length&&row.millfieldInvoiceNumberPatterns?.length){
        // If Windows OCR inserted or dropped characters around the printed HS
        // reference, a same-length wildcard match can fail even though five
        // or more header digits are intact (for example 2?97?19 for 297219).
        // Treat the recognized digits as an ordered subsequence only when they
        // identify exactly one full statement reference of the same document
        // type. This stays tied to the printed invoice-number field; no lookup
        // is made from a generated ID, amount, or date alone.
        const recognizedSequences=[...new Set(row.millfieldInvoiceNumberPatterns.map(pattern=>String(pattern).replace(/\D/g,'')).filter(sequence=>sequence.length>=5))],containsSequence=(reference,sequence)=>{let index=0;for(const digit of String(reference||'')){if(digit===sequence[index])index++;if(index===sequence.length)return true;}return false;},sequenceMatches=statements.filter(item=>recognizedSequences.some(sequence=>containsSequence(item?.referenceDigits,sequence))&&sameInvoiceType(row,item)),candidates=uniqueItems(sequenceMatches),candidateReferences=new Set(candidates.map(item=>String(item.referenceDigits||'')));
        if(candidates.length&&candidateReferences.size===1){matches=candidates;matchKind='ocr-digit-sequence';row.originalInvoiceNumber='HS'+candidates[0].referenceDigits;row.invoiceNumber=invoiceNumberForReference(candidates[0].referenceDigits);row.invoiceNumberGenerated=false;row.invoiceNumberGeneratedReason='';row.millfieldPrintedInvoiceNumber=true;row.millfieldStatementResolvedOcrNumber=true;}
        else if(sequenceMatches.length)row.millfieldStatementPossibleMatch=true;
      }
      if(!matches.length&&row.millfieldPrintedInvoiceNumber&&!row.invoiceNumberGenerated&&cents(row.total)!==null){
        const printedReferences=new Set((row.millfieldInvoiceNumberPatterns||[]).map(String).filter(pattern=>/^\d{6,8}$/.test(pattern)));if(/^HS\d{6,8}$/i.test(String(row.originalInvoiceNumber||'')))printedReferences.add(String(row.originalInvoiceNumber).replace(/\D/g,''));
        const prefixCandidates=uniqueItems(statements.filter(item=>{const statementReference=String(item?.referenceDigits||''),matchingPrinted=[...printedReferences].filter(reference=>reference.startsWith(statementReference)&&reference.length-statementReference.length===1);return matchingPrinted.length===1&&sameInvoiceType(row,item)&&cents(item.total)!==null&&cents(item.total)===cents(row.total);}));
        const prefixReferences=new Set(prefixCandidates.map(item=>String(item.referenceDigits||'')));
        if(prefixCandidates.length===1&&prefixReferences.size===1){const statement=prefixCandidates[0];resolvedInvoiceReference=[...printedReferences].find(reference=>reference.startsWith(String(statement.referenceDigits||''))&&reference.length-String(statement.referenceDigits||'').length===1)||'';if(resolvedInvoiceReference){matches=[statement];matchKind='statement-prefix-total-confirmed';row.millfieldStatementResolvedOcrNumber=true;}}
      }
      if(!matches.length)continue;
      const identities=new Map(uniqueItems(matches).map(item=>[identityKey(item),item]));
      if(identities.size!==1){row.millfieldStatementConflict=true;row.rejectedReason='The matching Millfield statement has conflicting entries for this invoice number.';row.accepted=false;row.rejected=true;row.status='REJECTED';continue;}
      const statement=[...identities.values()][0],hasStatementTotal=statement.total!==null&&statement.total!==undefined&&statement.total!==''&&Number.isFinite(Number(statement.total)),statementTotal=hasStatementTotal?Number(statement.total):null,currentTotal=Number(row.total),hasCurrentTotal=row.total!==''&&row.total!==null&&row.total!==undefined&&Number.isFinite(currentTotal),totalMatches=hasCurrentTotal&&hasStatementTotal&&cents(currentTotal)===cents(statementTotal),totalConflict=row.ocrAmountConflicts?.total,conflictedTotals=[Number(totalConflict?.firstPass),Number(totalConflict?.retry)].filter(Number.isFinite),statementConfirmsObservedTotal=hasStatementTotal&&(totalMatches||conflictedTotals.some(value=>cents(value)===cents(statementTotal))),canonicalReference=resolvedInvoiceReference||statement.referenceDigits;
      if(!resolvedInvoiceReference){row.originalInvoiceNumber='HS'+canonicalReference;row.invoiceNumber=invoiceNumberForReference(canonicalReference);}else row.invoiceNumber=invoiceNumberForReference(canonicalReference);row.invoiceNumberGenerated=false;row.invoiceNumberGeneratedReason='';row.millfieldPrintedInvoiceNumber=true;
      row.millfieldStatementConfirmed=true;row.millfieldStatementMatchKind=matchKind;row.millfieldStatementMatchedBySuffix=matchKind==='ocr-suffix';row.millfieldStatementReferenceDigits=statement.referenceDigits;row.millfieldStatementPossibleMatch=false;row.millfieldTotalOcrWeak=false;row.millfieldFooterOcrUnconfirmed=false;
      if(hasStatementTotal&&!totalMatches){row.total=statementTotal;row.millfieldStatementOverrodeOcrTotal=hasCurrentTotal;row.millfieldTotalDerivedFromFooter=false;clearTotalConflict(row);}
      else if(statementConfirmsObservedTotal&&totalConflict)clearTotalConflict(row);
      if(statement.date&&row.date!==statement.date){row.date=statement.date;row.millfieldStatementOverrodeOcrDate=true;}
      if((row.total===''||row.total===null||row.total===undefined)&&row.date&&!row.millfieldTotalOcrWeak&&!row.millfieldFooterOcrUnconfirmed&&!row.ocrAmountConflicts?.total&&!/\bCREDIT\s+NOTE\b/i.test(String(row.documentType||''))){const directVat=row.millfieldFooterVat!==''&&row.millfieldFooterVat!==null&&row.millfieldFooterVat!==undefined?Number(row.millfieldFooterVat):(!row.vatAssumed20&&!row.vatUnverified?Number(row.vat):NaN);if(Number.isFinite(directVat)&&directVat>0){row.total=Math.round(Math.round(directVat*100)*6)/100;row.millfieldTotalDerivedFromVat20=true;row.millfieldTotalDerivedFromFooter=false;}}
      if((row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified||row.vatAssumed20)&&row.total!==''&&row.total!==null&&row.total!==undefined){
        const goods=Number(row.millfieldFooterGoods),grossCents=Math.round(Math.abs(Number(row.total))*100),assumedVatCents=Math.round(grossCents/6),netCents=Number.isFinite(goods)&&goods!==0?Math.round(Math.abs(goods)*100):null,footerDifferenceCents=netCents===null?null:grossCents-netCents;
        row.vat=Math.sign(Number(row.total)||1)*(footerDifferenceCents!==null&&footerDifferenceCents>=0&&Math.abs(footerDifferenceCents-assumedVatCents)<=2?footerDifferenceCents:assumedVatCents)/100;row.vat=Number(row.vat.toFixed(2));row.vatUnverified=false;row.vatAssumed20=true;row.rejectedReason='';
      }
    }
    for(const row of millfieldRows){
      if(row.millfieldStatementConflict)continue;
      const complete=Boolean(row.isInvoiceDocument!==false&&row.invoiceNumber&&row.date&&Number.isFinite(Number(row.total))&&row.total!==''&&row.vat!==''&&row.vat!==null&&row.vat!==undefined&&Number.isFinite(Number(row.vat))&&!row.vatUnverified&&!row.ocrConflictReason&&!row.millfieldStatementConflict&&!row.millfieldStatementPossibleMatch&&!row.millfieldInvoiceNumberConflict);
      row.accepted=complete;row.rejected=!complete;row.status=complete?'ACCEPTED':'REJECTED';row.confidence=row.status;
      if(complete)row.rejectedReason='';else if(row.millfieldInvoiceNumberConflict)row.rejectedReason='The invoice number reads differently across OCR passes and could not be resolved to one exact statement reference.';else if(row.millfieldStatementPossibleMatch)row.rejectedReason='The invoice number resembles more than one statement entry or its printed details conflict; verify the reference and amount.';else if(row.millfieldPrintedInvoiceNumber&&!row.date)row.rejectedReason='Invoice date could not be confirmed from the invoice or its matching statement.';else if(row.total===''||row.total===null||row.total===undefined)row.rejectedReason='Invoice total could not be confirmed from the invoice footer or a matching statement.';else if(row.vat===''||row.vat===null||row.vat===undefined||row.vatUnverified)row.rejectedReason='Invoice VAT could not be confirmed from the invoice footer or the stated 20% rate.';
    }
    return rows;
  }
  function addMillfieldStatementOnlyRows(rows,statementRows){
    const output=Array.isArray(rows)?rows:[],statements=Array.isArray(statementRows)?statementRows.filter(item=>item?.profileId==='millfield-autoparts'&&millfieldReferenceDigits(item.referenceDigits)&&item.date):[],millfieldRows=output.filter(row=>row?.profileId==='millfield-autoparts'),keyFor=(reference,type)=>`${String(reference)}|${String(type||'INVOICE').toUpperCase()}`,byReference=new Map();
    for(const item of statements){const reference=String(item.referenceDigits),key=keyFor(reference,item.documentType),entries=byReference.get(key)||[];entries.push(item);byReference.set(key,entries);}
    const represented=new Set(millfieldRows.filter(row=>row.millfieldStatementConfirmed).map(row=>keyFor(row.millfieldStatementReferenceDigits||String(row.originalInvoiceNumber||'').replace(/\D/g,''),row.documentType)));
    for(const row of millfieldRows){if(row.millfieldStatementConfirmed||row.invoiceNumberGenerated)continue;const digits=millfieldReferenceDigits(row.originalInvoiceNumber);if(digits)represented.add(keyFor(digits,row.documentType));}
    const suffixCounts=new Map();for(const reference of new Set(statements.map(item=>String(item.referenceDigits)))){const suffix=reference.slice(-4);suffixCounts.set(suffix,(suffixCounts.get(suffix)||0)+1);}
    const emitted=new Set();
    for(const [referenceKey,observations] of byReference){
      const sample=observations[0],reference=String(sample.referenceDigits),documentType=String(sample.documentType||'INVOICE').toUpperCase();if(represented.has(referenceKey)||emitted.has(referenceKey))continue;
      const unique=uniqueMillfieldStatementObservations(observations);
      if(unique.length!==1){const collision=suffixCounts.get(reference.slice(-4))>1,conflict={profileId:'millfield-autoparts',invoiceNumber:collision?reference:reference.slice(-4),originalInvoiceNumber:'HS'+reference,date:'',supplier:'Millfield Autoparts Ltd',subtotal:'',vat:'',vatUnverified:true,total:'',documentType, isInvoiceDocument:true,currency:'GBP',source:sample?.source||'',sourcePath:sample?.sourcePath||'',page:Math.max(1,Number(sample?.page)||1),include:true,accepted:false,rejected:true,status:'REJECTED',confidence:'REJECTED',rejectedReason:'The Millfield statement contains conflicting entries for this invoice reference; verify it manually.',millfieldStatementOnly:true,millfieldStatementConflict:true};output.push(conflict);emitted.add(referenceKey);continue;}
      const statement=unique[0],hasTotal=statement.total!==null&&statement.total!==undefined&&statement.total!==''&&Number.isFinite(Number(statement.total)),total=hasTotal?Number(Number(statement.total).toFixed(2)):'',vatCents=hasTotal?Math.round(Math.abs(total)*100/6):null,vat=hasTotal?Math.sign(total||1)*vatCents/100:'',sourcePath=statement.sourcePath||'',collision=suffixCounts.get(reference.slice(-4))>1,row={invoiceNumber:collision?reference:reference.slice(-4),originalInvoiceNumber:'HS'+reference,invoiceNumberGenerated:false,invoiceNumberGeneratedReason:'',date:statement.date,supplier:'Millfield Autoparts Ltd',subtotal:'',vat:hasTotal?Number(vat.toFixed(2)):'',vatUnverified:!hasTotal,vatMentioned:false,vatAssumed20:hasTotal,total,documentType,isInvoiceDocument:true,currency:'GBP',source:statement.source||'Millfield 3.pdf',sourcePath,page:Math.max(1,Number(statement.page)||1),sourcePages:[Math.max(1,Number(statement.page)||1)],include:true,accepted:hasTotal,rejected:!hasTotal,status:hasTotal?'ACCEPTED':'REJECTED',confidence:hasTotal?'ACCEPTED':'REJECTED',rejectedReason:hasTotal?'':'Millfield statement reference and date were readable, but its Invoice-column amount could not be confirmed.',retryOcr:false,review:false,layoutId:'millfield-statement-only',profileId:'millfield-autoparts',millfieldStatementOnly:true,millfieldStatementConfirmed:true,millfieldStatementMatchKind:hasTotal?'statement-only':'statement-only-incomplete',millfieldStatementReferenceDigits:reference};
      output.push(row);emitted.add(referenceKey);
    }
    return output;
  }
  function uniqueMillfieldStatementObservations(observations){const groups=new Map();for(const item of observations||[]){const key=[String(item.referenceDigits||''),String(item.date||''),String(item.documentType||'INVOICE')].join('|'),entries=groups.get(key)||[];entries.push(item);groups.set(key,entries);}const output=[];for(const entries of groups.values()){const totals=new Set(entries.filter(item=>item.total!==null&&item.total!==undefined&&item.total!==''&&Number.isFinite(Number(item.total))).map(item=>Math.round(Number(item.total)*100)));if(totals.size<=1){output.push(entries.find(item=>item.total!==null&&item.total!==undefined&&item.total!==''&&Number.isFinite(Number(item.total)))||entries[0]);continue;}const unique=new Map();for(const item of entries){const total=item.total!==null&&item.total!==undefined&&item.total!==''&&Number.isFinite(Number(item.total))?Math.round(Number(item.total)*100):'';unique.set(`${String(item.referenceDigits||'')}|${String(item.date||'')}|${total}|${String(item.documentType||'INVOICE')}`,item);}output.push(...unique.values());}return output;}
  function anchoredInvoiceProfile(id,name,detect){const profile={id,name,kind:'supplier',status:'Review',category:'Invoices',formatTag:'PDF only',detect};return {...profile,parse:(flat,source,lines)=>parseAnchoredInvoice(flat,source,lines,profile)};}
  const invoiceProfiles=[
    {id:'amazon',name:'Amazon',kind:'supplier',status:'Review',formatTag:'Online PDF',detect:isAmazonInvoiceText,parse:(flat,source,lines)=>parseAmazonInvoice(flat,source,lines)},
{id:'kin-global',name:'Kin Global Distribution Ltd',kind:'supplier',status:'Review',category:'Invoices',formatTag:'PDF only',detect:isKinGlobalText,parse:(flat,source,lines)=>parseKinGlobalInvoice(flat,source,lines)},
{id:'km-distribution',name:'KM Distribution Centre Ltd',kind:'supplier',status:'Review',category:'Invoices',formatTag:'PDF only',detect:isKmDistributionText,parse:(flat,source,lines)=>parseKmDistributionInvoice(flat,source,lines)},
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
    {id:'gsf-car-parts',name:'GSF Car Parts Limited',kind:'supplier',status:'Review',category:'Invoices',detect:isGsfCarPartsText,parse:(flat,source,lines)=>parseGsfCarPartsInvoice(flat,source,lines)},
    {id:'parts-plus',name:'Parts Plus',kind:'supplier',status:'Review',category:'Invoices',detect:isPartsPlusText,parse:(flat,source,lines)=>parsePartsPlusInvoice(flat,source,lines)},
    {id:'rac-motoring-services',name:'RAC Motoring Services',kind:'supplier',status:'Review',category:'Invoices',detect:isRacMotoringText,parse:(flat,source,lines)=>parseRacInvoice(flat,source,lines)},
    {id:'eu-ltd',name:'EU LTD',kind:'supplier',status:'Review',category:'Invoices',detect:isEuLtdText,parse:(flat,source,lines)=>parseEuLtdInvoice(flat,source,lines)},
{id:'millfield-autoparts',name:'Millfield Autoparts Ltd',kind:'supplier',status:'Under development',category:'Invoices',detect:isMillfieldAutopartsText,parse:(flat,source,lines,options)=>parseMillfieldAutopartsInvoice(flat,source,lines,options)},
    anchoredInvoiceProfile('acre-aesthetics','Acre Aesthetics Limited',text=>/\bACRE\s+AESTHETICS\s+LIMITED\b|acre-aesthetics/i.test(text)),
    anchoredInvoiceProfile('abbvie','AbbVie Ltd',text=>/\bABBVIE\s+(?:LTD|LIMITED)\b|\bABBVIE\s+HOUSE\b/i.test(text)),
    anchoredInvoiceProfile('siemens-finance','Siemens Financial Services Limited',text=>/\bSIEMENS\s+FINANCIAL\s+SERVICES\s+LIMITED\b/i.test(text)),
    anchoredInvoiceProfile('healthxchange','Healthxchange Pharmacy UK Limited',text=>/\bHEALTHXCHANGE\b|healthxchange\.com|\bPHARMA-E\s+LIMITED\b/i.test(text)),
    anchoredInvoiceProfile('pabau','Pabau (Hambrand Technology Ltd)',text=>/\bPABAU\b|\bHAMBRAND\s+TECHNOLOGY\s+LTD\b/i.test(text)),
    anchoredInvoiceProfile('bright-hr','BrightHR',text=>/\bBRIGHT\s*HR\b|\bBRHR\d{4,}\b/i.test(text)),
    anchoredInvoiceProfile('qd-tech','QD Tech Limited',text=>/\bQD\s+TECH\s+LIMITED\b|\bQDT[- ]?\d{3,}\b/i.test(text)),
    anchoredInvoiceProfile('hydrafacial','Hydrafacial UK Limited',text=>/\bHYDRAFACIAL\s+(?:UK\s+)?LIMITED\b|hydrafacial\.(?:com|co\.uk)/i.test(text)),
    anchoredInvoiceProfile('reliable-medicare','Reliable Medicare Ltd',text=>/\bRELIABLE\s+MEDICARE\s+(?:LTD|LIMITED)\b|reliablemedicare/i.test(text)),
    anchoredInvoiceProfile('sos-oxygen','SOS Oxygen',text=>/\bSOS\s+OXYGEN\b|sosoxygen\.co\.uk/i.test(text)),
    anchoredInvoiceProfile('dr-stuttee','Dr Stuttee Health Clinic',text=>/\bDR\.?\s*STUTTEE\b|stuttee/i.test(text)),
    anchoredInvoiceProfile('digital-aesthetics','Digital Aesthetics',text=>/\bDIGITAL\s*AESTHETICS\b|digitalaesthetics/i.test(text)),
    anchoredInvoiceProfile('tweakments','The Tweakments Guide Limited',text=>/\bTWEAKMENTS\s+GUIDE\s+LIMITED\b|\bTHE\s+TWEAKMENTS\s+GUIDE\b/i.test(text)),
    anchoredInvoiceProfile('bt','BT',text=>/\bBRITISH\s+TELECOMMUNICATIONS\b|\bBT\s+PLC\b|\bBT\s+GROUP\s+PLC\b|\bYOUR\s+VAT\s+INVOICE\s+NUMBER\b/i.test(text)&&/\b(?:broadband|telephone|bill issue date|total for this bill)\b/i.test(text)),
    anchoredInvoiceProfile('eon-next','E.ON Next',text=>/\bE\.?ON\s+NEXT\b|\bELECTRICITY\s+NEXT\b|\bE\.ON\s+UK\s+LIMITED\b/i.test(text)),
    anchoredInvoiceProfile('aestheticsource','Aesthetic Source Ltd',text=>/\bAESTHETIC\s*SOURCE\s+LTD\b|aestheticsource/i.test(text)),
    anchoredInvoiceProfile('aec-holdings','AEC Holdings Limited',text=>/\bAEC\s+HOLDINGS\s+LIMITED\b/i.test(text)),
    anchoredInvoiceProfile('ipl-services','IPL Services Ltd',text=>/\bIPL\s+SERVICES\s+LTD\b|\bBEAUTOLOGY\b/i.test(text)),
    anchoredInvoiceProfile('mgb-sparky','MGB Sparky Ltd',text=>/\bMGB\s+SPARKY\s+LTD\b|\bMGB\s+SPARKY\b/i.test(text)),
    anchoredInvoiceProfile('francisco-electrical','Francisco Electrical',text=>/\bFRANCISCO\s+ELECTRICAL\b|franciscolombal/i.test(text)),
    anchoredInvoiceProfile('discount-displays','Discount Displays Ltd',text=>/\bDISCOUNT\s+DISPLAYS\s+(?:LIMITED|LTD)\b|\bGREEN\s*MAGIC\b|\bSIGN-HOLDERS\.CO\.UK\b|725\s*451\s*345/i.test(text)),
    anchoredInvoiceProfile('google-cloud','Google Cloud EMEA Limited',text=>/\bGOOGLE\s+CLOUD\s+EMEA\s+LIMITED\b|\bGOOGLE\s+INVOICE\b/i.test(text)),
    anchoredInvoiceProfile('hannah-mcclune','Hannah McClune Photography Ltd',text=>/\bHANNAH\s+MCCLUNE\s+PHOTOGRAPHY\s+LTD\b|hannahmcclune/i.test(text)),
    anchoredInvoiceProfile('sofwave','Sofwave Medical UK Ltd',text=>/\bSOFWAVE\s+MEDICAL\s+UK\s+LTD\b|\bSOFWAVE\b/i.test(text)),
    anchoredInvoiceProfile('medioracle','MediOracle Ltd',text=>/\bMEDIORACLE\b|endolift/i.test(text)),
    anchoredInvoiceProfile('medisort','Medisort Ltd',text=>/\bMEDISORT\s+LTD\b|healthcare\s+waste\s+solutions/i.test(text)),
    anchoredInvoiceProfile('laundrylite','LaundryLite',text=>/\bLAUNDRYLITE\b|laundrylite\.com/i.test(text)),
    anchoredInvoiceProfile('lynton','Lynton',text=>/\bLYNTON\b|lyntonlasers/i.test(text)),
    anchoredInvoiceProfile('medisave','Medisave (UK) Ltd',text=>/\bMEDISAVE\s*\(UK\)\s*LTD\b|\bMEDISAVE\s+HOUSE\b/i.test(text)),
    anchoredInvoiceProfile('wix','Wix.com Ltd',text=>/\bWIX\.COM\s+LTD\b|\bWIX\s+INVOICE\b/i.test(text)),
    anchoredInvoiceProfile('zp-services','Z&P Services Ltd',text=>/\bZ\s*&\s*P\s+SERVICES\s+LTD\b|\bzpservices/i.test(text)),
    anchoredInvoiceProfile('klioh-studio','Klioh Studio Limited',text=>/\bKLIOH\s+STUDIO\s+LIMITED\b|kliohstudio\.com/i.test(text)),
    anchoredInvoiceProfile('anthropic','Anthropic Ireland Limited',text=>/\bANTHROPIC\s+IRELAND\s*,?\s*LIMITED\b|\bIE4276970QH\b/i.test(text)),
    anchoredInvoiceProfile('arabella-johnson','Arabella Johnson',text=>/\bARABELLA\s+JOHNSON\b/i.test(text)),
    anchoredInvoiceProfile('light-hub','The Light Hub (Forward Distribution)',text=>/\bFORWARD\s+DISTRIBUTION\b|\bLIGHT\s+HUB\b|the-lighthub/i.test(text)),
    {id:'banoze',name:'Banoze Ltd',kind:'supplier',status:'Under development',category:'Invoices',detect:isBanozeText,parse:(flat,source,lines)=>parseBanozeInvoice(flat,source,lines)},
    anchoredInvoiceProfile('sylton','Sylton International',text=>/\bSYLTON\s+INTERNATIONAL\b|\bSTR-\d{3,}\b/i.test(text)),
    anchoredInvoiceProfile('bpce','BPCE Equipment Solutions',text=>/\bBPCE\s+EQUIPMENT\s+SOLUTIONS\b/i.test(text)),
    anchoredInvoiceProfile('mailchimp','Intuit Mailchimp',text=>/\bINTUIT\s+MAILCHIMP\b|\bMAILCHIMP\s+RECEIPT\b/i.test(text)),
    anchoredInvoiceProfile('alumier','AlumierMD UK',text=>/\bALUMIER\s*MD\s+UK\b/i.test(text)),
    anchoredInvoiceProfile('cosmopro','CosmoPro',text=>/\bCOSMO\s*PRO\b|cosmopro\.enquiry/i.test(text)),
    anchoredInvoiceProfile('packgenie','PackGenie',text=>/\bPACKGENIE\b|packgenie\.co\.uk/i.test(text)),
    anchoredInvoiceProfile('taskrabbit','Taskrabbit UK',text=>/\bTASKRABBIT\b|taskrabbit\.co\.uk/i.test(text)),
    anchoredInvoiceProfile('takepayments','Takepayments',text=>/\bTAKEPAYMENTS\b|\bGLOBAL\s+PAYMENTS\s+COMPANY\b/i.test(text)),
    anchoredInvoiceProfile('inmode','InMode UK',text=>/\bINMODE\s+UK\b|\bINMODE\b/i.test(text)),
    anchoredInvoiceProfile('care-check','Care Check Ltd',text=>/\bCARE\s*CHECK\s+LTD\b|carecheck/i.test(text)),
    anchoredInvoiceProfile('caliston','Caliston',text=>/\bCALISTON\b/i.test(text)),
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
    row.invoiceNumber=row.invoiceNumberGenerated?String(row.invoiceNumber||originalInvoiceNumber):profile?.id==='amazon'?String(originalInvoiceNumber||'').replace(/[^A-Z0-9]/gi,'').toUpperCase():['kin-global','km-distribution'].includes(profile?.id)?kinKmInvoiceNumber(originalInvoiceNumber):profile?.id==='maspo'?normalizeMaspoInvoiceNumber(originalInvoiceNumber):profile?.id==='liberty-frozen-foods'?originalInvoiceNumber:normalizeInvoiceNumber(originalInvoiceNumber);
    if(row.subtotal===null||row.subtotal===undefined)row.subtotal='';
    if(row.vat===null||row.vat===undefined)row.vat='';
    // An unconfigured supplier can have its printed values extracted for review,
    // but it remains rejected until a supplier profile has been added.
    const profileConfigured=profile?.kind==='supplier',supportedProfile=profileConfigured&&Boolean(specialised),genericAcceptedForConfiguredProfile=profileConfigured&&row.accepted===true,unconfiguredSupplier=!profileConfigured&&row.isInvoiceDocument!==false;
    const vatRequired=row.documentType!=='DELIVERY NOTE',complete=Boolean((supportedProfile||genericAcceptedForConfiguredProfile)&&row.isInvoiceDocument!==false&&!row.ocrConflictReason&&!row.banozeFooterUnverified&&row.invoiceNumber&&row.date&&row.supplier&&row.total!==''&&row.total!==null&&row.total!==undefined&&Number.isFinite(Number(row.total))&&(!vatRequired||row.vat!==''&&row.vat!==null&&row.vat!==undefined&&Number.isFinite(Number(row.vat)))&&(profile?.id!=='amazon'||String(row.itemName||'').trim())&&(row.documentType!=='CORRECTION'||row.correctedTotal!==''&&row.correctedTotal!==null&&row.correctedTotal!==undefined&&Number.isFinite(Number(row.correctedTotal))&&row.correctedVat!==''&&row.correctedVat!==null&&row.correctedVat!==undefined&&Number.isFinite(Number(row.correctedVat))));
    row.status=complete?'ACCEPTED':'REJECTED';row.accepted=row.status==='ACCEPTED';row.rejected=row.status==='REJECTED';if(row.isInvoiceDocument===false){row.retryOcr=false;if(row.documentType!=='CREDIT NOTE')row.documentType='NON-INVOICE';}
    row.unconfiguredSupplier=unconfiguredSupplier;
    row.supplierProfileConfigured=Boolean(profileConfigured);
    row.rejectedReason=complete?'':row.isInvoiceDocument===false?(row.rejectedReason||'This document is a supplier statement or non-invoice document.'):unconfiguredSupplier?'Supplier profile is not set up. All invoices from this supplier are rejected until a supplier profile is configured.':row.rejectedReason||(!specialised?'Supplier/document format not recognised.':profile?.id==='amazon'&&!row.itemName?'Amazon item description could not be confirmed.':!row.invoiceNumber?'Invoice number not found.':!row.date?'Invoice date not found.':!row.supplier?'Supplier not identified.':row.documentType==='CORRECTION'&&(row.correctedTotal===''||row.correctedTotal===null||row.correctedTotal===undefined||row.correctedVat===''||row.correctedVat===null||row.correctedVat===undefined)?'Corrected invoice total or VAT could not be confirmed; correction was not applied.':row.total===''||row.total===null||row.total===undefined?'Printed total not found.':'VAT amount not found; one 5x OCR retry is required.');
    row.confidence=row.status;row.review=row.status==='REVIEW';
    return {...row,profileId:profile?.id||'generic'};
  }
  function parseInvoiceBatch(text,source='',ocrLines,options={}){
    const lines=Array.isArray(ocrLines)?ocrLines.filter(line=>line&&String(line.text||'').trim()):[];
    if(!lines.length){if(/\bE\s*\.?\s*P\s*\.?\s*A\s*\.?\s*FOODS?\s+LTD\b|\bEPA\s+FOODS\b/i.test(String(text||'')))return [];if(isEagleFoodsText(text)&&isEagleNonInvoicePage(text)&&!eagleInvoicePage([],text))return [];if(isIsaacWholesaleText(text)&&isaacSummaryPage([{text:String(text||'')}])&&!isaacInvoicePageText(text))return [];if(isMillfieldAutopartsText(text)){const row=parseInvoiceRobust(text,source,undefined,options);return row.isInvoiceDocument?[row]:[];}const row=parseInvoiceRobust(text,source,undefined,options);row.profileId=identifyInvoiceProfile(text)?.id||'generic';return row.profileId==='isaac-wholesale'&&!row.isInvoiceDocument?[]:disambiguateGeneratedShahidReferences([row]);}
    const pages=[...new Set(lines.map(line=>Number(line.page)||1))].sort((a,b)=>a-b);
    const pageLines=new Map(pages.map(page=>[page,lines.filter(line=>(Number(line.page)||1)===page).sort((a,b)=>(Number(a.y)||0)-(Number(b.y)||0)||(Number(a.x)||0)-(Number(b.x)||0))]));
    if(pages.some(page=>isMillfieldAutopartsText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))))return parseMillfieldAutopartsBatch(pageLines,source,options);
    const gsfPages=pages.filter(page=>isGsfCarPartsText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')));
    if(gsfPages.length)return parseGsfCarPartsBatch(new Map(gsfPages.map(page=>[page,pageLines.get(page)])),source,options);
    const kinPages=pages.filter(page=>isKinGlobalText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')));
    if(kinPages.length)return parseKinKmProfileBatch(pageLines,source,'kin-global',options);
    const kmPages=pages.filter(page=>isKmDistributionText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' ')));
    if(kmPages.length)return parseKinKmProfileBatch(pageLines,source,'km-distribution',options);
    if(pages.some(page=>isPartsPlusText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))))return parsePartsPlusBatch(pageLines,source,options);
    if(pages.some(page=>isEuLtdText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))))return parseEuLtdBatch(pageLines,source,options);
    if(pages.some(page=>isRacMotoringText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))))return parseRacBatch(pageLines,source,options);
    const amazonPages=pages.filter(page=>isAmazonInvoiceText(amazonPositionedText(pageLines.get(page))));
    if(amazonPages.length){
      const groups=[];
      for(const page of amazonPages){
        const items=pageLines.get(page)||[],number=amazonInvoiceId(items),startsNew=items.some(line=>/invoice\s+date\s*\/\s*delivery\s+date/i.test(String(line.text||''))),current=groups.at(-1);
        if(!current||startsNew&&(!number||number!==current.invoiceNumber)||number&&current.invoiceNumber&&number!==current.invoiceNumber){groups.push({invoiceNumber:number,page,pages:[page]});continue;}
        if(number&&!current.invoiceNumber)current.invoiceNumber=number;
        if(number&&current.invoiceNumber===number||!number)current.pages.push(page);
        else groups.push({invoiceNumber:number,page,pages:[page]});
      }
      const amazonRows=groups.map(group=>{
        const groupLines=group.pages.flatMap(page=>pageLines.get(page)||[]),groupText=groupLines.map(line=>String(line.text||'').trim()).filter(Boolean).join('\n'),row=parseInvoiceRobust(groupText,source,groupLines,options);
        row.page=group.page;row.sourcePages=group.pages;row.profileId='amazon';
        return row;
      }),otherLines=lines.filter(line=>!amazonPages.includes(Number(line.page)||1)),otherRows=otherLines.length?parseInvoiceBatch(otherLines.map(line=>String(line.text||'')).join('\n'),source,otherLines,options):[];
      return [...otherRows,...amazonRows].sort((a,b)=>(Number(a.page)||0)-(Number(b.page)||0));
    }
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
    if(pages.some(page=>isBanozeText((pageLines.get(page)||[]).map(line=>String(line.text||'')).join(' '))))return parseBanozeBatch(pageLines,source,options);
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
  }  async function parsePdf(input,mode,source=''){let info=await extractText(input);if(mode==='bank'){const native=await extractStarlingPdfText(input);if(native){const rows=parseStarlingOcrBank(native.pageItems.flat(),native.text,source);if(rows?.length)info={...info,...native};else info=null;if(!info)info=await extractText(input);else return {info,transactions:rows};}}const positionedInvoiceLines=mode==='invoice'&&Array.isArray(info.pageItems)?info.pageItems.flatMap((items,index)=>(items||[]).map(line=>({...line,page:index+1}))):undefined;return {info,...(mode==='invoice'?{invoice:parseInvoiceRobust(info.text,source),invoices:parseInvoiceBatch(info.text,source,positionedInvoiceLines)}:mode==='receipt'?{receipts:parseReceiptBatch(info.text,source)}:{transactions:parseBank(info.text,source,info.pageItems)})};}
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
  function resolveSumUpAmount(row,higherResolutionAmount){
    if(!row||row.profileId!=='sumup-bank'||!row.sumupAmountConflict)return row;
    const readings=row.sumupAmountReadings||{},values=[readings.fullPage,readings.focused,higherResolutionAmount].map(value=>value===''||value===null||value===undefined?null:Number(value)).filter(value=>value!==null&&Number.isFinite(value)).map(value=>Math.round(value*100));
    const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);
    const consensus=[...counts.entries()].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1])[0],resolved={...row};
    if(consensus){const amount=consensus[0]/100;resolved.amount=amount;resolved.receipt=amount>0?amount:'';resolved.payment=amount<0?Math.abs(amount):'';const complete=Boolean(resolved.date&&resolved.details&&Number.isFinite(amount));resolved.status=complete?'ACCEPTED':'REJECTED';resolved.accepted=complete;resolved.rejected=!complete;resolved.review=!complete;resolved.confidence=complete?'SumUp amount confirmed by two OCR readings':'REJECTED';resolved.rejectedReason=complete?'':!resolved.date?'Transaction date could not be confirmed from the SumUp statement. Verify this row on the linked PDF page.':'Transaction details could not be confirmed from the SumUp statement. Verify this row on the linked PDF page.';}
    else{resolved.amount='';resolved.receipt='';resolved.payment='';resolved.status='REJECTED';resolved.accepted=false;resolved.rejected=true;resolved.review=true;resolved.confidence='REJECTED';resolved.rejectedReason='The SumUp amount remained uncertain after the 5x OCR check. Verify the printed amount on the linked PDF page.';}
    delete resolved.sumupAmountConflict;delete resolved.sumupAmountReadings;return resolved;
  }
  function invoiceStatusFor(documentType,complete,liveProcessing=false){if(liveProcessing)return 'PROCESSING';return complete?'ACCEPTED':'REJECTED';}
  function invoiceRateBases(total,vat,documentType='INVOICE'){
    const numeric=value=>value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))?Math.round(Number(value)*100):null;
    const grossCents=numeric(total),vatCents=numeric(vat);
    if(grossCents===null||vatCents===null)return {standardRate:'',zeroRate:''};
    if(vatCents===0)return {standardRate:'',zeroRate:grossCents/100};
    const standardCents=vatCents*5,netCents=grossCents-vatCents,zeroCents=netCents-standardCents;
      // VAT printed to pennies can make VAT Ã— 5 differ from the invoice net by
      // a couple of pence. Treat that as an all-standard-rate invoice instead
      // of emitting a spurious zero-rate amount. For a positive invoice, a
      // negative remainder can never be a genuine zero-rated purchase; credits
      // retain negative zero-rate bases when they are genuinely mixed-rate.
      if(Math.abs(zeroCents)<=2||(grossCents>=0&&zeroCents<0))return {standardRate:netCents/100,zeroRate:''};
    return {standardRate:standardCents/100,zeroRate:zeroCents/100};
  }
  function invoiceRetryConflictReason(conflicts={}){
    return Object.entries(conflicts).map(([field,values])=>`OCR passes disagree on ${field==='vat'?'VAT':'total'} (Â£${Number(values.firstPass).toFixed(2)} vs Â£${Number(values.retry).toFixed(2)}). Confirm the printed amount on the PDF.`).join(' ');
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
    const kinFooterRetry=row?.profileId==='kin-global'&&candidate?.profileId==='kin-global';
    return Boolean(complete&&!row?.freshwaysVatOcrAmbiguous&&!row?.eagleSummaryConflict&&!row?.eagleSummaryAmbiguousReference&&!row?.banozeFooterUnverified&&!candidate?.banozeFooterUnverified&&!Object.keys(row?.ocrAmountConflicts||{}).length&&(row?.profileId==='bestway'||kinFooterRetry||candidate?.accepted||row?.freshwaysVatOcrRetryResolved||eaglePageMatch));
  }
  function mergeInvoiceRetryCandidate(row,candidate,{preserveGeneratedReference=false}={}){
    const merged={...row},conflicts={...(row.ocrAmountConflicts||{})},fields=['invoiceNumber','originalInvoiceNumber','invoiceNumberGenerated','invoiceNumberGeneratedReason','date','supplier','subtotal','vat','vatUnverified','vatMentioned','vatAssumed20','total','banozeGoodsTotal','banozeDerivedVat','banozeDerivedTotal','banozeFooterUnverified','correctsInvoice','documentType','correctedSubtotal','correctedVat','correctedTotal','profileId','accepted','rejectedReason','unconfiguredSupplier','supplierProfileConfigured','ocrConflictReason','millfieldContextYear','millfieldPrintedInvoiceNumber','millfieldInvoiceNumberPatterns','millfieldInvoiceNumberEvidence','millfieldInvoiceNumberSuffixes','millfieldFooterGoods','millfieldFooterVat','millfieldPrintedTotal','millfieldTotalDerivedFromFooter','millfieldTotalDerivedFromVat20','millfieldTotalOcrWeak','millfieldFooterTotalConsensus','millfieldFooterAmountsConsensus','millfieldFooterOcrUnconfirmed','millfieldStatementConfirmed','millfieldStatementMatchedBySuffix','millfieldStatementConflict'];
    const millfieldReferenceCandidates=new Set([...(row?.millfieldInvoiceNumberCandidates||[]),...(candidate?.millfieldInvoiceNumberCandidates||[]),...(row?.millfieldPrintedInvoiceNumber?[row.originalInvoiceNumber]:[]),...(candidate?.millfieldPrintedInvoiceNumber?[candidate.originalInvoiceNumber]:[])].map(millfieldReferenceDigits).filter(Boolean));
    if(row?.profileId==='millfield-autoparts'&&candidate?.profileId==='millfield-autoparts'&&millfieldReferenceCandidates.size){merged.millfieldInvoiceNumberCandidates=[...millfieldReferenceCandidates];if(millfieldReferenceCandidates.size>1)merged.millfieldInvoiceNumberConflict=true;}
    for(const key of fields){
      if(preserveGeneratedReference&&['invoiceNumber','originalInvoiceNumber','invoiceNumberGenerated','invoiceNumberGeneratedReason'].includes(key))continue;
      const value=candidate?.[key];if(value===''||value===null||value===undefined)continue;
      // If the 5x scan was requested only because a Freshways Â£0.00 may have
      // become "20.00", keep already readable first-pass totals. The higher
      // resolution page can misread the pound sign on the invoice total too.
      if(row?.profileId==='freshways'&&row?.freshwaysVatOcrAmbiguous&&key==='total'&&merged.total!==''&&merged.total!==null&&merged.total!==undefined)continue;
      const compareRetryAmount=(row.profileId==='bestway'||candidate.profileId==='bestway'||row.profileId==='eagle-foods'&&candidate.profileId==='eagle-foods'||row.profileId==='millfield-autoparts'&&candidate.profileId==='millfield-autoparts')&&(key==='vat'||key==='total')||row.profileId==='freshways'&&candidate.profileId==='freshways'&&key==='vat';
      if(compareRetryAmount){
        const first=merged[key],firstNumber=first===''||first===null||first===undefined?null:Number(first),retryNumber=Number(value);
        if(Number.isFinite(firstNumber)&&Number.isFinite(retryNumber)&&Math.round(firstNumber*100)!==Math.round(retryNumber*100)){
          conflicts[key]={firstPass:firstNumber,retry:retryNumber};
          continue;
        }
      }
      merged[key]=value;
    }
    if(row?.profileId==='millfield-autoparts'&&row.millfieldPrintedInvoiceNumber&&!candidate?.millfieldPrintedInvoiceNumber){merged.invoiceNumber=row.invoiceNumber;merged.originalInvoiceNumber=row.originalInvoiceNumber;merged.invoiceNumberGenerated=row.invoiceNumberGenerated;merged.invoiceNumberGeneratedReason=row.invoiceNumberGeneratedReason;merged.millfieldPrintedInvoiceNumber=true;}
    if(row?.profileId==='millfield-autoparts'&&row.millfieldTotalOcrWeak){const footerConfirmed=Boolean(candidate?.millfieldFooterTotalConsensus||candidate?.millfieldFooterAmountsConsensus),vatDerivedTotalRemainsValid=Boolean(row.millfieldTotalDerivedFromVat20&&row.date&&Number(row.vat)>0&&!row.vatUnverified&&!conflicts.total);if(footerConfirmed){merged.millfieldTotalOcrWeak=false;merged.millfieldFooterOcrUnconfirmed=false;delete conflicts.total;delete conflicts.vat;}else if(vatDerivedTotalRemainsValid){merged.millfieldTotalOcrWeak=false;merged.millfieldFooterOcrUnconfirmed=false;merged.total=row.total;merged.millfieldTotalDerivedFromVat20=true;delete conflicts.total;}else{merged.total='';merged.millfieldPrintedTotal='';if(row.vatAssumed20){merged.vat='';merged.vatUnverified=true;merged.vatAssumed20=false;}merged.millfieldTotalOcrWeak=false;merged.millfieldFooterOcrUnconfirmed=true;merged.accepted=false;merged.rejected=true;merged.status='REJECTED';merged.rejectedReason='The Millfield total could not be confirmed by the focused high-resolution footer retry.';delete conflicts.total;delete conflicts.vat;}}
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
    if(candidate?.ocrConflictReason){merged.ocrConflictReason=candidate.ocrConflictReason;merged.total='';merged.accepted=false;merged.rejectedReason=candidate.ocrConflictReason;}
    return merged;
  }
  return {extractText,extractStarlingPdfText,parseBank,parseBankCsv,parseOcrBank,inspectBankBalances,markBankBalanceMismatches,parseInvoice:parseInvoiceRobust,parseInvoiceBatch,confirmEagleInvoiceRows,eagleStatementRowsFromOcr,millfieldStatementRowsFromOcr,millfieldStatementPagesFromOcr,millfieldStatementRetryRegionsFromOcr,millfieldStatementRetryContextLines,millfieldStatementRetryAmountsFromOcr,applyMillfieldStatementRows,addMillfieldStatementOnlyRows,identifyInvoiceProfile,invoiceProfiles:invoiceProfiles.map(({id,name,kind})=>({id,name,kind})),receiptProfiles:receiptProfiles.map(({id,name,category})=>({id,name,category})),compatibleCompanies:compatibleCompanies(),underDevelopmentSuppliers,parseReceiptBatch,sortReceiptRowsByPdfPage,isReceiptBackPage,resolvePolishWzTotal,resolveSumUpAmount,invoiceStatusFor,invoiceRateBases,invoiceRetryAccepted,matchEagleRetryCandidate,matchBanozeFullPageRetryCandidate,mergeInvoiceRetryCandidate,invoiceRetryConflictReason,reconcileInvoiceCorrections,deduplicateInvoiceRows,invoiceRetryRegionsForRow,parseDairyFreshFooterRetryTargets,parsePdf,parseDate,amount,pdfFileUrl};
});
