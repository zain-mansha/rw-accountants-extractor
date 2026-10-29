const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');

const root=path.join(__dirname,'..');
const powershellScript=path.join(root,'scripts','Start Extractor from Network.ps1');
const commandScript=path.join(root,'scripts','Start Extractor from Network.cmd');
const mainScript=path.join(root,'extractor','main.cjs');
const networkBootstrapPath=path.join(root,'extractor','network-bootstrap.cjs');
const {parseLauncherConfigText}=require(path.join(root,'scripts','ExtractorLauncherConfig.cjs'));

test('malformed local launcher settings recover through a valid backup or network-root marker',()=>{
  const valid={networkRoot:'Z:\\Shared Extractor',sharedApplication:'Z:\\Shared Extractor\\resources\\app',lastLocalApplication:'C:\\Users\\User\\Extractor\\Applications\\build'};
  assert.deepEqual(parseLauncherConfigText(JSON.stringify(valid)),valid);
  assert.deepEqual(parseLauncherConfigText(`,${JSON.stringify(valid)}`),valid);
  assert.deepEqual(parseLauncherConfigText('{"networkRoot":"Z:\\\\Shared Extractor",,"broken":') ,{
    networkRoot:'Z:\\Shared Extractor',
    recoveredFromMalformedJson:true
  });

  const loader=fs.readFileSync(path.join(root,'scripts','ExtractorRuntimeLoader.cjs'),'utf8');
  const launcher=fs.readFileSync(powershellScript,'utf8');
  assert.match(loader,/settingsPaths = \[launcherConfigPath, `\$\{launcherConfigPath\}\.bak`\]/);
  assert.match(loader,/Keep the loader able to recover on that first repair launch/);
  assert.match(loader,/replace\(\/\^\\uFEFF\//);
  assert.match(loader,/extractor-network-root\.txt/);
  assert.match(loader,/lastLocalApplication/);
  assert.match(launcher,/Write-ExtractorAtomicTextFile/);
  assert.match(launcher,/ConvertFrom-Json -ErrorAction Stop/);
  assert.match(launcher,/extractor-network-root\.txt/);
});

test('network command launcher maps a share path and forwards setup options',()=>{
  const source=fs.readFileSync(commandScript,'utf8');
  assert.match(source,/pushd "%~dp0"/i);
  assert.match(source,/Start Extractor from Network\.ps1" %\*/i);
  assert.match(source,/popd/i);
});

test('double-clicking the packaged EXE runs the same network CMD launcher without an invisible pause',()=>{
  const main=fs.readFileSync(mainScript,'utf8');
  const command=fs.readFileSync(commandScript,'utf8');
  assert.match(main,/Start Extractor from Network\.cmd/);
  assert.match(main,/spawn\(process\.env\.ComSpec\|\|'cmd\.exe',\['\/d','\/c','call',launcher\]/);
  assert.match(main,/FARE_EXTRACTOR_BOOTSTRAP:'1'/);
  assert.match(main,/publishNetworkBootstrap\(\{/);
  assert.match(main,/require\('\.\/network-bootstrap\.cjs'\)/);
  assert.match(command,/if not "%FARE_EXTRACTOR_BOOTSTRAP%"=="1" pause/i);
  assert.doesNotMatch(main,/spawn\('powershell\.exe',\['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',launcher\]/);
});

test('a local network bootstrap never overwrites the canonical shared application',()=>{
  const {publishNetworkBootstrap}=require(networkBootstrapPath);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'Extractor bootstrap refresh '));
  try{
    const network=path.join(temporary,'network'),cached=path.join(network,'.extractor-apps','a'.repeat(40),'resources','app'),packaged=path.join(network,'resources','app');
    fs.mkdirSync(cached,{recursive:true});fs.mkdirSync(packaged,{recursive:true});
    fs.writeFileSync(path.join(network,'network-build.txt'),'test build');
    fs.writeFileSync(path.join(cached,'main.cjs'),'latest bootstrap');
    fs.writeFileSync(path.join(packaged,'main.cjs'),'old bootstrap');
    const result=publishNetworkBootstrap({packaged:true,sharedApplication:cached,applicationDirectory:cached,sourceFile:path.join(cached,'main.cjs')});
    assert.equal(result.updated,false);
    assert.equal(fs.readFileSync(path.join(packaged,'main.cjs'),'utf8'),'old bootstrap');
  }finally{
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});

test('Windows command invocation preserves spaces in a network launcher path',{skip:process.platform!=='win32'},()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'Extractor direct launch '));
  try{
    const launcher=path.join(temporary,'Start Extractor from Network.cmd');
    fs.writeFileSync(launcher,'@echo off\r\necho BOOTSTRAP_OK\r\n','ascii');
    const result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c','call',launcher],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    assert.match(result.stdout,/BOOTSTRAP_OK/);
  }finally{
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});

test('network launcher accepts the Windows-managed en-GB OCR version on supported Windows builds',()=>{
  const source=fs.readFileSync(powershellScript,'utf8');
  const requirement=JSON.parse(fs.readFileSync(path.join(root,'extractor','ocr-requirement.json'),'utf8'));
  assert.equal(requirement.language,'en-GB');
  assert.equal(requirement.versionPolicy,'windows-managed');
  assert.equal(Object.hasOwn(requirement,'minimumPackages'),false);
  assert.match(source,/Language\.OCR~~~en-GB~0\.0\.1\.0/);
  assert.match(source,/AvailableRecognizerLanguages/);
  assert.match(source,/Get-WindowsCapability -Online/);
  assert.match(source,/Add-WindowsCapability -Online -Name \$capabilityName/);
  assert.match(source,/Start-Process -FilePath \$powerShellExecutable -Verb RunAs/);
  assert.match(source,/extractor-ocr-setup-\$repairId\.log/);
  assert.match(source,/extractor-ocr-setup-\$repairId\.ps1/);
  assert.match(source,/extractor-ocr-setup-\$repairId\.json/);
  assert.match(source,/WriteAllText\(\$repairScript, \$repairPowerShell/);
  assert.doesNotMatch(source,/Join-Path \$systemDirectory 'cmd\.exe'/);
  assert.match(source,/\$capabilityName = \[string\]\$settings\.capability/);
  assert.match(source,/\$capability\.State -in @\('InstallPending', 'UninstallPending'\)/);
  assert.match(source,/Windows servicing output:/);
  assert.match(source,/using the version managed by this PC/);
  assert.match(source,/Windows selects a compatible package/);
  assert.doesNotMatch(source,/CurrentBuild/);
  assert.doesNotMatch(source,/Remove-WindowsCapability/);
  assert.doesNotMatch(source,/minimum tested OCR version/);
  assert.match(source,/\[void\]\(Ensure-ExtractorEnglishOcr \$applicationDirectory\)/);
  assert.match(source,/Start-Process -FilePath \$runtimeExecutable -WorkingDirectory \$runtimeTarget -PassThru/);
  assert.match(source,/\$extractorProcess\.HasExited/);
  assert.match(source,/ELECTRON_RUN_AS_NODE/);
  assert.match(source,/\$env:FARE_EXTRACTOR_SHARED_APP = \[IO\.Path\]::GetFullPath\(\$applicationDirectory\)/);
  assert.match(source,/ExtractorRuntimeLoader\.cjs/);
  assert.match(source,/resources\\app/);
  assert.doesNotMatch(source,/Start-Process -FilePath \$runtimeExecutable -ArgumentList/);
});

test('network runtime uses a packaged local entry point to load the immutable shared app',()=>{
  const loader=fs.readFileSync(path.join(root,'scripts','ExtractorRuntimeLoader.cjs'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts','ExtractorRuntimePackage.json'),'utf8'));
  const launcher=fs.readFileSync(powershellScript,'utf8');
  assert.equal(manifest.main,'ExtractorRuntimeLoader.cjs');
  assert.match(loader,/ExtractorLauncherConfig\.cjs/);
  assert.match(loader,/FARE_EXTRACTOR_SHARED_APP/);
  assert.match(loader,/require\(localMain\)/);
  assert.match(loader,/showErrorBox/);
  assert.doesNotMatch(loader,/copyFile|copySync|cpSync/);
  assert.match(launcher,/S-1-15-2-1/);
  assert.match(launcher,/icacls\.exe/);
});

test('network package build IDs ignore Electron debug logs generated by prior launches',()=>{
  const source=fs.readFileSync(path.join(root,'scripts','package-extractor.mjs'),'utf8');
  assert.match(source,/\['network-build\.txt','debug\.log'\]\.includes\(entry\.name\.toLowerCase\(\)\)/);
});

test('network launcher updates the shared app from the public GitHub repository and keeps app code off per-PC installs',()=>{
  const source=fs.readFileSync(powershellScript,'utf8');
  assert.match(source,/zain-mansha/);
  assert.match(source,/rw-accountants-extractor/);
  assert.match(source,/commits\/\$repositoryBranch\.atom/);
  assert.match(source,/tag:github\\\.com,2008:Grit::Commit/);
  assert.doesNotMatch(source,/api\.github\.com/);
  assert.match(source,/codeload\.github\.com/);
  assert.match(source,/\.extractor-apps/);
  assert.match(source,/\.extractor-update\.lock/);
  assert.match(source,/Checking the shared network application against GitHub/);
  assert.match(source,/resources\\app/);
  assert.match(source,/Join-Path \$source 'resources\\app'/);
  assert.match(source,/\$shortcut\.TargetPath = \$runtimeExecutable/);
  assert.match(source,/\$shortcut\.IconLocation = "\$runtimeExecutable,0"/);
  assert.match(source,/Programs\\ExtractorRuntime/);
  assert.match(source,/robocopy\.exe[^\r\n]*\$source \$runtimeStage/);
  assert.match(source,/Join-Path \$source 'resources\\app'\),\(Join-Path \$source 'data'\)/);
  assert.match(source,/Programs\\Extractor'\)/);
});

test('elevated OCR helper requests the Windows-compatible OCR package without removing an installed one',{skip:process.platform!=='win32'},()=>{
  const source=fs.readFileSync(powershellScript,'utf8');
  const helperMatch=source.match(/\$repairPowerShell = @'\r?\n([\s\S]*?)\r?\n'@/);
  assert.ok(helperMatch,'embedded elevated PowerShell helper should exist');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'Extractor OCR helper '));
  try{
    const helper=path.join(temporary,'repair.ps1');
    const settings=path.join(temporary,'extractor-ocr-setup-settings.json');
    const log=path.join(temporary,'dism.log');
    const calls=path.join(temporary,'servicing-calls.txt');
    const mockCmdlets=`
function Get-WindowsCapability {
  [CmdletBinding()]
  param([switch]$Online)
  Add-Content -LiteralPath $env:EXTRACTOR_OCR_TEST_CALLS -Value 'Get|Language.OCR*'
  $state=$env:EXTRACTOR_OCR_TEST_STATE
  if(-not $state){$state='Installed'}
  [pscustomobject]@{Name='Language.OCR~~~en-GB~0.0.1.0';State=$state}
}
function Add-WindowsCapability {
  [CmdletBinding()]
  param([switch]$Online,[string]$Name)
  Add-Content -LiteralPath $env:EXTRACTOR_OCR_TEST_CALLS -Value ('Add|' + $Name)
  [pscustomobject]@{Name=$Name;State='Installed';RestartNeeded=$false}
}
`;
    const helperText=helperMatch[1].replace('__SETTINGS_FILE__','extractor-ocr-setup-settings.json').replace(/^param\(\)/,`param()\n${mockCmdlets}`);
    fs.writeFileSync(helper,helperText,'utf8');
    fs.writeFileSync(settings,JSON.stringify({
      capability:'Language.OCR~~~en-GB~0.0.1.0',
      logPath:log
    }));
    execFileSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',helper],{
      encoding:'utf8',windowsHide:true,env:{...process.env,EXTRACTOR_OCR_TEST_CALLS:calls}
    });
    const callsMade=fs.readFileSync(calls,'utf8').trim().split(/\r?\n/);
    assert.deepEqual(callsMade,[
      'Get|Language.OCR*',
      'Add|Language.OCR~~~en-GB~0.0.1.0'
    ]);
    assert.match(fs.readFileSync(log,'utf8'),/Installed/);

    fs.writeFileSync(calls,'');
    fs.writeFileSync(log,'');
    const pending=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',helper],{
      encoding:'utf8',windowsHide:true,env:{...process.env,EXTRACTOR_OCR_TEST_CALLS:calls,EXTRACTOR_OCR_TEST_STATE:'UninstallPending'}
    });
    assert.notEqual(pending.status,0,'pending capability state must stop before another install attempt');
    assert.deepEqual(fs.readFileSync(calls,'utf8').trim().split(/\r?\n/),['Get|Language.OCR*']);
    assert.match(fs.readFileSync(log,'utf8'),/Restart Windows to finish the pending OCR capability change/);
    assert.doesNotMatch(fs.readFileSync(calls,'utf8'),/Remove\|/);
  }finally{
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});

test('OCR helper refuses to use a different machine-specific recognizer',()=>{
  const helper=fs.readFileSync(path.join(root,'extractor','ocr-helper.ps1'),'utf8');
  assert.match(helper,/LanguageTag -eq 'en-GB'/);
  assert.match(helper,/if\(\$ocrLanguage -ne 'en-GB'\)/);
  assert.doesNotMatch(helper,/TryCreateFromUserProfileLanguages/);
  assert.match(helper,/ocrLanguage=\$ocrLanguage/);
});

test('protected PDFs use the in-app password dialog and are OCRed from a temporary readable copy',()=>{
  const app=fs.readFileSync(path.join(root,'extractor','app.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'extractor','index.html'),'utf8');
  const main=fs.readFileSync(path.join(root,'extractor','main.cjs'),'utf8');
  assert.doesNotMatch(app,/window\.prompt\s*\(/);
  assert.match(app,/askForPdfPassword\(file\.name\)/);
  assert.match(html,/id="pdf-password-dialog"/);
  assert.match(main,/copy-helper\.ps1/);
  assert.match(main,/readable-copy\.pdf/);
  assert.match(main,/await fs\.copyFile\(resolved,localCopy\)/);
  assert.match(main,/let ocrPath=localCopy/);
  assert.match(main,/prompt\\\(\\\) is not supported\|0x80048040/i);
  assert.match(main,/finally\{await fs\.rm\(tempDirectory,\{recursive:true,force:true\}\)/);
  assert.match(main,/filePath:resolved/);
});

test('the bank workspace accepts CSV transaction exports as a password-free statement route',()=>{
  const app=fs.readFileSync(path.join(root,'extractor','app.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'extractor','index.html'),'utf8');
  assert.match(html,/\.csv,text\/csv/);
  assert.match(app,/mode==='bank'&&\/\\\.csv\$\/i\.test\(file\.name\)/);
  assert.match(app,/P\.parseBankCsv\(await readCsvFile\(file\),file\.name\)/);
  assert.match(app,/\['bank','invoice','receipt'\]\.includes\(mode\)/);
  assert.match(app,/Source file/);
});

test('network launcher publishes source updates to the share and caches only the Electron runtime locally on Windows',{skip:process.platform!=='win32'},()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'Extractor Network Launcher '));
  try{
    const source=path.join(temporary,'shared package'),runtime=path.join(temporary,'local runtime'),profile=path.join(temporary,'local profiles');
    const commit='1234567890abcdef1234567890abcdef12345678';
    const archiveContainer=path.join(temporary,'archive container');
    const repo=path.join(archiveContainer,'rw-accountants-extractor-test');
    const archive=path.join(temporary,'extractor-source.zip');
    const app=path.join(repo,'extractor');
    const vendor=path.join(repo,'dist','vendor');
    const scripts=path.join(repo,'scripts');
    const files={
      'Extractor.exe':'runtime exe','icudtl.dat':'runtime data','resources.pak':'runtime resources',
      'snapshot_blob.bin':'runtime snapshot','v8_context_snapshot.bin':'runtime context','version':'44.7.0',
      'resources/app/main.cjs':'old packaged bootstrap','resources/app/package.json':'{}',
      'resources/app/network-bootstrap.cjs':'old network bootstrap','resources/app/preload.cjs':'old preload',
      'resources/app/index.html':'old packaged page','resources/app/parser.js':'old parser',
      'resources/app/app.js':'old app script',
      'resources/app/styles.css':'old styles','resources/app/vendor/xlsx.full.min.js':'old library',
      'resources/app/ocr-helper.ps1':'old helper','resources/app/copy-helper.ps1':'old copy helper',
      'resources/app/ocr-requirement.json':'{}','resources/app/build-info.json':'{}',
      'data/must-not-copy.txt':'workspace data','debug.log':'temporary log'
    };
    for(const [relative,content] of Object.entries(files)){const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
    fs.writeFileSync(path.join(source,'network-build.txt'),'1.1.7-123456789abc\n');
    const appFiles={
      'main.cjs':'updated shared app entry','package.json':JSON.stringify({version:'1.1.7',main:'main.cjs'}),
      'network-bootstrap.cjs':'updated network bootstrap','build-info.json':JSON.stringify({buildId:'1.1.7-test'}),
      'index.html':'updated shared page','app.js':'updated shared app script','parser.js':'updated shared parser','preload.cjs':'updated shared preload','styles.css':'updated shared styles',
      'ocr-helper.ps1':'updated OCR helper','copy-helper.ps1':'updated PDF helper',
      'ocr-requirement.json':JSON.stringify({language:'en-GB',capability:'Language.OCR~~~en-GB~0.0.1.0',versionPolicy:'windows-managed'}),
      'license.cjs':'must not be included'
    };
    for(const [relative,content] of Object.entries(appFiles)){const file=path.join(app,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
    fs.mkdirSync(vendor,{recursive:true});
    fs.writeFileSync(path.join(vendor,'xlsx.full.min.js'),'updated workbook library');
    fs.writeFileSync(path.join(vendor,'SHEETJS-LICENSE.txt'),'third-party notice');
    fs.mkdirSync(scripts,{recursive:true});
    fs.copyFileSync(powershellScript,path.join(scripts,'Start Extractor from Network.ps1'));
    fs.copyFileSync(commandScript,path.join(scripts,'Start Extractor from Network.cmd'));
    fs.copyFileSync(path.join(root,'scripts','ExtractorRuntimeLoader.cjs'),path.join(scripts,'ExtractorRuntimeLoader.cjs'));
    fs.copyFileSync(path.join(root,'scripts','ExtractorLauncherConfig.cjs'),path.join(scripts,'ExtractorLauncherConfig.cjs'));
    fs.copyFileSync(path.join(root,'scripts','ExtractorRuntimePackage.json'),path.join(scripts,'ExtractorRuntimePackage.json'));
    const zipScript=path.join(temporary,'compress.ps1');
    fs.writeFileSync(zipScript,"$ErrorActionPreference='Stop'\nCompress-Archive -Path (Join-Path $env:EXTRACTOR_TEST_REPO_CONTAINER '*') -DestinationPath $env:EXTRACTOR_TEST_ARCHIVE -Force\n",'utf8');
    execFileSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',zipScript],{
      encoding:'utf8',windowsHide:true,env:{...process.env,EXTRACTOR_TEST_REPO_CONTAINER:archiveContainer,EXTRACTOR_TEST_ARCHIVE:archive}
    });
    fs.copyFileSync(powershellScript,path.join(source,'Start Extractor from Network.ps1'));
    fs.copyFileSync(commandScript,path.join(source,'Start Extractor from Network.cmd'));
    fs.copyFileSync(path.join(root,'scripts','ExtractorRuntimeLoader.cjs'),path.join(source,'ExtractorRuntimeLoader.cjs'));
    fs.copyFileSync(path.join(root,'scripts','ExtractorLauncherConfig.cjs'),path.join(source,'ExtractorLauncherConfig.cjs'));
    fs.copyFileSync(path.join(root,'scripts','ExtractorRuntimePackage.json'),path.join(source,'ExtractorRuntimePackage.json'));

    const atomFeed=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:Grit::Commit/${commit}</id></entry></feed>`;
    const runUpdater=()=>execFileSync('powershell.exe',[
      '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'Start Extractor from Network.ps1'),
      '-RuntimeRoot',runtime,'-ProfileRoot',profile,'-NoLaunch'
    ],{encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,EXTRACTOR_NETWORK_UPDATE_TESTS:'1',EXTRACTOR_TEST_COMMIT:commit,EXTRACTOR_TEST_ARCHIVE:archive,EXTRACTOR_TEST_FEED_CONTENT:atomFeed}});
    runUpdater();

    const sharedApp=path.join(source,'resources','app');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sharedApp,'build-info.json'),'utf8').replace(/^\uFEFF/, '')).commit,commit);
    assert.equal(fs.readFileSync(path.join(sharedApp,'main.cjs'),'utf8'),'updated shared app entry');
    assert.equal(fs.readFileSync(path.join(sharedApp,'parser.js'),'utf8'),'updated shared parser');
    assert.equal(fs.readFileSync(path.join(sharedApp,'vendor','xlsx.full.min.js'),'utf8'),'updated workbook library');
    assert.equal(fs.existsSync(path.join(sharedApp,'license.cjs')),false);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','Extractor.exe')),true);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','resources','app','parser.js')),false);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','resources','app','ExtractorRuntimeLoader.cjs')),true);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','resources','app','ExtractorLauncherConfig.cjs')),true);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','resources','app','package.json')),true);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','network-build.txt')),false);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','Start Extractor from Network.ps1')),false);
    assert.equal(fs.existsSync(path.join(runtime,'44.7.0','data')),false);
    assert.equal(fs.existsSync(path.join(profile)),false);
    assert.match(runUpdater(),new RegExp(commit));
  }finally{
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});
