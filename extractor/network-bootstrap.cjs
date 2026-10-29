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

  const appRoot=path.join(networkRoot,'resources','app'),helperSource=path.join(appDirectory,'network-bootstrap.cjs'),helperTarget=path.join(appRoot,'network-bootstrap.cjs'),mainTarget=path.join(appRoot,'main.cjs');
  const publishFile=(source,target)=>{
    if(path.resolve(target).toLowerCase()===path.resolve(source).toLowerCase())return {updated:false};
    const temporary=`${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try{fs.copyFileSync(source,temporary);fs.renameSync(temporary,target);return {updated:true};}
    catch(error){try{fs.rmSync(temporary,{force:true});}catch{}return {updated:false,error:error?.message||String(error)};}
  };
  // Install the dependency first so a click on the shared executable can
  // never expose a main.cjs that requires a missing network-bootstrap.cjs.
  if(fs.existsSync(helperSource)){
    const helper=publishFile(helperSource,helperTarget);if(helper.error)return helper;
  }
  return publishFile(sourceFile,mainTarget);
}

module.exports={publishNetworkBootstrap};
