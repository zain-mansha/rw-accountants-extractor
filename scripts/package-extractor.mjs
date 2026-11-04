import {cp,mkdir,rename,stat,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.tools','electron');
const releaseRoot=path.join(root,'release');
const network=process.argv.includes('--network');
const localOnly=process.argv.includes('--local-only');
const sourceOnly=process.argv.includes('--source-only');
const targetIndex=process.argv.indexOf('--target');
if(network&&targetIndex>=0)throw new Error('Use either --network or --target, not both.');
if(localOnly&&!network)throw new Error('Use --local-only together with --network.');
const requestedTarget=targetIndex>=0?process.argv[targetIndex+1]:'';
const target=requestedTarget?path.resolve(root,requestedTarget):path.join(releaseRoot,network?'Extractor-Network':'Extractor');
if(target!==releaseRoot&&!target.startsWith(releaseRoot+path.sep))throw new Error('Extractor package target must be inside the release folder.');

function getCleanGitCommit(){
  const candidates=process.platform==='win32'
    ? [process.env.GIT_EXECUTABLE,'C:\\Program Files\\Git\\cmd\\git.exe','C:\\Program Files (x86)\\Git\\cmd\\git.exe','git.exe'].filter(Boolean)
    : ['git'];
  for(const executable of candidates){
    const commit=spawnSync(executable,['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
    if(commit.status!==0)continue;
    const sha=commit.stdout.trim();
    if(!/^[a-f0-9]{40}$/.test(sha))continue;
    const status=spawnSync(executable,['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8',windowsHide:true});
    if(status.status===0&&!status.stdout.trim())return sha;
  }
  return '';
}

await stat(path.join(runtime,'electron.exe'));
await mkdir(target,{recursive:true});
if(sourceOnly){
  await stat(path.join(target,'Extractor.exe'));
}else{
  await cp(runtime,target,{recursive:true,filter:source=>!source.endsWith('resources'+path.sep+'default_app.asar')&&path.basename(source)!=='debug.log'});
  await rm(path.join(target,'debug.log'),{force:true});
  await rename(path.join(target,'electron.exe'),path.join(target,'Extractor.exe'));
}

const application=path.join(target,'resources','app');
await mkdir(application,{recursive:true});
await cp(path.join(root,'extractor'),application,{recursive:true,filter:source=>!['license.cjs','license-config.json'].includes(path.basename(source))});
await rm(path.join(application,'license.cjs'),{force:true});
await rm(path.join(application,'license-config.json'),{force:true});
await mkdir(path.join(application,'vendor'),{recursive:true});
await cp(path.join(root,'dist','vendor','xlsx.full.min.js'),path.join(application,'vendor','xlsx.full.min.js'));
await cp(path.join(root,'dist','vendor','SHEETJS-LICENSE.txt'),path.join(application,'vendor','SHEETJS-LICENSE.txt'));

if(network){
  const commandSource=path.join(root,'scripts','Start Extractor from Network.cmd');
  const installerSource=path.join(root,'scripts','Start Extractor from Network.ps1');
  const runtimeLoaderSource=path.join(root,'scripts','ExtractorRuntimeLoader.cjs');
  const runtimeConfigHelperSource=path.join(root,'scripts','ExtractorLauncherConfig.cjs');
  const runtimePackageSource=path.join(root,'scripts','ExtractorRuntimePackage.json');
  const commandTarget=path.join(target,path.basename(commandSource));
  const installerTarget=path.join(target,path.basename(installerSource));
  await cp(commandSource,commandTarget);
  const localDevelopmentMarker=path.join(target,'local-development.flag');
  if(localOnly){
    const command=await readFile(commandTarget,'utf8');
    const localCommand=command
      .replace(/^@echo off\r?\nsetlocal\r?\n/i,'@echo off\r\nsetlocal\r\nset "FARE_EXTRACTOR_DISABLE_GITHUB_UPDATES=1"\r\n')
      .replace(/^title .*$/m,'title "R&W Accountants Extractor - Local version"')
      .replace(/^echo Checking for Extractor updates before launch\.$/m,'echo Starting this laptop\'s local Extractor version. GitHub updates are disabled.');
    if(localCommand===command||!localCommand.includes('FARE_EXTRACTOR_DISABLE_GITHUB_UPDATES=1'))throw new Error('The local CMD launcher could not be configured to skip GitHub updates.');
    await writeFile(commandTarget,localCommand,'utf8');
    await writeFile(localDevelopmentMarker,'Local laptop package. GitHub updates are disabled.\n','utf8');
  }else{
    await rm(localDevelopmentMarker,{force:true});
  }
  await cp(installerSource,installerTarget);
  await cp(runtimeLoaderSource,path.join(target,path.basename(runtimeLoaderSource)));
  await cp(runtimeConfigHelperSource,path.join(target,path.basename(runtimeConfigHelperSource)));
  await cp(runtimePackageSource,path.join(target,path.basename(runtimePackageSource)));

  const digest=createHash('sha256');
  async function hashTree(directory){
    const entries=(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const fullPath=path.join(directory,entry.name);
      if(entry.isDirectory()){
        if(directory===target&&entry.name.toLowerCase()==='data')continue;
        await hashTree(fullPath);
      }else if(!(directory===target&&['network-build.txt','debug.log'].includes(entry.name.toLowerCase()))&&fullPath!==path.join(application,'build-info.json')){
        digest.update(path.relative(target,fullPath).replaceAll('\\','/'));
        digest.update(await readFile(fullPath));
      }
    }
  }
  await hashTree(target);
  const buildId=`${JSON.parse(await readFile(path.join(application,'package.json'),'utf8')).version}-${digest.digest('hex').slice(0,12)}`;
  const commit=getCleanGitCommit();
  await writeFile(path.join(application,'build-info.json'),`${JSON.stringify({buildId,...(commit?{commit}:{})},null,2)}\n`,'utf8');
  await writeFile(path.join(target,'network-build.txt'),`${buildId}\n`,'utf8');
  console.log(`Network build: ${buildId}${commit?` (Git ${commit})`:''}`);
}

console.log(`Packaged Extractor with Electron ${(await readFile(path.join(runtime,'version'),'utf8')).trim()}`);
console.log(path.join(target,'Extractor.exe'));
