'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('FareExtractorNative',{
  getPathForFile:file=>{try{return webUtils.getPathForFile(file);}catch{return file?.path||'';}},
  getBuildInfo:()=>ipcRenderer.invoke('app-build-info'),
  ocrPdf:(filePath,password='',options={})=>ipcRenderer.invoke('ocr-pdf',{filePath,password,...options})
  ,onOcrProgress:callback=>{const listener=(_event,progress)=>callback(progress);ipcRenderer.on('ocr-progress',listener);return()=>ipcRenderer.removeListener('ocr-progress',listener);}
  ,makeReadableCopy:(filePath,password='')=>ipcRenderer.invoke('make-readable-copy',{filePath,password})
  ,saveWorkbook:payload=>ipcRenderer.invoke('save-workbook',payload)
  ,workspace:{
    list:()=>ipcRenderer.invoke('workspace-list'),
    current:()=>ipcRenderer.invoke('workspace-current'),
    create:username=>ipcRenderer.invoke('workspace-create',username),
    open:id=>ipcRenderer.invoke('workspace-open',id),
    logout:()=>ipcRenderer.invoke('workspace-logout')
  }
});
