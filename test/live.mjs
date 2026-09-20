import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Browser } from '../dist/browser.js';
import { Jev, modelConfig, choice } from '../dist/jev.js';
import { act } from '../dist/semantic.js';
import { withSession } from '../dist/session.js';

const config = modelConfig({ OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, OPENROUTER_MODEL: process.env.OPENROUTER_MODEL });
const cdp = process.env.JEV_TEST_CDP;
if (!cdp) throw Error('JEV_TEST_CDP 需要指向独立测试浏览器。');
const html = await readFile(new URL('./fixtures/page.html', import.meta.url));
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const session = `live-${process.pid}`;
const browser = new Browser(['--session', session, '--cdp', cdp]);
const report = { startedAt: new Date().toISOString(), transport: config.transport, requestedModel: config.model, probe: null, cases: [] };
const cases = [
  { name: 'dry-run', options: { op: 'click', instruction: '入住信息区域的确认按钮', dryRun: true },
    assertion: async result => { assert.equal(result.data.status, 'resolved'); assert.equal((await browser.request(['get', 'text', '#result'])).text, '等待操作'); } },
  { name: '中文同名按钮', options: { instruction: '点击入住信息区域里的确认按钮' },
    assertion: async () => assert.equal((await browser.request(['get', 'text', '#result'])).text, '入住已确认') },
  { name: '显式填写', options: { op: 'fill', instruction: '姓名输入框', value: ' 张三 $() ' },
    assertion: async () => assert.equal((await browser.request(['get', 'value', '#name'])).value, ' 张三 $() ') },
  { name: '引号原文绑定', options: { instruction: '在“姓名”输入框填写“李四”' },
    assertion: async () => assert.equal((await browser.request(['get', 'value', '#name'])).value, '李四') },
  { name: '中文勾选', options: { instruction: '勾选同意用户协议' },
    assertion: async () => assert.equal((await browser.request(['is', 'checked', '#agreement'])).checked, true) },
  { name: '下拉标签', options: { op: 'select', instruction: '人数下拉框', value: '2人' },
    assertion: async () => assert.equal((await browser.request(['get', 'value', '#people'])).value, '2') },
  { name: '读取区域文本', options: { op: 'get_text', instruction: '操作结果区域', scope: '#result' },
    assertion: async result => assert.equal(result.data.result.text, '等待操作') },
  { name: '目标不存在', options: { op: 'click', instruction: '删除订单按钮' }, error: 'NO_MATCH' },
  { name: '同名歧义', options: { op: 'click', instruction: '确认按钮' }, error: 'AMBIGUOUS' },
  { name: '多步拒绝', options: { instruction: '先在姓名输入框填写“王五”，然后点击入住信息的确认按钮' }, error: 'MULTI_STEP_UNSUPPORTED' },
  { name: '否定指令', options: { instruction: '不要点击任何确认按钮' }, error: 'UNSUPPORTED_OPERATION' },
];

try {
  const probe = new Jev(config);
  const result = await probe.evaluate({ instruction: '选择北京' }, { city: choice('选择指令中的城市', { beijing: '北京', shanghai: '上海' }) });
  assert.equal(result.answers.city.choice, 'beijing');
  report.probe = probe.evidence;
  console.log(`API probe passed: ${result.model}`);
  await withSession(session, async () => {
    for (const item of process.argv.includes('--cli-only') ? [] : cases) {
      const start = performance.now();
      const jev = new Jev(config);
      const record = { name: item.name, passed: false };
      await browser.request(['open', `http://127.0.0.1:${server.address().port}`]);
      try {
        const result = await act({ probability: 0.85, margin: 0.2, ...item.options }, browser, jev);
        record.result = result;
        assert.equal(item.error, undefined, `应拒绝执行：${item.error}`);
        await item.assertion(result);
        record.passed = true;
      } catch (error) {
        record.error = { code: error.code, message: error.message };
        record.passed = !!item.error && error.code === item.error;
        if (record.passed) {
          assert.equal((await browser.request(['get', 'text', '#result'])).text, '等待操作');
          assert.equal((await browser.request(['get', 'value', '#name'])).value, '');
          assert.equal((await browser.request(['is', 'checked', '#agreement'])).checked, false);
        }
      }
      record.decisions = jev.evidence;
      record.durationMs = Math.round(performance.now() - start);
      report.cases.push(record);
      console.log(`${record.passed ? 'PASS' : 'FAIL'} ${item.name}: ${record.error?.code ?? record.result?.data.status} (${record.durationMs} ms)`);
    }
  });
  await browser.request(['open', `http://127.0.0.1:${server.address().port}`]);
  const cliStart = performance.now();
  const cliResult = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
      '--cdp', cdp, '--json', 'page', 'act', session, '--op', 'fill', '姓名输入框', '--value-stdin'], {
      env: { ...process.env, TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: config.key }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      try { assert.equal(code, 0, stdout + stderr); resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end('CLI 真实验证');
  });
  assert.equal(cliResult.success, true);
  assert.equal((await browser.request(['get', 'value', '#name'])).value, 'CLI 真实验证');
  report.cases.push({ name: '真实 CLI 与 stdin', passed: true, result: cliResult,
    decisions: cliResult.meta.decisions, durationMs: Math.round(performance.now() - cliStart) });
  console.log('PASS 真实 CLI 与 stdin');
} catch (error) {
  report.fatal = { code: error.code, message: error.message };
  console.error(`Live validation stopped: ${error.code || error.name} ${error.message}`);
} finally {
  await browser.request(['close']).catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await mkdir('.cache', { recursive: true });
  const path = `.cache/live-validation-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(`Report: ${path}`);
  if (report.fatal || report.cases.some(c => !c.passed)) process.exitCode = 1;
}
