import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSession } from '../dist/session.js';

test('同会话互斥，不同会话可用；异常后释放锁', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await withSession('a', async () => {
    await assert.rejects(withSession('a', async () => {}, dir), { code: 'SESSION_BUSY' });
    await withSession('b', async () => {}, dir);
  }, dir);
  await assert.rejects(withSession('a', async () => { throw Error('failed'); }, dir));
  assert.equal(await withSession('a', async () => 42, dir), 42);
});
