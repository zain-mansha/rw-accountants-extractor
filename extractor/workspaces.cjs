'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanUsername(value) {
  const rawUsername = String(value ?? '').trim();
  if (/[\u0000-\u001f\u007f]/.test(rawUsername)) throw new Error('Usernames cannot contain control characters.');
  const username = rawUsername.replace(/\s+/g, ' ');
  if (!username || username.length > 40) {
    throw new Error('Enter a username between 1 and 40 characters.');
  }
  return username;
}

function readWorkspaceProfilesSync(profileRoot) {
  try {
    const profiles = JSON.parse(fsSync.readFileSync(path.join(profileRoot, 'profiles.json'), 'utf8'));
    return Array.isArray(profiles)
      ? profiles.filter(profile => profile && PROFILE_ID.test(profile.id) && typeof profile.username === 'string')
      : [];
  } catch {
    return [];
  }
}

function workspaceDirectory(profileRoot, id) {
  if (!PROFILE_ID.test(String(id ?? ''))) throw new Error('Invalid workspace identifier.');
  const root = path.resolve(profileRoot);
  const directory = path.resolve(root, id);
  if (!directory.startsWith(root + path.sep)) throw new Error('Workspace path is outside the profile folder.');
  return directory;
}

async function createWorkspace(profileRoot, value) {
  const username = cleanUsername(value);
  const profiles = readWorkspaceProfilesSync(profileRoot);
  if (profiles.some(profile => profile.username.toLocaleLowerCase('en-GB') === username.toLocaleLowerCase('en-GB'))) {
    throw new Error('That username already has a workspace. Choose it from the list or enter a different username.');
  }

  const profile = { id: crypto.randomUUID(), username, createdAt: new Date().toISOString() };
  const root = path.resolve(profileRoot);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(workspaceDirectory(root, profile.id), { recursive: true });
  const temporaryFile = path.join(root, `profiles-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporaryFile, JSON.stringify([...profiles, profile], null, 2), 'utf8');
    await fs.rename(temporaryFile, path.join(root, 'profiles.json'));
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }
  return profile;
}

module.exports = { PROFILE_ID, cleanUsername, readWorkspaceProfilesSync, workspaceDirectory, createWorkspace };
