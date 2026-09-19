#!/usr/bin/env node
import { Browser } from './browser.js';
import { parseArgs } from './arguments.js';
import { Jev, modelConfig } from './jev.js';
import { act } from './semantic.js';
import { JevError, failure } from './errors.js';
import { withSession } from './session.js';

const help = `jev-browser 0.1.1 — Jev 语义浏览器 CLI

用法：jev-browser [全局参数] <命令> [参数]

  open <url>                 打开页面；缺少本地 Chrome 时自动准备
  snapshot --json            读取结构化页面快照
  click @e1 / fill @e2 值     确定性命令，无需模型 Key
  act "点击入住信息的确认"     一次选择并执行一个原子操作
  act --op fill "姓名" --value "张三"
  act --op fill "密码" --value-stdin
  act "点击确认" --dry-run --json

act：--op、--value、--value-stdin、--scope <CSS>、--dry-run
     --min-probability <0..1>（默认 0.85）、--min-margin <0..1>（默认 0.20）
全局：--session <name>、--headed、--cdp <port|url>、--json
原子命令详见：jev-browser help

TYPESAFE_API_KEY 优先；仅配置 OPENROUTER_API_KEY 时使用 OpenRouter。
模型可用 TYPESAFE_MODEL / OPENROUTER_MODEL 固定；失败不切换通道。
`;

async function stdinValue(): Promise<string> {
  if (process.stdin.isTTY) throw new JevError('NEEDS_INPUT', '--value-stdin 需要管道输入。');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1_000_000) throw new JevError('INVALID_VALUE', '标准输入超过 1 MB。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h' || (args[0] === 'act' && args[1] === '--help')) {
    process.stdout.write(help); return;
  }
  if (args[0] === '--version' || args[0] === '-V') { process.stdout.write('jev-browser 0.1.1\n'); return; }
  const parsed = parseArgs(args);
  if (parsed.name === 'upgrade') throw new JevError('UPGRADE_VIA_NPM', '请通过 npm install -g jev-browser-cli 更新完整安装包。');
  if (parsed.name === 'dashboard') throw new JevError('UNSUPPORTED_COMMAND', '首版尚未打包上游 Dashboard。');
  const browser = new Browser(parsed.globals);
  await withSession(parsed.session, async () => {
    if (parsed.name === 'act') {
      const jev = new Jev(modelConfig());
      if (parsed.options.valueStdin) parsed.options.value = await stdinValue();
      const startupMs = Math.round(performance.now());
      const result = await act(parsed.options, browser, jev);
      result.meta.timings.cliStartupMs = startupMs;
      process.stdout.write(parsed.json ? JSON.stringify(result) + '\n' :
        `${result.data.status}: ${result.data.operation}${result.data.target ? ` @${result.data.target.ref} ${result.data.target.name}` : ''}\n` +
        (result.data.result ? JSON.stringify(result.data.result) + '\n' : ''));
    } else {
      process.exitCode = await browser.passthrough([parsed.name === 'help' || !parsed.name ? '--help' : parsed.name, ...parsed.rest]);
    }
  });
}

main().catch(error => {
  const result = failure(error);
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(result) + '\n');
  else process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = 1;
});
