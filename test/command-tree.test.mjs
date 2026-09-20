import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../dist/arguments.js';

const scoped = [
  [['page', 'open', 'https://example.com'], ['open', 'https://example.com']],
  [['page', 'snapshot', '-i'], ['snapshot', '-i']],
  [['element', 'fill', '#name', 'A B'], ['fill', '#name', 'A B']],
  [['tab', 'create', '--label', 'details', 'https://example.com'], ['tab', 'new', '--label', 'details', 'https://example.com']],
  [['tab', 'switch', 't2'], ['tab', 't2']], [['tab', 'close', 't2'], ['tab', 'close', 't2']],
  [['window', 'create'], ['window', 'new']], [['frame', 'switch', '#frame'], ['frame', '#frame']],
  [['keyboard', 'press', 'Enter'], ['press', 'Enter']], [['keyboard', 'type', 'A B'], ['keyboard', 'type', 'A B']],
  [['touch', 'tap', '#button'], ['tap', '#button']], [['cookie', 'list'], ['cookies', 'get']],
  [['console', 'clear'], ['console', '--clear']], [['browser', 'connect', '9222'], ['connect', '9222']],
  [['browser', 'configure', 'viewport', '1200', '800'], ['set', 'viewport', '1200', '800']],
  [['script', 'remove', 'script-id'], ['removeinitscript', 'script-id']],
  [['approval', 'confirm', 'request-id'], ['confirm', 'request-id']],
  [['network', 'requests'], ['network', 'requests']], [['network', 'route', '**/api/**', '--abort'], ['network', 'route', '**/api/**', '--abort']],
  [['storage', 'local', 'set', 'key', 'value'], ['storage', 'local', 'set', 'key', 'value']],
  [['mouse', 'click', '10', '20'], ['mouse', 'click', '10', '20']], [['dialog', 'status'], ['dialog', 'status']],
  [['stream', 'status'], ['stream', 'status']], [['trace', 'start'], ['trace', 'start']],
  [['profiler', 'start'], ['profiler', 'start']], [['record', 'stop'], ['record', 'stop']],
  [['clipboard', 'read'], ['clipboard', 'read']], [['device', 'list'], ['device', 'list']],
  [['webmcp', 'list'], ['webmcp', 'list']], [['state', 'save', 'state.json'], ['state', 'save', 'state.json']],
  [['state', 'load', 'state.json'], ['state', 'load', 'state.json']],
];

test('browser operations consume exactly the session after the action and preserve executor operands', () => {
  for (const [input, expected] of scoped) {
    const args = [...input.slice(0, 2), 'demo', ...input.slice(2)];
    const parsed = parseArgs(args);
    assert.equal(parsed.session, 'demo', args.join(' '));
    assert.deepEqual(parsed.globals, ['--session', 'demo']);
    assert.deepEqual([parsed.name, ...parsed.rest], expected);
  }
});

test('global utilities do not consume their first operand as a session', () => {
  for (const [input, expected] of [
    [['skill', 'get', 'jev-browser'], ['skills', 'get', 'jev-browser']],
    [['profile', 'list'], ['profiles']], [['server', 'start'], ['mcp']],
    [['browser', 'install'], ['install']], [['browser', 'doctor', '--offline'], ['doctor', '--offline']],
    [['browser', 'inspect'], ['inspect']], [['session', 'list'], ['session', 'list']],
    [['auth', 'login'], ['auth', 'login']], [['auth', 'login', 'typesafe'], ['auth', 'login', 'typesafe']],
    [['auth', 'status'], ['auth', 'status']], [['auth', 'save', 'work'], ['auth', 'save', 'work']],
    [['state', 'show', 'saved.json'], ['state', 'show', 'saved.json']],
    [['plugin', 'list'], ['plugin', 'list']],
  ]) assert.deepEqual([parseArgs(input).name, ...parseArgs(input).rest], expected);
  assert.deepEqual(parseArgs(['auth', 'login', 'demo', 'work']).rest, ['login', 'work']);
  assert.equal(parseArgs(['auth', 'login', 'demo', 'work']).session, 'demo');
  assert.throws(() => parseArgs(['auth', 'login', 'demo']), { code: 'NEEDS_INPUT' });
});

test('scoped operations require an explicit valid session even when an environment default exists', () => {
  const previous = process.env.JEV_BROWSER_SESSION;
  process.env.JEV_BROWSER_SESSION = 'environment-default';
  try {
    for (const [input] of scoped) assert.throws(() => parseArgs(input.slice(0, 2)), { code: 'NEEDS_INPUT' });
    for (const session of ['../demo', 'bad name', '会话', 'a'.repeat(49)])
      assert.throws(() => parseArgs(['page', 'snapshot', session]), { code: 'INVALID_SESSION' });
    assert.throws(() => parseArgs(['page', 'open', 'https://example.com']), { code: 'INVALID_SESSION' });
    assert.equal(parseArgs(['page', 'snapshot', 'chosen']).session, 'chosen');
  } finally {
    if (previous === undefined) delete process.env.JEV_BROWSER_SESSION; else process.env.JEV_BROWSER_SESSION = previous;
  }
});

test('global options keep their meaning; legacy routing options never override the positional session', () => {
  for (const args of [
    ['--headed', '--json', 'page', 'act', 'demo', '点击搜索'],
    ['page', '--headed', 'act', 'demo', '点击搜索', '--json'],
    ['page', 'act', 'demo', '点击搜索', '--headed', '--json'],
  ]) {
    const result = parseArgs(args);
    assert.equal(result.session, 'demo'); assert.equal(result.options.instruction, '点击搜索');
    assert.equal(result.json, true); assert.ok(result.globals.includes('--headed'));
  }
  for (const args of [
    ['--session', 'other', 'page', 'snapshot', 'demo'], ['page', '--session', 'other', 'snapshot', 'demo'],
    ['page', 'snapshot', 'demo', '--session', 'other'], ['page', 'act', 'demo', '点击', '--session', 'other'],
    ['page', 'snapshot', 'demo', '--namespace', 'other'],
    ['page', 'snapshot', 'demo', '--session=other'], ['--session=other', 'page', 'snapshot', 'demo'],
  ]) assert.throws(() => parseArgs(args), { code: 'INVALID_ARGUMENT' });
  const value = parseArgs(['page', 'act', 'demo', '--op', 'fill', '输入框', '--value', '--session']);
  assert.equal(value.options.value, '--session');
  assert.equal(parseArgs(['--restore', 'page', 'snapshot', 'demo']).session, 'demo');
});

test('session inspection consumes one target and legacy entry points remain rejected', () => {
  const parsed = parseArgs(['session', 'inspect', 'demo', '--json']);
  assert.equal(parsed.session, 'demo'); assert.equal(parsed.json, true);
  assert.deepEqual([parsed.name, ...parsed.rest], ['session', 'info', '--json']);
  assert.throws(() => parseArgs(['session', 'inspect', 'demo', 'other']), { code: 'INVALID_ARGUMENT' });
  for (const args of [['act', 'click'], ['open', 'https://example.com'], ['close', 'demo'],
    ['click', '@e1'], ['tab', 't2'], ['tab', 'new'], ['session', 'cloase', 'demo'], ['page', 'opne'], ['constructor']])
    assert.throws(() => parseArgs(args), error => error.code === 'INVALID_ARGUMENT' && /jev-browser/.test(error.message));
  assert.throws(() => parseArgs(['tab', 'switch', 'demo']), { code: 'NEEDS_INPUT' });
});

test('help shows positional sessions without authentication or native execution', () => {
  for (const args of [['page'], ['page', '--help'], ['help', 'page'], ['session', '--help'],
    ['page', 'act', '--help'], ['help', 'page', 'act'], ['tab', 'list', '--help'], ['session', 'inspect', '--help']]) {
    const result = spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /用法/); assert.match(result.stdout, /会话名/);
    assert.doesNotMatch(result.stdout, /--session/);
  }
});

test('CLI forwards the positional session to the executor and removes it from operation operands', t => {
  const root = mkdtempSync(join(tmpdir(), 'jev-routing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hook = join(root, 'browser.mjs');
  writeFileSync(hook, `
    import { Browser } from ${JSON.stringify(new URL('../dist/browser.js', import.meta.url).href)};
    Browser.prototype.passthrough = async function(args) {
      process.stdout.write(JSON.stringify({ args, globals: this.args })); return 0;
    };
    Browser.prototype.run = async function() {
      return { code: 0, stdout: 'Usage: agent-browser network requests [--json]\\n', stderr: '' };
    };
  `);
  for (const [input, expected] of [
    [['page', 'open', 'alpha', 'https://example.com'], ['open', 'https://example.com']],
    [['element', 'fill', 'beta', '#name', 'A B'], ['fill', '#name', 'A B']],
    [['network', 'requests', 'gamma'], ['network', 'requests']],
    [['session', 'close', 'alpha'], ['close']],
  ]) {
    const result = spawnSync(process.execPath, ['--import', hook, 'dist/cli.js', ...input], {
      env: { ...process.env, NODE_OPTIONS: '', TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: '',
        XDG_CONFIG_HOME: join(root, 'config'), JEV_BROWSER_RUNTIME_DIR: join(root, 'run'), JEV_BROWSER_SESSION: 'wrong' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.args, expected);
    assert.deepEqual(output.globals, ['--session', input[2]]);
  }
  const help = spawnSync(process.execPath, ['--import', hook, 'dist/cli.js', 'network', 'requests', '--help'],
    { env: { ...process.env, NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /network requests <会话名> \[--json\]/);
  assert.doesNotMatch(help.stdout, /requests <会话名> requests/);
});
