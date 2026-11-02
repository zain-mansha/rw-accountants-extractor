'use strict';

function shouldBlockLaunch({ packaged, maintenanceMode, buildInfo } = {}) {
  const githubCommit = String(buildInfo?.commit || '').trim();
  return packaged === true && maintenanceMode?.enabled === true && /^[a-f0-9]{40}$/i.test(githubCommit);
}

module.exports = { shouldBlockLaunch };
