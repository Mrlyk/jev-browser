import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Requires a built executor. JEV_TEST_CLI can target an unpacked/installed package.
const cli = process.env.JEV_TEST_CLI
  ? resolve(process.env.JEV_TEST_CLI)
  : fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const root = resolve(dirname(cli), '..');
const folder = join(root, 'skills', 'jev-browser');

function run(args, success = true) {
  const result = spawnSync(process.execPath, [cli, '--json', 'skill', ...args],
    { encoding: 'utf8', maxBuffer: 2_000_000, shell: false });
  assert.ifError(result.error);
  assert.equal(result.status, success ? 0 : 1, result.stderr + result.stdout);
  const response = JSON.parse(result.stdout);
  assert.equal(response.success, success);
  return response;
}

const list = run(['list']);
assert.deepEqual(list.data.map(item => item.name), ['jev-browser']);
const main = run(['get', 'jev-browser']).data[0];
assert.equal(main.content, readFileSync(join(folder, 'SKILL.md'), 'utf8'));
assert.equal(main.files, undefined, 'default get must not load references');

const full = run(['get', 'jev-browser', '--full']).data[0];
const paths = ['commands.md', 'sessions-auth.md', 'snapshot-refs.md', 'troubleshooting.md'].map(name => `references/${name}`);
assert.deepEqual(full.files.map(file => file.path), paths);
for (const file of full.files) assert.equal(file.content, readFileSync(join(folder, file.path), 'utf8'));
assert.equal(run(['path', 'jev-browser']).data.path, folder);
const all = run(['get', '--all']);
assert.deepEqual(all.data.map(item => item.name), ['jev-browser']);
assert.equal(all.data[0].files, undefined);
assert.match(run(['get', 'core'], false).error, /Skill not found/);
assert.match(run(['get', 'electron'], false).error, /Skill not found/);
console.log('Skill discovery, lazy references, full output, paths and retired entries verified.');
