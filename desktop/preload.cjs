'use strict';

const {contextBridge, ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('fareBooksDesktop', {
  hmrc: {
    status: () => ipcRenderer.invoke('hmrc-status'),
    configure: input => ipcRenderer.invoke('hmrc-configure', input),
    authorize: () => ipcRenderer.invoke('hmrc-authorize'),
    obligations: input => ipcRenderer.invoke('hmrc-obligations', input),
    submit: input => ipcRenderer.invoke('hmrc-submit', input),
    itsaBusinesses: input => ipcRenderer.invoke('hmrc-itsa-businesses', input),
    itsaBusiness: input => ipcRenderer.invoke('hmrc-itsa-business', input),
    itsaObligations: input => ipcRenderer.invoke('hmrc-itsa-obligations', input),
    itsaCumulative: input => ipcRenderer.invoke('hmrc-itsa-cumulative', input),
    itsaCalculation: input => ipcRenderer.invoke('hmrc-itsa-calculation', input),
    onAuthComplete: callback => {
      const listener = (_event, result) => callback(result);
      ipcRenderer.on('hmrc-auth-complete', listener);
      return () => ipcRenderer.removeListener('hmrc-auth-complete', listener);
    }
  }
});
