'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function readMaintenanceMetadata(applicationDirectory) {
  return {
    maintenanceMode: readJsonFile(path.join(applicationDirectory, 'maintenance-mode.json')),
    buildInfo: readJsonFile(path.join(applicationDirectory, 'build-info.json'))
  };
}

function shouldBlockLaunch({ packaged, maintenanceMode, buildInfo } = {}) {
  const githubCommit = String(buildInfo?.commit || '').trim();
  return packaged === true && maintenanceMode?.enabled === true && /^[a-f0-9]{40}$/i.test(githubCommit);
}

module.exports = { readMaintenanceMetadata, shouldBlockLaunch };
