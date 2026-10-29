'use strict';

// The network package's resources/app directory is now the canonical shared
// application location. The updater replaces it in place from GitHub, so a
// running app must never copy an older per-commit cache back over that folder.
function publishNetworkBootstrap(){return {updated:false};}

module.exports={publishNetworkBootstrap};
