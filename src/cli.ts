#!/usr/bin/env node
import { Browser } from './browser.js';
import { parseArgs } from './arguments.js';
import { resourceOverview, browserOptionsHelp, connectionHelp } from './command-tree.js';
import { runAct } from './act-cli.js';
import { JevError, failure } from './errors.js';
import { withSession } from './session.js';
import { ensureLogin, handleAuth } from './auth.js';

const help = `jev-browser 0.1.3 — Jev 语义浏览器 CLI

用法：jev-browser [全局参数] <资源> <动作> [会话名] [对象] [选项]

  page open <会话名> <url>            打开页面；缺少本地 Chrome 时自动准备
  page snapshot demo --json       读取结构化页面快照
  element click demo @e1          确定性命令，不调用模型
  page act demo "点击入住信息的确认" 选择并执行一次操作
  page act demo "搜索 jev"        并行判断输入框、内容、清空和提交
  page act demo --op fill "姓名" --value "张三"
  page act demo --op fill "密码" --value-stdin
  page act demo "点击确认" --dry-run --json
  page act demo --confirm <编号>  确认执行已展示的计划
  page act demo --cancel <编号>   取消待确认计划
  session close <会话名>    关闭指定会话，例如 session close demo
  session clear             一次关闭全部会话，无需会话名
  session list              列出运行中的会话
  auth login                登录
  auth login --with-token    从标准输入登录
  auth status / auth logout <提供方>             查看来源 / 删除本地 Key

资源命令：
${resourceOverview()}

page act：--op、--value、--value-stdin、--scope <CSS>、--dry-run
     --min-probability <0..1>（默认 0.85）、--min-margin <0..1>（默认 0.20）
${browserOptionsHelp}
会话：浏览器操作必须在动作后填写会话名，例如 page act demo "搜索 jev"。
查看参数：jev-browser <资源> <动作> --help
命令别名：jevb 与 jev-browser 等价；仅支持资源命令。

首次使用时会提示登录。
`;

const closeHelp = `用法：jev-browser session close <会话名>

  jev-browser session close demo     关闭 demo 会话
  jev-browser session clear          关闭全部会话

close 必须填写会话名；关闭全部会话请使用 session clear。连接自己的 Chrome 时只断开控制连接。
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
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(help); return;
  }
  if (args[0] === '--version' || args[0] === '-V') { process.stdout.write('jev-browser 0.1.3\n'); return; }
  const parsed = parseArgs(args);
  if (parsed.help) { process.stdout.write(parsed.help); return; }
  if (parsed.name === 'close' && parsed.rest.some(arg => ['--help', '-h'].includes(arg))) {
    process.stdout.write(closeHelp); return;
  }
  if (parsed.name === 'auth' && await handleAuth(parsed.rest, parsed.json)) return;
  if (parsed.name === 'help' && parsed.rest[0] === 'auth') { await handleAuth(['--help'], parsed.json); return; }
  const showingHelp = !parsed.name || parsed.name === 'help' || parsed.rest.some(arg => ['--help', '-h'].includes(arg));
  if ((parsed.name === 'help' && !parsed.rest.length) || (parsed.name === 'act' && showingHelp)) {
    process.stdout.write(help); return;
  }
  if (!showingHelp && !parsed.options.confirm && !parsed.options.cancel) await ensureLogin();
  if (parsed.name === 'upgrade') throw new JevError('UPGRADE_VIA_NPM', '请通过 npm install -g jev-browser-cli 更新完整安装包。');
  if (parsed.name === 'dashboard') throw new JevError('UNSUPPORTED_COMMAND', '首版尚未打包上游 Dashboard。');
  const browser = new Browser(parsed.globals);
  if (showingHelp) {
    const result = await browser.run([parsed.name === 'help' || !parsed.name ? '--help' : parsed.name, ...parsed.rest]);
    const action = parsed.commandPath?.split(' ')[1];
    const nativeCommand = `${parsed.name}${action && parsed.rest[0] === action ? ` ${action}` : ''}`;
    const text = parsed.commandPath ? result.stdout.replaceAll(`agent-browser ${nativeCommand}`, `jev-browser ${parsed.commandPath}${parsed.sessionRequired ? ' <会话名>' : ''}`) : result.stdout;
    process.stdout.write(text.replaceAll('agent-browser', 'jev-browser') + connectionHelp(parsed.commandPath?.split(' ')[0] ?? ''));
    process.stderr.write(result.stderr);
    process.exitCode = result.code;
    return;
  }
  await withSession(parsed.session, async () => {
    if (parsed.name === 'act') {
      if (parsed.options.valueStdin) parsed.options.value = await stdinValue();
      await runAct(parsed.options, browser, { session: parsed.session, json: parsed.json });
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
