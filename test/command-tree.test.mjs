import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs } from '../dist/arguments.js';

test('resource commands dispatch to the intended executor action with unchanged operands', () => {
  const cases = [
    [['page', 'open', 'https://example.com'], ['open', 'https://example.com']],
    [['page', 'snapshot', '-i'], ['snapshot', '-i']],
    [['element', 'fill', '#name', 'A B'], ['fill', '#name', 'A B']],
    [['tab', 'create', '--label', 'details', 'https://example.com'], ['tab', 'new', '--label', 'details', 'https://example.com']],
    [['tab', 'switch', 't2'], ['tab', 't2']],
    [['tab', 'close', 't2'], ['tab', 'close', 't2']],
    [['window', 'create'], ['window', 'new']],
    [['frame', 'switch', '#frame'], ['frame', '#frame']],
    [['keyboard', 'press', 'Enter'], ['press', 'Enter']],
    [['keyboard', 'type', 'A B'], ['keyboard', 'type', 'A B']],
    [['touch', 'tap', '#button'], ['tap', '#button']],
    [['cookie', 'list'], ['cookies', 'get']],
    [['console', 'clear'], ['console', '--clear']],
    [['browser', 'connect', '9222'], ['connect', '9222']],
    [['browser', 'configure', 'viewport', '1200', '800'], ['set', 'viewport', '1200', '800']],
    [['script', 'remove', 'script-id'], ['removeinitscript', 'script-id']],
    [['approval', 'confirm', 'request-id'], ['confirm', 'request-id']],
    [['skill', 'get', 'jev-browser'], ['skills', 'get', 'jev-browser']],
    [['profile', 'list'], ['profiles']],
    [['server', 'start'], ['mcp']],
    [['network', 'requests'], ['network', 'requests']],
  ];
  for (const [input, expected] of cases) {
    const parsed = parseArgs(input);
    assert.deepEqual([parsed.name, ...parsed.rest], expected, input.join(' '));
  }
});

test('session inspect takes its target as an operand and preserves JSON output', () => {
  const parsed = parseArgs(['session', 'inspect', 'demo', '--json']);
  assert.equal(parsed.session, 'demo');
  assert.deepEqual([parsed.name, ...parsed.rest], ['session', 'info', '--json']);
  assert.equal(parsed.json, true);
  assert.throws(() => parseArgs(['session', 'inspect', 'demo', 'other']), { code: 'INVALID_ARGUMENT' });
});

test('global options before, within and after resource commands keep the same session', () => {
  for (const args of [
    ['--session', 'demo', 'page', 'act', '点击搜索'],
    ['page', '--session', 'demo', 'act', '点击搜索'],
    ['page', 'act', '点击搜索', '--session', 'demo'],
  ]) {
    const result = parseArgs(args);
    assert.equal(result.session, 'demo');
    assert.equal(result.options.instruction, '点击搜索');
  }
  assert.equal(parseArgs(['--restore', 'page', 'snapshot']).name, 'snapshot');
});

test('legacy entry points and misspelled resource actions fail with actionable guidance', () => {
  for (const args of [['act', 'click'], ['open', 'https://example.com'], ['close', 'demo'],
    ['click', '@e1'], ['tab', 't2'], ['tab', 'new'], ['session', 'cloase', 'demo'], ['page', 'opne'], ['constructor']])
    assert.throws(() => parseArgs(args), error => error.code === 'INVALID_ARGUMENT' && /jev-browser/.test(error.message));
  assert.throws(() => parseArgs(['tab', 'switch']), { code: 'NEEDS_INPUT' });
  assert.throws(() => parseArgs(['frame', 'switch']), { code: 'NEEDS_INPUT' });
});

test('group help and semantic help resolve before authentication', () => {
  for (const args of [['page'], ['page', '--help'], ['help', 'page'], ['session', '--help'],
    ['page', 'act', '--help'], ['help', 'page', 'act']]) {
    const result = spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /用法/);
  }
});
