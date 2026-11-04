'use strict';
const {app,BrowserWindow,protocol,session,Menu,shell,dialog,ipcMain,safeStorage,screen}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const crypto=require('node:crypto');
const {createClient}=require('./hmrc.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'farebooks',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const dataDirectory=process.env.FARE_BOOKS_DATA_DIR || path.join(path.dirname(process.execPath),'data');
fsSync.mkdirSync(dataDirectory,{recursive:true});
app.setPath('userData',dataDirectory);
app.setName('ClearCount');
const ownsLock=app.requestSingleInstanceLock();
if(!ownsLock)app.quit();
let mainWindow;
let hmrcClient;
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}});
const trustedExternal=url=>{try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname==='www.gov.uk'&&!parsed.username&&!parsed.password;}catch{return false;}};
const openGuidance=url=>{if(trustedExternal(url))shell.openExternal(url).catch(()=>{});};
app.whenReady().then(async()=>{
  const secureFile=path.join(dataDirectory,'hmrc-secure.json');
  const deviceFile=path.join(dataDirectory,'hmrc-device-id.txt');
  const loadSecure=async()=>{try{const saved=JSON.parse(await fs.readFile(secureFile,'utf8'));if(!safeStorage.isEncryptionAvailable())throw new Error('Windows secure storage is unavailable.');return JSON.parse(safeStorage.decryptString(Buffer.from(saved.payload,'base64')));}catch(error){if(error.code==='ENOENT')return {};throw error;}};
  const saveSecure=async value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Windows secure storage is unavailable.');const payload=safeStorage.encryptString(JSON.stringify(value)).toString('base64');await fs.writeFile(secureFile,JSON.stringify({version:1,payload},null,2),'utf8');};
  let deviceId;try{deviceId=(await fs.readFile(deviceFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;deviceId=crypto.randomUUID();await fs.writeFile(deviceFile,deviceId,'utf8');}
  hmrcClient=createClient({load:loadSecure,save:saveSecure,deviceId,appVersion:app.getVersion(),getDesktopMetadata:()=>{
    const bounds=mainWindow?.getContentBounds?.()||{width:1,height:1};
    const displays=screen.getAllDisplays().map(display=>({width:display.size.width,height:display.size.height,scalingFactor:display.scaleFactor,colourDepth:display.depth||24}));
    return {window:{width:bounds.width,height:bounds.height},screens:displays};
  }});
  ipcMain.handle('hmrc-status',()=>hmrcClient.status());
  ipcMain.handle('hmrc-configure',async(_event,input)=>{const current=await loadSecure();const clientId=String(input?.clientId||'').trim(),clientSecret=String(input?.clientSecret||'').trim(),environment=input?.environment==='production'?'production':'sandbox';if(!clientId||!clientSecret)throw new Error('Enter the HMRC client ID and client secret.');await saveSecure({clientId,clientSecret,environment});return hmrcClient.status();});
  ipcMain.handle('hmrc-authorize',async()=>hmrcClient.authorize({...(await loadSecure()),openExternal:url=>shell.openExternal(url),onComplete:result=>mainWindow?.webContents.send('hmrc-auth-complete',result)}));
  ipcMain.handle('hmrc-obligations',(_event,input)=>hmrcClient.obligations(input));
  ipcMain.handle('hmrc-submit',(_event,input)=>hmrcClient.submit(input));
  ipcMain.handle('hmrc-itsa-businesses',(_event,input)=>hmrcClient.itsaBusinesses(input));
  ipcMain.handle('hmrc-itsa-business',(_event,input)=>hmrcClient.itsaBusiness(input));
  ipcMain.handle('hmrc-itsa-obligations',(_event,input)=>hmrcClient.itsaObligations(input));
  ipcMain.handle('hmrc-itsa-cumulative',(_event,input)=>hmrcClient.itsaSelfEmploymentCumulative(input));
  ipcMain.handle('hmrc-itsa-calculation',(_event,input)=>hmrcClient.itsaCalculation(input));
  const root=path.resolve(__dirname,'..','dist');
  const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
  protocol.handle('farebooks',async request=>{
    try{
      const url=new URL(request.url);
      if(url.hostname!=='app'||request.method!=='GET')return new Response('Forbidden',{status:403});
      const name=decodeURIComponent(url.pathname);
      const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
      if(!target.startsWith(root+path.sep)||!types[path.extname(target)])return new Response('Forbidden',{status:403});
      const buffer=await fs.readFile(target);
      return new Response(buffer,{headers:{'Content-Type':types[path.extname(target)],'X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('Not found',{status:404});}
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=/^(farebooks:\/\/app\/|blob:farebooks:\/\/app\/|data:)/.test(details.url);
    callback({cancel:!allowed});
  });
  session.defaultSession.on('will-download',(_event,item)=>{
    if(process.env.FARE_BOOKS_TEST==='1' && process.env.FARE_BOOKS_TEST_DOWNLOADS){
      fsSync.mkdirSync(process.env.FARE_BOOKS_TEST_DOWNLOADS,{recursive:true});
      item.setSavePath(path.join(process.env.FARE_BOOKS_TEST_DOWNLOADS,path.basename(item.getFilename())));return;
    }
    item.setSaveDialogOptions({title:'Save ClearCount export',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});
  });
  mainWindow=new BrowserWindow({width:1390,height:920,minWidth:830,minHeight:620,title:'ClearCount',backgroundColor:'#f7f8f5',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,spellcheck:false}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'File',submenu:[{label:'Print / save PDF',accelerator:'CmdOrCtrl+P',click:()=>mainWindow.webContents.print({printBackground:true})},{type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {label:'Help',submenu:[{label:'About ClearCount',click:()=>dialog.showMessageBox(mainWindow,{type:'info',title:'ClearCount',message:'ClearCount '+app.getVersion(),detail:'Local taxi-driver bookkeeping.\nYour records are stored in:\n'+dataDirectory+'\n\nDownload regular backups from Settings & backup.'})}]}
  ]));
  mainWindow.webContents.setWindowOpenHandler(({url})=>{openGuidance(url);return {action:'deny'};});
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!=='farebooks://app/index.html'){event.preventDefault();openGuidance(url);}});
  mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  mainWindow.on('closed',()=>{mainWindow=null;});
  mainWindow.once('ready-to-show',()=>{if(process.env.FARE_BOOKS_TEST!=='1')mainWindow.show();});
  await mainWindow.loadURL('farebooks://app/index.html');
}).catch(error=>{if(process.env.FARE_BOOKS_TEST==='1')console.error(error);else dialog.showErrorBox('Unable to start ClearCount',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
