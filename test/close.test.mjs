import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    if (existsSync(join(root, 'run'))) run(['session', 'clear'], { TYPESAFE_API_KEY: 'local-test-placeholder' });
    rmSync(root, { recursive: true, force: true });
  });
  return { root, run };
}

test('session close rejects extra operands, unknown options and conflicts before login or dispatch', t => {
  const { root, run } = fixture(t);
  for (const name of ['session close']) {
    for (const tail of [['--all'], ['demo', '--all'], ['demo', 'other'], ['--all', 'demo'], ['demo', '--sesion'], ['--all', '--unknown'],
      ['demo', '--session', 'other'], ['--session', 'demo', '--all']]) {
      const result = run([...name.split(' '), ...tail]);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /INVALID_ARGUMENT/);
      assert.match(result.stderr, /jevb session (close|clear)/);
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
  assert.throws(() => parseArgs(['session', 'close', '--all']), error =>
    error.code === 'INVALID_ARGUMENT' && /session clear/.test(error.message));
  assert.doesNotThrow(() => parseArgs(['session', 'close', 'demo', '--help']));
});

test('close help is available without login and explains session selection', t => {
  const { run } = fixture(t);
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /close <会话名>/);
  assert.match(result.stdout, /session clear/);
  assert.doesNotMatch(result.stdout, /--all/);
  const subcommand = run(['session', 'close', 'demo', '--help']);
  assert.equal(subcommand.status, 0, subcommand.stderr);
  assert.match(subcommand.stdout, /jev-browser session close demo/);
  assert.doesNotMatch(subcommand.stdout, /Browser closed|Closed session:|--all/);
  assert.equal(run(['help', 'session', 'close']).stdout, subcommand.stdout);
});

test('session clear routes to close all and rejects operands before login', t => {
  const { root, run } = fixture(t);
  for (const args of [['session', 'clear'], ['session', 'clear', '--json'], ['--json', 'session', 'clear']]) {
    const parsed = parseArgs(args);
    assert.equal(parsed.name, 'close');
    assert.equal(parsed.sessionRequired, false);
    assert.deepEqual(parsed.rest, args.at(-1) === '--json' ? ['--all', '--json'] : ['--all']);
    assert.equal(parsed.json, args.includes('--json'));
  }
  for (const tail of [['demo'], ['--all'], ['--unknown']]) {
    const result = run(['session', 'clear', ...tail]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /INVALID_ARGUMENT.*jevb session clear/);
    assert(!existsSync(join(root, 'run')));
  }
  for (const args of [['session', 'clear', '--help'], ['help', 'session', 'clear']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /jev-browser session clear/);
    assert.match(result.stdout, /关闭全部/);
  }
});

nativeTest('session clear closes every daemon and succeeds again on an empty runtime', t => {
  const { root, run } = fixture(t);
  const env = { TYPESAFE_API_KEY: 'local-test-placeholder' };
  const directory = join(root, 'run', 'namespaces', 'jev', 'run');
  for (const session of ['first', 'second']) {
    const started = run(['stream', 'status', session, '--json'], env);
    assert.equal(started.status, 0, started.stderr);
    writeFileSync(join(directory, `${session}.target`), JSON.stringify({ targetId: 'closed-tab', url: '', pinned: true }));
  }
  writeFileSync(join(directory, 'stopped.target'), '{}');
  const listed = run(['session', 'list', '--json'], env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).data.sessions.sort(), ['first', 'second']);
  const cleared = run(['session', 'clear', '--json'], env);
  assert.equal(cleared.status, 0, cleared.stderr);
  const response = JSON.parse(cleared.stdout);
  assert.equal(response.success, true);
  assert.equal(response.data.closed, 2);
  assert.deepEqual(response.data.sessions.sort(), ['first', 'second']);
  for (const session of ['first', 'second', 'stopped']) assert.equal(existsSync(join(directory, `${session}.target`)), false);
  const remaining = run(['session', 'list', '--json'], env);
  assert.equal(remaining.status, 0, remaining.stderr);
  assert.deepEqual(JSON.parse(remaining.stdout).data.sessions, []);
  const empty = run(['session', 'clear', '--json'], env);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), { success: true, data: { closed: 0, sessions: [] } });
});

nativeTest('session clear removes saved bindings even when session list is empty', t => {
  const { root, run } = fixture(t);
  const env = { TYPESAFE_API_KEY: 'local-test-placeholder' };
  const directory = join(root, 'run', 'namespaces', 'jev', 'run');
  const unrelated = join(root, 'run', 'namespaces', 'other', 'run');
  for (const path of [directory, unrelated]) mkdirSync(path, { recursive: true });
  const binding = JSON.stringify({ targetId: 'closed-tab', url: 'https://www.baidu.com/s', pinned: true });
  writeFileSync(join(directory, 'demo.target'), binding);
  writeFileSync(join(unrelated, 'keep.target'), binding);
  const listed = run(['session', 'list', '--json'], env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).data.sessions, []);
  assert.ok(existsSync(join(directory, 'demo.target')));
  const cleared = run(['session', 'clear', '--json'], env);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.deepEqual(JSON.parse(cleared.stdout), { success: true, data: { closed: 0, sessions: [] } });
  assert.equal(existsSync(join(directory, 'demo.target')), false);
  writeFileSync(join(directory, 'demo.target'), binding);
  const text = run(['session', 'clear'], env);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, 'No active sessions\n');
  assert.equal(existsSync(join(directory, 'demo.target')), false);
  assert.ok(existsSync(join(unrelated, 'keep.target')));
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
