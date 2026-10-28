import {cp,mkdir,rename,stat,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.tools','electron');
const releaseRoot=path.join(root,'release');
const network=process.argv.includes('--network');
const sourceOnly=process.argv.includes('--source-only');
const targetIndex=process.argv.indexOf('--target');
if(network&&targetIndex>=0)throw new Error('Use either --network or --target, not both.');
const requestedTarget=targetIndex>=0?process.argv[targetIndex+1]:'';
const target=requestedTarget?path.resolve(root,requestedTarget):path.join(releaseRoot,network?'Extractor-Network':'Extractor');
if(target!==releaseRoot&&!target.startsWith(releaseRoot+path.sep))throw new Error('Extractor package target must be inside the release folder.');
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
  const runtimePackageSource=path.join(root,'scripts','ExtractorRuntimePackage.json');
  const commandTarget=path.join(target,path.basename(commandSource));
  const installerTarget=path.join(target,path.basename(installerSource));
  await cp(commandSource,commandTarget);
  await cp(installerSource,installerTarget);
  await cp(runtimeLoaderSource,path.join(target,path.basename(runtimeLoaderSource)));
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
  await writeFile(path.join(application,'build-info.json'),`${JSON.stringify({buildId},null,2)}\n`,'utf8');
  await writeFile(path.join(target,'network-build.txt'),`${buildId}\n`,'utf8');
  console.log(`Network build: ${buildId}`);
}

console.log(`Packaged Extractor with Electron ${(await readFile(path.join(runtime,'version'),'utf8')).trim()}`);
console.log(path.join(target,'Extractor.exe'));
