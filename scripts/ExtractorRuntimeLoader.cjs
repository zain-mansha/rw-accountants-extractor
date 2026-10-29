'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, dialog, BrowserWindow, protocol } = require('electron');

protocol.registerSchemesAsPrivileged([{ scheme: 'fareextractor', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
process.env.FARE_EXTRACTOR_SCHEME_REGISTERED = '1';

const runtimeDirectory = path.dirname(process.execPath);
const launcherConfigPath = path.join(runtimeDirectory, 'extractor-launcher.json');

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
  const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f8f6;color:#173331;font:14px Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh}.card{width:370px}.brand{font-size:11px;font-weight:800;letter-spacing:.15em;color:#08796c}.title{font-size:22px;font-weight:700;margin:13px 0 8px}.copy{color:#60736d;line-height:1.55;min-height:43px}.track{height:8px;margin-top:23px;border-radius:8px;background:#dcebe5;overflow:hidden}.bar{height:100%;width:34%;border-radius:8px;background:#0d8276;animation:move 1.3s ease-in-out infinite alternate}@keyframes move{to{transform:translateX(195%)}}</style><main class="card"><div class="brand">R&amp;W ACCOUNTANTS</div><div class="title">Checking shared updates</div><div class="copy">Preparing this PC’s local application before opening Extractor.</div><div class="track"><div class="bar"></div></div></main>';
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splash.once('ready-to-show', () => splash.show());
  return splash;
}

function showStartError(error, splash) {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  if (splash && !splash.isDestroyed()) splash.close();
  dialog.showErrorBox('Unable to start Extractor', details.slice(-4000));
  app.exit(1);
}

function readLauncherConfig() {
  try { return JSON.parse(fs.readFileSync(launcherConfigPath, 'utf8')); }
  catch (error) { throw new Error(`The local Extractor launcher settings could not be read: ${error.message}`); }
}

function prepareLocalApplication(config) {
  const networkRoot = String(config.networkRoot || process.env.FARE_EXTRACTOR_NETWORK_ROOT || '').trim();
  const sharedApplication = String(config.sharedApplication || (networkRoot ? path.join(networkRoot, 'resources', 'app') : '')).trim();
  const networkScript = networkRoot ? path.join(networkRoot, 'Start Extractor from Network.ps1') : '';
  if (!networkRoot || !fs.existsSync(networkScript)) throw new Error('The shared Extractor launcher could not be found. Check that the network folder is connected.');
  const powershell = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', networkScript,
    '-RuntimeRoot', String(config.runtimeRoot || runtimeDirectory),
    '-ProfileRoot', String(config.profileRoot || path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Extractor', 'Profiles')),
    '-NetworkSource', networkRoot
  ];
  try {
    const currentLocalApp = String(config.lastLocalApplication || '');
    const info = JSON.parse(fs.readFileSync(path.join(currentLocalApp, 'build-info.json'), 'utf8'));
    const localBuildId = String(info.buildId || '');
    if (localBuildId) args.push('-LocalBuildId', localBuildId);
  } catch {}
  args.push('-PrepareLocalAppOnly');
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errorOutput = '';
    const append = (current, chunk) => (current + chunk).slice(-1024 * 1024);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output = append(output, chunk); });
    child.stderr.on('data', chunk => { errorOutput = append(errorOutput, chunk); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error((errorOutput || output || `The shared update check ended with exit code ${code}.`).trim().slice(-4000)));
        return;
      }
      const marker = output.split(/\r?\n/).findLast(line => line.startsWith('EXTRACTOR_LOCAL_APP_PATH:'));
      if (!marker) { reject(new Error('The shared launcher did not return the path to this PC’s updated application.')); return; }
      try {
        const localDirectory = Buffer.from(marker.slice('EXTRACTOR_LOCAL_APP_PATH:'.length).trim(), 'base64').toString('utf8');
        if (!localDirectory || !fs.existsSync(path.join(localDirectory, 'main.cjs'))) throw new Error('The local application copy is incomplete.');
        resolve({ localDirectory, sharedApplication });
      } catch (error) { reject(error); }
    });
  });
}

app.whenReady().then(async () => {
  const splash = showUpdateSplash();
  try {
    const config = readLauncherConfig();
    const sharedApplication = String(process.env.FARE_EXTRACTOR_SHARED_APP || config.sharedApplication || path.join(config.networkRoot, 'resources', 'app'));
    let localApplication = String(process.env.FARE_EXTRACTOR_LOCAL_APP || '');
    if (!localApplication || !fs.existsSync(path.join(localApplication, 'main.cjs'))) {
      try {
        const prepared = await prepareLocalApplication({ ...config, sharedApplication });
        localApplication = prepared.localDirectory;
      } catch (error) {
        const fallback = String(config.lastLocalApplication || '');
        if (!fallback || !fs.existsSync(path.join(fallback, 'main.cjs'))) throw error;
        dialog.showMessageBoxSync({ type: 'warning', title: 'Using the last local version', message: 'Extractor could not check the shared folder, so it will open the last complete local version.', detail: error.message });
        localApplication = fallback;
      }
    }
    const localMain = path.join(localApplication, 'main.cjs');
    if (!fs.existsSync(localMain)) throw new Error(`The local Extractor application could not be found: ${localMain}`);
    process.env.FARE_EXTRACTOR_SHARED_APP = sharedApplication;
    process.env.FARE_EXTRACTOR_LOCAL_APP = localApplication;
    process.env.FARE_EXTRACTOR_PROFILE_ROOT = String(config.profileRoot || path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Extractor', 'Profiles'));

    const closeSplashWhenReady = (_event, window) => {
      if (window === splash || splash.isDestroyed()) return;
      app.removeListener('browser-window-created', closeSplashWhenReady);
      window.once('ready-to-show', () => { if (!splash.isDestroyed()) splash.close(); });
    };
    app.on('browser-window-created', closeSplashWhenReady);
    require(localMain);
  } catch (error) {
    showStartError(error, splash);
  }
}).catch(error => showStartError(error));
