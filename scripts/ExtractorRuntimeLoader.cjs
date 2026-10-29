'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { app, dialog, BrowserWindow, protocol } = require('electron');

protocol.registerSchemesAsPrivileged([{ scheme: 'fareextractor', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
process.env.FARE_EXTRACTOR_SCHEME_REGISTERED = '1';

const sharedAppDirectory = process.env.FARE_EXTRACTOR_SHARED_APP;
const sharedMain = typeof sharedAppDirectory === 'string'
  ? path.join(sharedAppDirectory, 'main.cjs')
  : '';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function showUpdateSplash() {
  const splash = new BrowserWindow({
    width: 470,
    height: 230,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'R&W Accountants Extractor',
    backgroundColor: '#f4f8f6',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f8f6;color:#173331;font:14px Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh}.card{width:370px}.brand{font-size:11px;font-weight:800;letter-spacing:.15em;color:#08796c}.title{font-size:22px;font-weight:700;margin:13px 0 8px}.copy{color:#60736d;line-height:1.55;min-height:43px}.track{height:8px;margin-top:23px;border-radius:8px;background:#dcebe5;overflow:hidden}.bar{height:100%;width:34%;border-radius:8px;background:#0d8276;animation:move 1.3s ease-in-out infinite alternate}@keyframes move{to{transform:translateX(195%)}}</style><main class="card"><div class="brand">R&amp;W ACCOUNTANTS</div><div class="title">Update in progress</div><div class="copy">The shared Extractor is being updated. This workspace will reopen automatically when the update is complete.</div><div class="track"><div class="bar"></div></div></main>';
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splash.once('ready-to-show', () => splash.show());
  return splash;
}

async function acquireSharedAppSession(sharedDirectory, onUpdateWait) {
  const networkRoot = path.resolve(sharedDirectory, '..', '..');
  const sessionDirectory = path.join(networkRoot, '.extractor-app-sessions');
  const updatePending = path.join(networkRoot, '.extractor-update.pending');
  fs.mkdirSync(sessionDirectory, { recursive: true });
  const sessionFile = path.join(sessionDirectory, `${os.hostname().replace(/[^a-z0-9_.-]/gi, '_')}-${process.pid}-${crypto.randomBytes(8).toString('hex')}.json`);
  const deadline = Date.now() + 60 * 60 * 1000;
  let waitingForUpdate = false;
  while (true) {
    if (Date.now() >= deadline) throw new Error('The shared Extractor update has taken too long. Check that the network folder is available, then launch again.');
    if (fs.existsSync(updatePending)) {
      if (!waitingForUpdate) {
        waitingForUpdate = true;
        onUpdateWait();
      }
      await delay(500);
      continue;
    }
    try {
      fs.writeFileSync(sessionFile, JSON.stringify({ host: os.hostname(), pid: process.pid, startedAt: Date.now() }), { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') throw error;
      throw new Error(`Could not register this Extractor session on the shared folder: ${error?.message || error}`);
    }
    if (fs.existsSync(updatePending)) {
      try { fs.rmSync(sessionFile, { force: true }); } catch {}
      await delay(250);
      continue;
    }
    const heartbeat = setInterval(() => {
      try { fs.utimesSync(sessionFile, new Date(), new Date()); } catch {}
    }, 15000);
    heartbeat.unref();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      try { fs.rmSync(sessionFile, { force: true }); } catch {}
    };
    app.on('before-quit', release);
    process.once('exit', release);
    process.once('SIGINT', () => { release(); process.exit(130); });
    process.once('SIGTERM', () => { release(); process.exit(143); });
    return release;
  }
}

function showStartError(error, splash) {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  if (splash && !splash.isDestroyed()) splash.close();
  dialog.showErrorBox('Unable to start Extractor', details.slice(-4000));
  app.exit(1);
}

if (!sharedMain || !fs.existsSync(sharedMain)) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'Unable to start Extractor',
      'The current Extractor application could not be found on the shared network folder. Check that the network location is available, then try again.'
    );
    app.exit(1);
  });
} else {
  app.whenReady().then(async () => {
    let splash = null;
    try {
      await acquireSharedAppSession(sharedAppDirectory, () => { splash = showUpdateSplash(); });
      if (splash) {
        const closeSplashWhenReady = (_event, window) => {
          if (window === splash || splash.isDestroyed()) return;
          app.removeListener('browser-window-created', closeSplashWhenReady);
          window.once('ready-to-show', () => { if (!splash.isDestroyed()) splash.close(); });
        };
        app.on('browser-window-created', closeSplashWhenReady);
      }
      require(sharedMain);
    } catch (error) {
      showStartError(error, splash);
    }
  });
}
