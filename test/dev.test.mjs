import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dev = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts.dev;

test('dev links both commands globally; package installation replaces the link without changing the checkout', t => {
  const root = mkdtempSync(join(tmpdir(), 'jev-dev-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), release = join(root, 'release'), prefix = join(root, 'prefix');
  const env = { ...process.env, npm_config_prefix: prefix, npm_config_cache: join(root, 'cache'), NODE_OPTIONS: '' };
  const npm = (args, cwd = source) => {
    const result = spawnSync(process.env.npm_execpath ? process.execPath : 'npm',
      [...(process.env.npm_execpath ? [process.env.npm_execpath] : []), ...args],
      { cwd, env, encoding: 'utf8', timeout: 60000 });
    assert.ifError(result.error);
    return result;
  };
  const packageJson = { name: 'jev-browser-cli', version: '0.1.3', type: 'module',
    bin: { jevb: 'cli.js', 'jev-browser': 'cli.js' },
    scripts: { dev, 'build:core': 'node step.mjs core', build: 'node step.mjs typescript' } };
  const cli = marker => `#!/usr/bin/env node\nconsole.log(${JSON.stringify(marker)});\n`;
  for (const folder of [source, release]) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), JSON.stringify(packageJson));
    writeFileSync(join(folder, 'package-lock.json'), JSON.stringify({ name: packageJson.name, version: packageJson.version,
      lockfileVersion: 3, packages: { '': packageJson } }));
    writeFileSync(join(folder, 'cli.js'), cli(folder === source ? 'development' : 'release'), { mode: 0o755 });
  }
  writeFileSync(join(source, 'step.mjs'), `
    import {appendFileSync} from 'node:fs';
    const step=process.argv[2];
    appendFileSync('build.log',step+'\\n');
    if(process.env.FAIL_STEP===step)process.exit(7);
  `);
  const linked = npm(['run', 'dev']);
  assert.equal(linked.status, 0, linked.stdout + linked.stderr);
  assert.equal(readFileSync(join(source, 'build.log'), 'utf8'), 'core\ntypescript\n');
  const installed = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', packageJson.name);
  assert.ok(lstatSync(installed).isSymbolicLink());
  assert.equal(realpathSync(installed), realpathSync(source));
  const run = name => spawnSync(process.execPath, [join(prefix, process.platform === 'win32' ? name : 'bin/' + name)], { encoding: 'utf8' });
  for (const name of ['jevb', 'jev-browser']) {
    assert.equal(run(name).status, 0);
    assert.equal(run(name).stdout.trim(), 'development');
  }
  writeFileSync(join(source, 'cli.js'), cli('updated-development'));
  assert.equal(run('jevb').stdout.trim(), 'updated-development');

  const packed = npm(['pack', '--ignore-scripts', '--json'], release);
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  const archive = join(release, JSON.parse(packed.stdout)[0].filename);
  const replaced = npm(['install', '--global', archive, '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(replaced.status, 0, replaced.stdout + replaced.stderr);
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  for (const name of ['jevb', 'jev-browser']) assert.equal(run(name).stdout.trim(), 'release');
  assert.equal(readFileSync(join(source, 'cli.js'), 'utf8'), cli('updated-development'));

  for (const FAIL_STEP of ['core', 'typescript']) {
    env.FAIL_STEP = FAIL_STEP;
    const failed = npm(['run', 'dev']);
    assert.notEqual(failed.status, 0);
    assert.equal(lstatSync(installed).isSymbolicLink(), false);
    assert.equal(run('jevb').stdout.trim(), 'release');
  }
});
