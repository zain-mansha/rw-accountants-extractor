import {cp,mkdir,rename,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.tools','electron');
await stat(path.join(runtime,'electron.exe'));
const target=path.join(root,'release','ClearCount');
await mkdir(target,{recursive:true});
if(process.argv.includes('--source-only'))await stat(path.join(target,'ClearCount.exe'));
else {
  await cp(runtime,target,{recursive:true,filter:source=>!source.endsWith('resources'+path.sep+'default_app.asar')});
  await rename(path.join(target,'electron.exe'),path.join(target,'ClearCount.exe'));
}
const application=path.join(target,'resources','app');
await mkdir(application,{recursive:true});
await cp(path.join(root,'dist'),path.join(application,'dist'),{recursive:true});
await cp(path.join(root,'desktop'),path.join(application,'desktop'),{recursive:true});
await cp(path.join(root,'package.json'),path.join(application,'package.json'));
await cp(path.join(root,'README.md'),path.join(target,'READ ME.md'));
await cp(path.join(root,'THIRD-PARTY-NOTICES.md'),path.join(target,'THIRD-PARTY-NOTICES.md'));
console.log(`Packaged ClearCount with Electron ${(await readFile(path.join(runtime,'version'),'utf8')).trim()}`);
console.log(path.join(target,'ClearCount.exe'));
