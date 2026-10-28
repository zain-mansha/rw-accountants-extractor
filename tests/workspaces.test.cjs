const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorkspace, readWorkspaceProfilesSync, workspaceDirectory, cleanUsername } = require('../extractor/workspaces.cjs');

async function withProfileRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-workspaces-'));
  try { await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('each username gets a separate local workspace directory', async () => withProfileRoot(async root => {
  const first = await createWorkspace(root, 'Amina Khan');
  const second = await createWorkspace(root, 'Ravi Patel');
  assert.notEqual(first.id, second.id);
  assert.notEqual(workspaceDirectory(root, first.id), workspaceDirectory(root, second.id));
  assert.equal((await fs.stat(workspaceDirectory(root, first.id))).isDirectory(), true);
  assert.deepEqual(readWorkspaceProfilesSync(root).map(profile => profile.username), ['Amina Khan', 'Ravi Patel']);
  assert.equal(Object.hasOwn(first, 'password'), false);
}));

test('usernames are case-insensitively unique and whitespace is normalized', async () => withProfileRoot(async root => {
  const profile = await createWorkspace(root, '  Zain   Mansha  ');
  assert.equal(profile.username, 'Zain Mansha');
  await assert.rejects(createWorkspace(root, 'zain mansha'), /already has a workspace/i);
  assert.equal(readWorkspaceProfilesSync(root).length, 1);
}));

test('empty, overlong and control-character usernames are rejected', () => {
  assert.throws(() => cleanUsername('   '), /username/i);
  assert.throws(() => cleanUsername('x'.repeat(41)), /username/i);
  assert.throws(() => cleanUsername('Alex\nOther'), /username/i);
});

test('workspace directory resolution accepts only generated profile identifiers', () => {
  assert.throws(() => workspaceDirectory('C:\\profiles', '..\\outside'), /Invalid workspace identifier/i);
});
