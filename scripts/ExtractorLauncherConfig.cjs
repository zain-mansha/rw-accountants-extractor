'use strict';

function extractNetworkRoot(text) {
  const match = String(text).match(/"networkRoot"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (!match) return '';
  try { return JSON.parse(`"${match[1]}"`); }
  catch { return ''; }
}

function parseLauncherConfigText(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('launcher settings are empty');

  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('launcher settings must be a JSON object');
    }
    return value;
  } catch (error) {
    // A stray comma before the opening object is a common sign of a partial
    // or overlapping write. Remove only that punctuation and retry strict JSON.
    const repaired = source.replace(/^[,\s]+(?=\{)/, '');
    if (repaired !== source) {
      try {
        const value = JSON.parse(repaired);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch {}
    }
    const networkRoot = extractNetworkRoot(source);
    if (networkRoot) return { networkRoot, recoveredFromMalformedJson: true };
    throw new Error(`launcher settings are not valid JSON: ${error.message}`);
  }
}

module.exports = { parseLauncherConfigText };
