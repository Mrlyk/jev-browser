import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publish } from '../scripts/publish.mjs';

const env = { npm_command: 'run-script', npm_execpath: '/npm path/npm-cli.js' };

test('发布前构建和校验，保留 dry-run 与 registry 参数且禁止递归脚本', () => {
  const calls = [];
  const args = ['--dry-run', '--tag', 'next', '--registry', 'https://registry.example.test'];
  const status = publish({ env, args }, (command, arguments_, options) => {
    calls.push({ command, args: arguments_, options }); return { status: 0 };
  });
  assert.equal(status, 0);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0].args, [env.npm_execpath, 'run', 'build:core']);
  assert.deepEqual(calls[1].args, [env.npm_execpath, 'run', 'build']);
  assert.match(calls[2].args[0], /scripts[/\\]licenses\.mjs$/);
  assert.match(calls[3].args[0], /scripts[/\\]check-package\.mjs$/);
  assert.deepEqual(calls[4].args, [env.npm_execpath, 'publish', '.', ...args, '--ignore-scripts']);
  assert.ok(calls.every(c => c.command === process.execPath && c.options.shell === false));
});

test('每个准备阶段失败都立即停止，不触发上传', () => {
  for (let failureAt = 0; failureAt < 4; failureAt++) {
    let count = 0;
    const status = publish({ env, args: [] }, () => ({ status: count++ === failureAt ? 7 : 0 }));
    assert.equal(status, 7);
    assert.equal(count, failureAt + 1);
  }
});

test('发布进程失败或被中断时返回非零状态', () => {
  for (const status of [3, null]) {
    let count = 0;
    assert.equal(publish({ env, args: [] }, () => ({ status: ++count === 5 ? status : 0 })), status ?? 1);
  }
});

test('直接 npm publish 的生命周期钩子不再次发布', () => {
  assert.equal(publish({ env: { ...env, npm_command: 'publish' }, args: [] }, () => {
    throw Error('生命周期钩子不应启动子进程');
  }), 0);
});

test('缺少 npm 上下文或无法启动子进程时不继续发布', () => {
  assert.throws(() => publish({ env: {}, args: [] }), /npm run publish/);
  assert.throws(() => publish({ env, args: [] }, () => ({ error: new Error('spawn failed') })), /spawn failed/);
});
