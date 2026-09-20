import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../dist/arguments.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
// Opt in separately; ordinary functional tests do not launch native daemons.
const nativeTest = process.env.JEV_TEST_NATIVE === '1' ? test : test.skip;

function fixture(t) {
  const root = mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'jvc-'));
  writeFileSync(join(root, 'browser.json'), '{}');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('JEV_BROWSER_') && !/^(https?|all|no)_proxy$/i.test(key)));
  Object.assign(env, { TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: '', NODE_OPTIONS: '',
    XDG_CONFIG_HOME: join(root, 'config'), JEV_BROWSER_RUNTIME_DIR: join(root, 'run'),
    JEV_BROWSER_CONFIG: join(root, 'browser.json') });
  const run = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], {
    env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL',
  });
  t.after(() => {
    if (existsSync(join(root, 'run'))) run(['session', 'close', '--all'], { TYPESAFE_API_KEY: 'local-test-placeholder' });
    rmSync(root, { recursive: true, force: true });
  });
  return { root, run };
}

test('session close rejects extra operands, unknown options and conflicts before login or dispatch', t => {
  const { root, run } = fixture(t);
  for (const name of ['session close']) {
    for (const tail of [['demo', 'other'], ['--all', 'demo'], ['demo', '--sesion'], ['--all', '--unknown'],
      ['demo', '--session', 'other'], ['--session', 'demo', '--all']]) {
      const result = run([...name.split(' '), ...tail]);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /INVALID_ARGUMENT/);
      assert.match(result.stderr, /jev-browser session close/);
      assert(!existsSync(join(root, 'run')), 'invalid input must not create a session');
    }
  }
  const json = run(['session', 'close', 'demo', 'other', '--json']);
  assert.equal(json.status, 1);
  assert.equal(json.stderr, '');
  assert.equal(JSON.parse(json.stdout).error.code, 'INVALID_ARGUMENT');
});

test('session close accepts targets and flags, while legacy entry points fail', () => {
  for (const args of [
    ['session', 'close', 'demo'], ['--json', 'session', 'close', 'demo'],
  ]) assert.equal(parseArgs(args).session, 'demo');
  assert.deepEqual(parseArgs(['session', 'close', 'demo', '--json']).rest, ['--json']);
  for (const args of [['close', 'demo'], ['--session', 'demo', 'close'], ['quit'], ['exit'],
    ['--session', 'demo', 'session', 'close'], ['session', 'close', '--session', 'demo'],
    ['session', 'cloase', 'demo'], ['session', 'close', 'demo', '--session', 'other']])
    assert.throws(() => parseArgs(args), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseArgs(['session', 'close', '../demo']), { code: 'INVALID_SESSION' });
  assert.doesNotThrow(() => parseArgs(['session', 'close', '--all']));
  assert.doesNotThrow(() => parseArgs(['session', 'close', 'demo', '--help']));
});

test('close help is available without login and explains session selection', t => {
  const { run } = fixture(t);
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /close <会话名>/);
  assert.match(result.stdout, /close --all/);
  const subcommand = run(['session', 'close', 'demo', '--help']);
  assert.equal(subcommand.status, 0, subcommand.stderr);
  assert.match(subcommand.stdout, /jev-browser session close demo/);
  assert.doesNotMatch(subcommand.stdout, /Browser closed|Closed session:/);
  assert.equal(run(['help', 'session', 'close']).stdout, subcommand.stdout);
});

nativeTest('real executor names the closed session in text and JSON without launching a browser', t => {
  const { run } = fixture(t);
  // An isolated runtime and close-only commands exercise the daemon lifecycle;
  // no browser launch or model request is needed.
  const env = { TYPESAFE_API_KEY: 'local-test-placeholder' };
  for (const [args, session] of [
    [['session', 'close', 'named'], 'named'],
    [['session', 'close', 'demo'], 'demo'],
    [['session', 'close', 'flags'], 'flags'],
    [['session', 'close', 'other'], 'other'],
    [['session', 'close', 'default'], 'default'],
  ]) {
    const result = run(args, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Closed session: ${session}\\n$`));
  }
  const result = run(['session', 'close', 'from-argument', '--json'], { ...env, JEV_BROWSER_SESSION: 'from-env' });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.success, true);
  assert.equal(response.data.closed, true);
  assert.equal(response.data.session, 'from-argument');
  const explicit = run(['session', 'close', 'explicit', '--json'], { ...env, JEV_BROWSER_SESSION: 'from-env' });
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(JSON.parse(explicit.stdout).data.session, 'explicit');
});

nativeTest('session close removes only its named daemon from the active session list', t => {
  const { run } = fixture(t);
  const env = { TYPESAFE_API_KEY: 'local-test-placeholder' };
  for (const session of ['target', 'keep']) {
    const started = run(['stream', 'status', session, '--json'], env);
    assert.equal(started.status, 0, started.stderr);
  }
  const closed = run(['session', 'close', 'target', '--json'], env);
  assert.equal(closed.status, 0, closed.stderr);
  assert.equal(JSON.parse(closed.stdout).data.session, 'target');
  const remaining = run(['session', 'list', '--json'], env);
  assert.equal(remaining.status, 0, remaining.stderr);
  assert.deepEqual(JSON.parse(remaining.stdout).data.sessions, ['keep']);
});
