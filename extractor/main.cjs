'use strict';
const {app,BrowserWindow,protocol,session,Menu,dialog,ipcMain}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const {execFile,spawn}=require('node:child_process');
const crypto=require('node:crypto');
const {readWorkspaceProfilesSync,workspaceDirectory,createWorkspace}=require('./workspaces.cjs');
let publishNetworkBootstrap=()=>({updated:false});
try{publishNetworkBootstrap=require('./network-bootstrap.cjs').publishNetworkBootstrap;}
catch(error){if(error?.code!=='MODULE_NOT_FOUND'||!String(error?.message||'').startsWith("Cannot find module './network-bootstrap.cjs'"))throw error;}

// The executable in the shared network package is a click-to-launch bootstrap.
// It refreshes the shared application files from GitHub, then runs that shared
// application with a per-user Electron runtime and workspace data.
const networkPackageDirectory=path.dirname(process.execPath);
const networkBuildFile=path.join(networkPackageDirectory,'network-build.txt');
const bootstrapRefresh=publishNetworkBootstrap({
  packaged:app.isPackaged,
  sharedApplication:process.env.FARE_EXTRACTOR_SHARED_APP,
  applicationDirectory:__dirname,
  sourceFile:__filename
});
if(bootstrapRefresh.error)console.warn(`Could not refresh the network click-to-launch bootstrap: ${bootstrapRefresh.error}`);

if(app.isPackaged&&fsSync.existsSync(networkBuildFile)){
  app.whenReady().then(()=>{
    const splash=new BrowserWindow({width:460,height:205,resizable:false,show:true,autoHideMenuBar:true,title:'Extractor',backgroundColor:'#f4f7f4',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f7f4;color:#173331;font:14px Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh}.card{width:340px}.brand{font-size:12px;font-weight:700;letter-spacing:.12em;color:#08796c}.title{font-size:20px;font-weight:700;margin:12px 0 7px}.copy{color:#60736d;line-height:1.5;min-height:42px}.track{height:7px;margin-top:22px;border-radius:8px;background:#dcebe5;overflow:hidden}.bar{height:100%;width:35%;border-radius:8px;background:#0d8276;animation:move 1.4s ease-in-out infinite alternate}@keyframes move{to{transform:translateX(180px)}}</style><main class="card"><div class="brand">R&amp;W ACCOUNTANTS</div><div class="title" id="title">Checking shared updates</div><div class="copy" id="copy">Checking GitHub and preparing the latest shared application files.</div><div class="track"><div class="bar"></div></div></main>';
    splash.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));

    const launcher=path.join(networkPackageDirectory,'Start Extractor from Network.cmd');
    if(!fsSync.existsSync(launcher)){
      dialog.showErrorBox('Unable to start Extractor','The shared Extractor package is incomplete. Ask your administrator to replace it with the full network package.');
      app.exit(1);
      return;
    }
    let output='';
    let finished=false;
    let splashReady=false;
    let updateNoticeReceived=false;
    let waitNoticeReceived=false;
    const showUpdateNotice=()=>{
      if(!splashReady||!updateNoticeReceived)return;
      splash.webContents.executeJavaScript("document.getElementById('title').textContent='Applying update';document.getElementById('copy').textContent='An update is ready. Extractor will restart automatically to apply it.'").catch(()=>{});
    };
    const showWaitNotice=()=>{
      if(!splashReady||!waitNoticeReceived||updateNoticeReceived)return;
      splash.webContents.executeJavaScript("document.getElementById('title').textContent='Update in progress';document.getElementById('copy').textContent='Open workspaces are moving to the update screen and will reopen automatically when the shared application is ready.'").catch(()=>{});
    };
    splash.webContents.once('did-finish-load',()=>{splashReady=true;showWaitNotice();showUpdateNotice();});
    const fail=message=>{
      if(finished)return;
      finished=true;
      dialog.showErrorBox('Unable to start Extractor',String(message||'The local application could not be prepared. Check that the shared folder is available and that you have read access.').slice(-4000));
      splash.close();
      app.exit(1);
    };
    // Use the same entry point as the working CMD shortcut. It maps UNC shares
    // with pushd and clears Electron's run-as-Node flag before starting the
    // local runtime. Suppress the batch file's interactive pause so bootstrap
    // failures can be shown in this window instead of waiting invisibly.
    const child=spawn(process.env.ComSpec||'cmd.exe',['/d','/c','call',launcher],{
      cwd:networkPackageDirectory,
      windowsHide:true,
      stdio:['ignore','pipe','pipe'],
      env:{...process.env,FARE_EXTRACTOR_BOOTSTRAP:'1'}
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output=(output+chunk).slice(-4000);if(output.includes('EXTRACTOR_UPDATE_WAIT_NOTICE:')){waitNoticeReceived=true;showWaitNotice();}if(output.includes('EXTRACTOR_UPDATE_RESET_NOTICE:')){updateNoticeReceived=true;showUpdateNotice();}});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{output=(output+chunk).slice(-4000);});
    child.once('error',error=>fail(error.message));
    child.once('close',code=>{
      if(finished)return;
      if(code===0){finished=true;app.exit(0);return;}
      fail(output.trim()||`The setup process stopped with exit code ${code===null?'unknown':code}.`);
    });
  }).catch(error=>{
    dialog.showErrorBox('Unable to start Extractor',error.message);
    app.exit(1);
  });
  app.on('window-all-closed',()=>app.quit());
  return;
}

if(process.env.FARE_EXTRACTOR_SCHEME_REGISTERED!=='1')protocol.registerSchemesAsPrivileged([{scheme:'fareextractor',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('R&W Accountants Extractor');
const profileRoot=path.resolve(process.env.FARE_EXTRACTOR_PROFILE_ROOT||path.join(app.getPath('appData'),'Extractor','Profiles'));
const workspaceArgument=process.argv.find(argument=>argument.startsWith('--workspace='));
const requestedWorkspaceId=workspaceArgument?.slice('--workspace='.length)||'';
const sharedApplicationDirectory=process.env.FARE_EXTRACTOR_SHARED_APP||'';
const sharedNetworkRoot=sharedApplicationDirectory?path.resolve(sharedApplicationDirectory,'..','..'):'';
const sharedUpdatePendingPath=sharedNetworkRoot?path.join(sharedNetworkRoot,'.extractor-update.pending'):'';
const workspaceProfiles=readWorkspaceProfilesSync(profileRoot);
const activeWorkspace=workspaceProfiles.find(profile=>profile.id===requestedWorkspaceId)||null;
const dataDirectory=activeWorkspace?workspaceDirectory(profileRoot,activeWorkspace.id):path.join(profileRoot,'_login');
fsSync.mkdirSync(dataDirectory,{recursive:true});app.setPath('userData',dataDirectory);
if(!app.requestSingleInstanceLock()){app.quit();return;}
let mainWindow;
app.on('second-instance',()=>{if(!mainWindow)return;if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();});
function relaunchWorkspace(workspaceId=''){
  const args=process.argv.slice(1).filter(argument=>!argument.startsWith('--workspace='));
  if(workspaceId)args.push(`--workspace=${workspaceId}`);
  app.relaunch({args});app.exit(0);
}
ipcMain.handle('workspace-list',()=>readWorkspaceProfilesSync(profileRoot).map(({id,username,createdAt})=>({id,username,createdAt})));
ipcMain.handle('app-build-info',()=>{
  const appDirectory=process.env.FARE_EXTRACTOR_SHARED_APP||__dirname;
  let version=app.getVersion(),buildId='',commit='';
  try{version=String(JSON.parse(fsSync.readFileSync(path.join(appDirectory,'package.json'),'utf8')).version||version);}catch{}
  try{const buildInfo=JSON.parse(fsSync.readFileSync(path.join(appDirectory,'build-info.json'),'utf8'));buildId=String(buildInfo.buildId||'');commit=String(buildInfo.commit||'');}catch{}
  return {version,buildId,commit};
});
ipcMain.handle('workspace-current',()=>activeWorkspace?{id:activeWorkspace.id,username:activeWorkspace.username}:null);
ipcMain.handle('workspace-create',async(_event,value)=>{const profile=await createWorkspace(profileRoot,value);return {id:profile.id,username:profile.username};});
ipcMain.handle('workspace-open',(_event,id)=>{
  if(!readWorkspaceProfilesSync(profileRoot).some(profile=>profile.id===id))throw new Error('That workspace could not be found. Refresh the list and try again.');
  relaunchWorkspace(id);return {ok:true};
});
ipcMain.handle('workspace-logout',()=>{relaunchWorkspace();return {ok:true};});
ipcMain.handle('network-update-prepare',async(event,state)=>{
  if(!mainWindow||event.sender!==mainWindow.webContents)throw new Error('The Extractor workspace could not be verified for update handoff.');
  const serialized=JSON.stringify({version:1,savedAt:new Date().toISOString(),state:state&&typeof state==='object'?state:{}});
  if(Buffer.byteLength(serialized,'utf8')>100*1024*1024)throw new Error('This workspace is too large to save for the update.');
  const recoveryPath=path.join(dataDirectory,'network-update-state.json'),temporaryPath=`${recoveryPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  await fs.writeFile(temporaryPath,serialized,{encoding:'utf8',flag:'wx'});
  await fs.rm(recoveryPath,{force:true});
  await fs.rename(temporaryPath,recoveryPath);
  relaunchWorkspace(activeWorkspace?.id||'');
  return {ok:true};
});
ipcMain.handle('network-update-take-state',async()=>{
  const recoveryPath=path.join(dataDirectory,'network-update-state.json');
  try{
    const saved=JSON.parse(await fs.readFile(recoveryPath,'utf8'));
    await fs.rm(recoveryPath,{force:true});
    return saved?.version===1&&saved.state&&typeof saved.state==='object'?saved.state:null;
  }catch(error){if(error?.code!=='ENOENT')console.warn(`Could not restore workspace after a network update: ${error.message}`);return null;}
});
ipcMain.handle('ocr-pdf',async(_event,payload)=>{
  const filePath=typeof payload==='string'?payload:payload?.filePath;
  const password=typeof payload==='object'&&typeof payload?.password==='string'?payload.password:'';
  const scale=typeof payload==='object'&&Number.isFinite(Number(payload?.scale))?Math.min(5,Math.max(1.5,Number(payload.scale))):2.5;
  const pages=typeof payload==='object'&&Array.isArray(payload?.pages)?payload.pages.map(Number).filter(page=>Number.isInteger(page)&&page>0):[];
  const bankRetryRegions=typeof payload==='object'&&Array.isArray(payload?.bankRetryRegions)?payload.bankRetryRegions.map(region=>({page:Number(region?.page),top:Number(region?.top),bottom:Number(region?.bottom)})).filter(region=>Number.isInteger(region.page)&&region.page>0&&Number.isFinite(region.top)&&Number.isFinite(region.bottom)&&region.top>=0&&region.bottom>region.top):[];
  const focusPages=typeof payload==='object'&&Array.isArray(payload?.focusPages)?payload.focusPages.map(Number).filter(page=>Number.isInteger(page)&&page>0):[];
  const dairyFooterRows=typeof payload==='object'&&Array.isArray(payload?.dairyFooterRows)?payload.dairyFooterRows.map(row=>({page:Number(row?.page),vatY:Number(row?.vatY),totalY:Number(row?.totalY)})).filter(row=>Number.isInteger(row.page)&&row.page>0&&Number.isFinite(row.vatY)&&Number.isFinite(row.totalY)&&row.vatY>0&&row.totalY>row.vatY):[];
  if(typeof filePath!=='string'||path.extname(filePath).toLowerCase()!=='.pdf')throw new Error('OCR accepts PDF files only.');
  const resolved=path.resolve(filePath);if(!fsSync.existsSync(resolved))throw new Error('The selected PDF could not be found.');
  // Windows PDF/OCR APIs do not reliably read PDFs directly from shared or
  // mapped folders. Give every request an isolated local copy before calling
  // those APIs, while retaining `resolved` for progress events and source links.
  const tempDirectory=path.join(app.getPath('temp'),`extractor-ocr-${crypto.randomBytes(8).toString('hex')}`);
  const localCopy=path.join(tempDirectory,'source.pdf');
  let encrypted=false;
  const runCopyHelper=async(outputDirectory)=>await new Promise((resolve,reject)=>{
    const copyHelper=path.join(__dirname,'copy-helper.ps1');
    execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',copyHelper,'-Path',localCopy,'-OutputDirectory',outputDirectory,'-Password',password,'-Scale',String(scale)],{windowsHide:true,maxBuffer:8*1024*1024,timeout:480000},(error,stdout,stderr)=>{
      let result;try{result=JSON.parse(String(stdout).trim().split(/\r?\n/).filter(Boolean).at(-1)||'{}');}catch{}
      if(error||!result?.ok){const detail=result?.error||stderr||error?.message||'Windows could not render the protected PDF.';reject(new Error(encrypted?`Could not open the protected PDF. Check that its password is correct. (${detail})`:detail));return;}
      resolve(result);
    });
  });
  try{
    await fs.mkdir(tempDirectory,{recursive:true});
    await fs.copyFile(resolved,localCopy);
    const header=fsSync.readFileSync(localCopy).toString('latin1');encrypted=/\/Encrypt\b/.test(header);
    if(encrypted&&!password)throw new Error('This PDF is password-protected. Enter the password supplied with the bank statement and try again.');
    let ocrPath=localCopy,ocrPassword=password;
    if(encrypted){
      const rendered=await runCopyHelper(tempDirectory),readableCopy=path.join(tempDirectory,'readable-copy.pdf');
      await fs.writeFile(readableCopy,buildImagePdf(rendered.pages));
      ocrPath=readableCopy;ocrPassword='';
    }
    const helper=path.join(__dirname,'ocr-helper.ps1');
    const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',ocrPath,'-Password',ocrPassword,'-Scale',String(scale)];if(pages.length)args.push('-PageList',pages.join(','));if(focusPages.length)args.push('-FocusPageList',focusPages.join(','));if(dairyFooterRows.length)args.push('-DairyFooterRows',JSON.stringify(dairyFooterRows));if(bankRetryRegions.length)args.push('-BankRetryRegions',JSON.stringify(bankRetryRegions));
    return await new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let buffer='',parsedResult=null,stderr='';
      const consume=line=>{const value=String(line||'').trim();if(!value)return;if(value.startsWith('PAGE:')){try{mainWindow?.webContents.send('ocr-progress',{requestId:payload?.requestId,filePath:resolved,...JSON.parse(value.slice(5))});}catch{}return;}try{const parsed=JSON.parse(value);if(typeof parsed?.ok==='boolean')parsedResult=parsed;}catch{}};
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,index));buffer=buffer.slice(index+1);}});
      child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000);});
      let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},480000);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);consume(buffer);if(code!==0||!parsedResult?.ok){reject(new Error(parsedResult?.error||(timedOut?'Windows OCR timed out after 8 minutes. The retry was stopped; the original receipt rows remain available for review.':stderr||`Windows OCR failed${code===null?' (process stopped)':` (exit code ${code})`}.`)));return;}resolve(parsedResult);});
    });
  }catch(error){
    if(!password&&/(?:prompt\(\) is not supported|0x80048040)/i.test(String(error?.message||'')))throw new Error('This PDF is password-protected. Enter the password supplied with the bank statement and try again.');
    throw error;
  }finally{await fs.rm(tempDirectory,{recursive:true,force:true}).catch(()=>{});}
});
function buildImagePdf(pages){
  const objects=[null],pageRefs=[];
  const add=body=>{objects.push(body);return objects.length-1;};
  for(const page of pages){
    const jpeg=fsSync.readFileSync(page.path);
    const imageId=add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
    const landscape=page.width>page.height;const width=landscape?841.89:595.28,height=landscape?595.28:841.89;
    const scale=Math.min((width-36)/page.width,(height-36)/page.height),drawWidth=page.width*scale,drawHeight=page.height*scale;
    const content=Buffer.from(`q ${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${((width-drawWidth)/2).toFixed(3)} ${((height-drawHeight)/2).toFixed(3)} cm /Im1 Do Q`);
    const contentId=add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('\nendstream')]));
    pageRefs.push({imageId,contentId,width,height});
  }
  const pagesId=objects.length;objects.push(null);
  for(const page of pageRefs){
    const pageId=add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /Resources << /XObject << /Im1 ${page.imageId} 0 R >> >> /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${page.contentId} 0 R >>`));
    page.pageId=pageId;
  }
  objects[pagesId]=Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map(p=>`${p.pageId} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`);
  const catalogId=add(Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
  const chunks=[Buffer.from('%PDF-1.7\n%\xff\xff\xff\xff\n','binary')],offsets=[0];let offset=chunks[0].length;
  for(let i=1;i<objects.length;i++){const chunk=Buffer.concat([Buffer.from(`${i} 0 obj\n`),objects[i],Buffer.from('\nendobj\n')]);offsets[i]=offset;chunks.push(chunk);offset+=chunk.length;}
  const xrefOffset=offset,lines=[`xref\n0 ${objects.length}\n0000000000 65535 f \n`];
  for(let i=1;i<objects.length;i++)lines.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  lines.push(`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);chunks.push(Buffer.from(lines.join('')));return Buffer.concat(chunks);
}
ipcMain.handle('make-readable-copy',async(_event,payload)=>{
  const filePath=typeof payload==='string'?payload:payload?.filePath;
  const password=typeof payload==='object'&&typeof payload?.password==='string'?payload.password:'';
  if(typeof filePath!=='string'||path.extname(filePath).toLowerCase()!=='.pdf')throw new Error('Readable copies require a PDF file.');
  const resolved=path.resolve(filePath);if(!fsSync.existsSync(resolved))throw new Error('The selected PDF could not be found.');
  const temp=path.join(app.getPath('temp'),`fare-extractor-copy-${crypto.randomBytes(8).toString('hex')}`);await fs.mkdir(temp,{recursive:true});
  try{
    const helper=path.join(__dirname,'copy-helper.ps1');const result=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Path',resolved,'-OutputDirectory',temp,'-Password',password],{windowsHide:true,maxBuffer:8*1024*1024,timeout:240000},(error,stdout,stderr)=>{let parsed;try{parsed=JSON.parse(String(stdout).trim().split(/\r?\n/).filter(Boolean).at(-1)||'{}');}catch{parsed=null;}if(error||!parsed?.ok){reject(new Error(parsed?.error||stderr||error?.message||'Could not render this PDF.'));return;}resolve(parsed);}));
    const defaultName=`${path.basename(resolved,path.extname(resolved))} readable copy.pdf`;const save=await dialog.showSaveDialog(mainWindow,{title:'Save readable PDF copy',defaultPath:path.join(app.getPath('downloads'),defaultName),filters:[{name:'PDF files',extensions:['pdf']}]});
    if(save.canceled||!save.filePath)return {canceled:true};
    await fs.writeFile(save.filePath,buildImagePdf(result.pages));return {canceled:false,filePath:save.filePath};
  } finally {await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});}
});
ipcMain.handle('save-workbook',async(_event,payload)=>{
  const bytes=payload?.bytes;
  if(!bytes)throw new Error('No Excel workbook was supplied.');
  const filename=String(payload?.filename||'extract.xlsx').replace(/[^\w.-]+/g,'_').replace(/\.xlsx$/i,'')+'.xlsx';
  const save=await dialog.showSaveDialog(mainWindow,{
    title:'Save Excel workbook',
    defaultPath:path.join(app.getPath('downloads'),filename),
    filters:[{name:'Excel workbooks',extensions:['xlsx']}],
    properties:['createDirectory','showOverwriteConfirmation']
  });
  if(save.canceled||!save.filePath)return {canceled:true};
  await fs.writeFile(save.filePath,Buffer.from(bytes));
  return {canceled:false,filePath:save.filePath};
});
app.whenReady().then(async()=>{
  const root=path.resolve(__dirname);
  const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml'};
  protocol.handle('fareextractor',async request=>{try{const url=new URL(request.url);if(url.hostname!=='app'||request.method!=='GET')return new Response('Forbidden',{status:403});const name=decodeURIComponent(url.pathname),target=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!target.startsWith(root+path.sep)||!types[path.extname(target)])return new Response('Forbidden',{status:403});return new Response(await fs.readFile(target),{headers:{'Content-Type':types[path.extname(target)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch{return new Response('Not found',{status:404});}});
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const allowed=/^(fareextractor:\/\/app\/|blob:fareextractor:\/\/app\/|data:)/.test(details.url);callback({cancel:!allowed});});
  session.defaultSession.on('will-download',(_event,item)=>{if(process.env.FARE_EXTRACTOR_TEST==='1'&&process.env.FARE_EXTRACTOR_TEST_DOWNLOADS){fsSync.mkdirSync(process.env.FARE_EXTRACTOR_TEST_DOWNLOADS,{recursive:true});item.setSavePath(path.join(process.env.FARE_EXTRACTOR_TEST_DOWNLOADS,path.basename(item.getFilename())));return;}item.setSaveDialogOptions({title:'Save Extractor workbook',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
mainWindow=new BrowserWindow({width:1440,height:920,minWidth:1040,minHeight:700,title:activeWorkspace?`R&W Accountants | Extractor · ${activeWorkspace.username}`:'R&W Accountants | Extractor',backgroundColor:'#f4f7f6',show:false,autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,spellcheck:false,preload:path.join(root,'preload.cjs')}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{role:'quit'}]},{label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},{label:'Help',submenu:[{label:'About R&W Accountants Extractor',click:()=>dialog.showMessageBox(mainWindow,{type:'info',title:'About R&W Accountants Extractor',message:'R&W Accountants | Extractor',detail:'Local PDF extraction software. Files are processed on this computer.'})}]}]));
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!=='fareextractor://app/index.html')event.preventDefault();});mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());mainWindow.on('closed',()=>{mainWindow=null;});mainWindow.once('ready-to-show',()=>{if(process.env.FARE_EXTRACTOR_TEST!=='1')mainWindow.show();});await mainWindow.loadURL('fareextractor://app/index.html');
  if(sharedUpdatePendingPath&&process.env.FARE_EXTRACTOR_TEST!=='1'){
    let updateAnnounced=false;
    const checkForSharedUpdate=()=>{
      if(updateAnnounced||!fsSync.existsSync(sharedUpdatePendingPath)||!mainWindow||mainWindow.isDestroyed())return;
      updateAnnounced=true;
      mainWindow.webContents.send('network-update-started');
    };
    checkForSharedUpdate();
    const updateWatcher=setInterval(checkForSharedUpdate,500);
    app.once('before-quit',()=>clearInterval(updateWatcher));
  }
}).catch(error=>{if(process.env.FARE_EXTRACTOR_TEST==='1')console.error(error);else dialog.showErrorBox('Unable to start Extractor',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
