import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, publicBrowserError } from '../dist/browser.js';
import { parseArgs } from '../dist/arguments.js';

test('仅首次打开且明确缺少 Chrome 时初始化，安装后打开一次', async () => {
  const b = new Browser([]); const calls = [];
  b.run = async args => {
    calls.push(args);
    return calls.length === 1 ? { code: 1, stdout: '', stderr: 'Chrome not found. Checked: cache' } : { code: 0, stdout: '', stderr: '' };
  };
  assert.equal(await b.passthrough(['open', 'https://example.com']), 0);
  assert.deepEqual(calls, [['open', 'https://example.com'], ['install'], ['open', 'https://example.com']]);
});

test('导航超时不安装、不重放', async () => {
  const b = new Browser([]); let calls = 0;
  b.run = async () => { calls++; return { code: 1, stdout: '', stderr: '' }; };
  assert.equal(await b.passthrough(['open', 'https://example.com']), 1);
  assert.equal(calls, 1);
});

test('敏感值只通过 stdin 单条 batch 传递，输出丢弃 echo', async () => {
  const b = new Browser([]); const secret = ' a\n`secret`'; let invocation;
  b.run = async (args, options) => {
    invocation = { args, options };
    return { code: 0, stdout: JSON.stringify([{ success: true, command: ['fill', '@e1', secret], result: { filled: true } }]), stderr: '' };
  };
  const result = await b.request(['fill', '@e1', secret], { dispatch: true, privateValue: secret });
  assert.deepEqual(invocation.args, ['--json', 'batch', '--bail']);
  assert.equal(JSON.parse(invocation.options.input)[0][2], secret);
  assert.deepEqual(result, { filled: true });
});

test('IPC 或浏览器动作超时返回结果未知且仅发送一次', async () => {
  for (const message of ['EXECUTION_UNKNOWN: Failed to read', 'Timeout waiting for navigation']) {
    const b = new Browser([]); let count = 0;
    b.run = async () => { count++; return { code: 1, stdout: JSON.stringify([{ success: false, error: message }]), stderr: '' }; };
    await assert.rejects(b.request(['click', '@e1'], { dispatch: true }), { code: 'EXECUTION_UNKNOWN', dispatched: true });
    assert.equal(count, 1);
  }
});

test('写入失败不泄露原文或 JSON 转义后的敏感值', async () => {
  const b = new Browser([]); const secret = 'password\n"quoted"';
  b.run = async () => ({ code: 1, stdout: JSON.stringify([{ success: false, error: `Invalid value ${JSON.stringify(secret)}` }]), stderr: '' });
  await assert.rejects(b.request(['fill', '@e1', secret], { dispatch: true, privateValue: secret }), error => {
    assert.equal(error.code, 'BROWSER_ERROR');
    assert.equal(error.message.includes('password'), false);
    return true;
  });
});

test('tab_gone uses public commands with the current session and connection', async () => {
  const original = 'tab_gone: bound tab is gone (target ABC, last url https://www.baidu.com/s). Run `agent-browser tab new <url>` to bind a new tab, or `agent-browser tab list` to pick an existing one';
  for (const flags of [['--auto-connect', '--pin-tab'], ['--cdp', 'ws://127.0.0.1:9222/devtools/browser']]) {
    const b = new Browser([...flags, '--session', 'demo']);
    b.run = async () => ({ code: 1, stdout: JSON.stringify({ success: false, error: original }), stderr: '' });
    await assert.rejects(b.request(['snapshot']), error => {
      assert.equal(error.code, 'BROWSER_ERROR');
      assert.equal(error.dispatched, false);
      assert.doesNotMatch(error.message, /agent-browser|tab new|[\p{Script=Han}]/u);
      assert.match(error.message, /target ABC/);
      for (const line of error.message.split('\n').slice(1)) {
        const command = line.slice(line.indexOf('jevb ')).replace('<tab-id>', 't2').replace('<url>', 'https://example.com');
        const parsed = parseArgs(command.split(' ').slice(1));
        assert.equal(parsed.session, 'demo');
        for (const flag of flags) assert.ok(parsed.globals.includes(flag) || parsed.rest.includes(flag));
        assert.ok(['tab list', 'tab switch', 'tab create'].includes(parsed.commandPath));
      }
      return true;
    });
  }
  assert.equal(publicBrowserError('Element text contains agent-browser', ['--session', 'demo']), 'Element text contains agent-browser');
  assert.match(publicBrowserError('Tab t2 not found; run `agent-browser tab` to list open tabs', ['--session', 'demo']), /`jevb tab list demo`/);
});
