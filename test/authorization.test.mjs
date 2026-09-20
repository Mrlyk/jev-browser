import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('request waits for authorization without a deadline and cancels on Ctrl+C without replay',
  { skip: process.platform === 'win32' }, t => {
    const root = mkdtempSync(join(tmpdir(), 'jev-authorization-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    cpSync(new URL('../dist', import.meta.url), join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    mkdirSync(join(root, 'libexec'));
    const calls = join(root, 'calls.log');
    writeFileSync(join(root, `libexec/jev-browser-core-${process.platform}-${process.arch}`), `#!/usr/bin/env node
      import { appendFileSync } from 'node:fs';
      appendFileSync(process.env.AUTHORIZATION_CALLS, 'request\\n');
      if (process.env.AUTHORIZATION_HANG) setInterval(() => {}, 1000);
      else setTimeout(() => console.log(JSON.stringify({ success: true, data: { connected: true } })), 700);
    `, { mode: 0o755 });
    writeFileSync(join(root, 'client.mjs'), `
      import assert from 'node:assert/strict';
      import { Browser } from './dist/browser.js';
      import { withSession } from './dist/session.js';
      import { existsSync } from 'node:fs';
      import { join } from 'node:path';
      // Speed up any parent watchdog while the fake core waits for approval.
      const realSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay / 1000, ...args);
      const browser = new Browser(['--auto-connect']);
      const listeners = process.listenerCount('SIGINT');
      if (process.env.AUTHORIZATION_HANG) {
        realSetTimeout(() => process.kill(process.pid, 'SIGINT'), 700);
        await assert.rejects(withSession('approval', () => browser.request(['snapshot'])), { code: 'EXECUTION_UNKNOWN' });
        assert.equal(existsSync(join(process.env.JEV_BROWSER_RUNTIME_DIR, 'approval.jev-lock')), false);
      } else {
        assert.deepEqual(await browser.request(['snapshot']), { connected: true });
      }
      assert.equal(process.listenerCount('SIGINT'), listeners);
    `);
    for (const hanging of [false, true]) {
      writeFileSync(calls, '');
      const result = spawnSync(process.execPath, [join(root, 'client.mjs')], {
        env: { ...process.env, NODE_OPTIONS: '', AUTHORIZATION_CALLS: calls,
          AUTHORIZATION_HANG: hanging ? '1' : '', JEV_BROWSER_RUNTIME_DIR: join(root, 'runtime') },
        encoding: 'utf8', timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(calls, 'utf8'), 'request\n');
    }
  });
