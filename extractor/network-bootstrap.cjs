'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function publishNetworkBootstrap({packaged,sharedApplication,applicationDirectory,sourceFile}){
  if(!packaged||!sharedApplication||!applicationDirectory||!sourceFile)return {updated:false};
  const appDirectory=path.resolve(applicationDirectory);
  if(path.resolve(sharedApplication).toLowerCase()!==appDirectory.toLowerCase())return {updated:false};

  // The updater stores immutable builds at <network>/.extractor-apps/<sha>/resources/app.
  // Only publish from that cache into a network package carrying its marker.
  const networkRoot=path.resolve(appDirectory,'..','..','..','..');
  const cacheRoot=path.join(networkRoot,'.extractor-apps')+path.sep;
  if(!fs.existsSync(path.join(networkRoot,'network-build.txt'))||!appDirectory.toLowerCase().startsWith(cacheRoot.toLowerCase()))return {updated:false};

  const target=path.join(networkRoot,'resources','app','main.cjs');
  if(path.resolve(target).toLowerCase()===path.resolve(sourceFile).toLowerCase())return {updated:false};
  const temporary=`${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try{
    fs.copyFileSync(sourceFile,temporary);
    fs.renameSync(temporary,target);
    return {updated:true};
  }catch(error){
    try{fs.rmSync(temporary,{force:true});}catch{}
    return {updated:false,error:error?.message||String(error)};
  }
}

module.exports={publishNetworkBootstrap};
