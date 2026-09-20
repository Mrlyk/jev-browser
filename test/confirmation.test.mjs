import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePending, takePending } from '../dist/confirmation.js';
import { planResult } from '../dist/semantic.js';
import { formatAct } from '../dist/act-cli.js';

function plan() {
  return { operation: 'fill', target: { name: '热搜推荐', role: 'textbox', context: 'generic', ref: 'e1' },
    before: { origin: 'https://example.com', pageId: 'p1' }, value: 'jev', hiddenValue: false, submit: true,
    uncertainties: [{ subject: '输入框', message: '还不能确定要使用的输入框，请确认。', probability: 0.8, margin: 0.6,
      alternatives: [{ label: '输入框「热搜推荐」', probability: 0.8 }, { label: '没有匹配项', probability: 0.2 }] }], meta: {} };
}

test('待确认计划限当前会话、私有权限、有效期、消费一次和取消', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-confirm-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = plan();
  const pending = await savePending(original, 'demo', directory);
  const path = join(directory, pending.id + '.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(takePending(pending.id, 'other', directory), { code: 'INVALID_CONFIRMATION' });
  assert.deepEqual(await takePending(pending.id, 'demo', directory), original);
  await assert.rejects(takePending(pending.id, 'demo', directory), { code: 'CONFIRMATION_NOT_FOUND' });
  const expired = await savePending(original, 'demo', directory);
  const expiredPath = join(directory, expired.id + '.json');
  const data = JSON.parse(await readFile(expiredPath, 'utf8'));
  data.expiresAt = Date.now() - 1;
  await writeFile(expiredPath, JSON.stringify(data));
  await assert.rejects(takePending(expired.id, 'demo', directory), { code: 'CONFIRMATION_EXPIRED' });
  await assert.rejects(readFile(expiredPath), { code: 'ENOENT' });
  await assert.rejects(takePending('../credentials', 'demo', directory), { code: 'INVALID_CONFIRMATION' });
  const cancel = await savePending(original, 'demo', directory);
  assert.equal(planResult(await takePending(cancel.id, 'demo', directory), 'cancelled').data.status, 'cancelled');
  await assert.rejects(takePending(cancel.id, 'demo', directory), { code: 'CONFIRMATION_NOT_FOUND' });
});

test('普通用户看到页面、输入框、内容、清空和提交；敏感值不回显', () => {
  const result = planResult(plan(), 'needs_confirmation');
  const text = formatAct({ ...result, confirmation: { id: 'example', confirmCommand: '执行命令', cancelCommand: '取消命令' } });
  for (const snippet of ['尚未执行', 'https://example.com', '输入框「热搜推荐」', 'jev', '清空后填写', '按回车提交', '执行命令', '取消命令']) assert.ok(text.includes(snippet));
  const sensitive = plan(); sensitive.hiddenValue = true; sensitive.value = 'secret-token';
  assert.equal(JSON.stringify(planResult(sensitive, 'needs_confirmation')).includes('secret-token'), false);
});

test('文本输出展示会话、操作标签页与跳转后的页面', () => {
  const p = plan();
  p.before.pageContext = { session: 'demo', tabId: 't1', targetId: 'target1', title: '百度搜索', url: p.before.origin };
  const preview = formatAct(planResult(p, 'needs_confirmation'));
  for (const text of ['会话：demo', '标签页：t1', '标题：百度搜索']) assert.ok(preview.includes(text));
  assert.equal(preview.includes('当前标签页'), false);
  p.afterPage = { session: 'demo', tabId: 't2', targetId: 'target2', title: '百科详情', url: 'https://example.com/detail' };
  const executed = formatAct(planResult(p, 'executed'));
  for (const text of ['当前标签页：t2', '当前标题：百科详情', '当前页面：https://example.com/detail']) assert.ok(executed.includes(text));
});
