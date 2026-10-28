'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');

const sharedAppDirectory = process.env.FARE_EXTRACTOR_SHARED_APP;
const sharedMain = typeof sharedAppDirectory === 'string'
  ? path.join(sharedAppDirectory, 'main.cjs')
  : '';

if (!sharedMain || !fs.existsSync(sharedMain)) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'Unable to start Extractor',
      'The current Extractor application could not be found on the shared network folder. Check that the network location is available, then try again.'
    );
    app.exit(1);
  });
} else {
  try {
    // Keep the full application on the network. Loading its main module from
    // this packaged entry point preserves Electron's built-in APIs while the
    // application itself continues to use its network-side __dirname paths.
    require(sharedMain);
  } catch (error) {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    app.whenReady().then(() => {
      dialog.showErrorBox('Unable to start Extractor', details.slice(-4000));
      app.exit(1);
    });
  }
}
