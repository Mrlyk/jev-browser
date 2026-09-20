import { operation, type ActOptions } from './actions.js';
import { JevError } from './errors.js';
import { commandGroups, normalizeCommand, requiresSession } from './command-tree.js';

// Matches the pinned executor's global options. Command-specific arguments pass through.
const valued = new Set(`--session --restore-save --restore-check-url --restore-check-text --restore-check-fn
  --namespace --headers --executable-path --cdp --extension --init-script --enable --profile --state --proxy
  --proxy-bypass --args --user-agent -p --provider --device --session-name --color-scheme --download-path
  --max-output --allowed-domains --action-policy --confirm-actions --config --engine --input-mode
  --screenshot-dir --screenshot-quality --screenshot-format --idle-timeout --ca-cert --model`.split(/\s+/));
const boolean = new Set(`--json --headed --webgpu --no-webmcp --debug --ignore-https-errors --allow-file-access
  --hide-scrollbars --auto-connect --pin-tab --no-pin-tab --no-ca-cert --annotate --content-boundaries
  --confirm-interactive --no-auto-dialog -v --verbose -q --quiet`.split(/\s+/));
const commands = new Set(`act help open goto navigate back forward reload read click dblclick fill type hover focus
  check uncheck select drag upload download press key keydown keyup keyboard scroll scrollintoview scrollinto wait
  screenshot pdf snapshot eval close quit exit inspect auth confirm deny connect stream get is find mouse set network
  storage cookies tab window frame dialog trace profiler record console errors highlight clipboard state tap swipe
  device diff batch react vitals web-vitals a11y pushstate removeinitscript session mcp doctor install upgrade profiles
  skills dashboard plugin plugins chat webmcp`.split(/\s+/).concat(Object.keys(commandGroups)));

function globalLength(args: string[], i: number, beforeCommand = true): number {
  if (args[i] === undefined) return 0;
  if (args[i] === '--session' || args[i].startsWith('--session=')) throw new JevError('INVALID_ARGUMENT', '--session 已移除，请使用 jev-browser <资源> <动作> <会话名>，例如 jev-browser page act demo "搜索 jev" 或 jev-browser session close demo。');
  if (args[i] === '--namespace' || args[i].startsWith('--namespace=')) throw new JevError('INVALID_ARGUMENT', 'jev-browser 使用独立命名空间，请通过动作后的会话名区分会话。');
  if (valued.has(args[i])) {
    if (args[i + 1] === undefined) throw new JevError('INVALID_ARGUMENT', `${args[i]} 缺少参数。`);
    return 2;
  }
  if (boolean.has(args[i])) return ['true', 'false'].includes(args[i + 1]) ? 2 : 1;
  if (args[i].startsWith('--restore=')) return 1;
  if (args[i] === '--restore') {
    const next = args[i + 1];
    return beforeCommand && next && !next.startsWith('-') && !commands.has(next) ? 2 : 1;
  }
  return 0;
}

function validateManagement(args: string[], action: string): void {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all' && action === 'close') continue;
    const n = globalLength(args, i, false);
    if (n) { i += n - 1; continue; }
    throw new JevError('INVALID_ARGUMENT', `session ${action} 不接受额外参数。用法：jev-browser session ${action} <会话名>。`);
  }
}

function extractSession(args: string[]) {
  const scoped = requiresSession(args);
  const help = !args[1] || args.some(arg => ['--help', '-h'].includes(arg));
  const all = args[0] === 'session' && args[1] === 'close' && args[2] === '--all';
  if (!scoped || help || all) return { args, scoped, session: undefined };
  const session = args[2];
  if (session?.startsWith('--session') || session?.startsWith('--namespace')) globalLength(args, 2, false);
  const usage = `jev-browser ${args[0]} ${args[1]} <会话名> [对象] [选项]`;
  if (!session || session.startsWith('-'))
    throw new JevError('NEEDS_INPUT', `请在动作后填写会话名。用法：${usage}。`);
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(session))
    throw new JevError('INVALID_SESSION', `会话名应为 1–48 个字母、数字、下划线或短横线。用法：${usage}。`);
  if (args[0] === 'auth' && (!args[3] || args[3].startsWith('-')))
    throw new JevError('NEEDS_INPUT', '网站登录还需要已保存的账号名。用法：jev-browser auth login <会话名> <账号名>。');
  return { args: [...args.slice(0, 2), ...args.slice(3)], scoped, session };
}

export function parseArgs(args: string[]) {
  let index = 0;
  const globals: string[] = [];
  while (index < args.length) {
    const n = globalLength(args, index);
    if (!n) break;
    globals.push(...args.slice(index, index + n)); index += n;
  }
  const commandArgs = args.slice(index);
  if (Object.hasOwn(commandGroups, commandArgs[0])) {
    for (let n; (n = globalLength(commandArgs, 1, false));) globals.push(...commandArgs.splice(1, n));
  }
  const publicArgs = commandArgs[0] === 'help' && commandArgs[1] ? [...commandArgs.slice(1), '--help'] : commandArgs;
  // Validate resource/action names before consuming an operand as a session.
  const groupHelp = !publicArgs[1] || ['--help', '-h'].includes(publicArgs[1]);
  if (!groupHelp) normalizeCommand([...publicArgs.slice(0, 2), '--help']);
  const selected = extractSession(publicArgs);
  const normalized = normalizeCommand(selected.args);
  const [name, ...rest] = normalized.args;
  const showingHelp = !!normalized.help || rest.some(arg => ['--help', '-h'].includes(arg));
  if (!showingHelp && name === 'close') {
    validateManagement(rest, 'close');
    if (selected.session && rest.includes('--all'))
      throw new JevError('INVALID_ARGUMENT', '会话名和 --all 不能同时使用。用法：jev-browser session close <会话名> 或 jev-browser session close --all。');
  }
  if (!showingHelp && name === 'session' && rest[0] === 'info') validateManagement(rest.slice(1), 'inspect');
  const options: ActOptions = { instruction: '', probability: 0.85, margin: 0.2 };
  if (name === 'act' && !rest.some(arg => ['--help', '-h'].includes(arg))) {
    const words: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--') { words.push(...rest.slice(i + 1)); break; }
      if (arg === '--dry-run') { options.dryRun = true; continue; }
      if (arg === '--value-stdin') { options.valueStdin = true; continue; }
      if (['--op', '--value', '--scope', '--min-probability', '--min-margin', '--confirm', '--cancel'].includes(arg)) {
        const value = rest[++i];
        if (value === undefined) throw new JevError('INVALID_ARGUMENT', `${arg} 缺少参数。`);
        if (arg === '--op') options.op = operation(value);
        if (arg === '--value') options.value = value;
        if (arg === '--scope') options.scope = value;
        if (arg === '--min-probability') options.probability = Number(value);
        if (arg === '--min-margin') options.margin = Number(value);
        if (arg === '--confirm') options.confirm = value;
        if (arg === '--cancel') options.cancel = value;
        continue;
      }
      const n = globalLength(rest, i, false);
      if (n) { globals.push(...rest.slice(i, i + n)); i += n - 1; continue; }
      if (arg.startsWith('-')) throw new JevError('INVALID_ARGUMENT', `未知 act 参数：${arg}`);
      words.push(arg);
    }
    options.instruction = words.join(' ').trim();
    if (!options.instruction && !options.confirm && !options.cancel && !rest.some(arg => ['--help', '-h'].includes(arg))) throw new JevError('NEEDS_INPUT', 'act 需要一条指令或目标描述。');
    if ((options.confirm || options.cancel) && (options.instruction || options.op || options.value !== undefined || options.valueStdin ||
      options.scope || options.dryRun || (options.confirm && options.cancel) || rest.includes('--min-probability') || rest.includes('--min-margin')))
      throw new JevError('INVALID_ARGUMENT', '--confirm / --cancel 只能使用原计划，不能同时修改指令、参数或阈值。');
    if (options.valueStdin && options.value !== undefined) throw new JevError('INVALID_ARGUMENT', '--value 与 --value-stdin 不能同时使用。');
    for (const v of [options.probability, options.margin])
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new JevError('INVALID_ARGUMENT', '概率和差值阈值必须在 0 到 1 之间。');
    if (globals.some(x => ['--max-output', '--content-boundaries', '--confirm-interactive'].includes(x)))
      throw new JevError('INVALID_ARGUMENT', 'act 不接受截断输出、内容包裹或交互确认参数。');
  }
  // Native operations retain their arguments; reject legacy routing flags before dispatch.
  if (name !== 'act') {
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--') break;
      const n = globalLength(rest, i, false);
      if (n) i += n - 1;
    }
  }
  const routing = name === 'act' ? globals : [...globals, ...rest];
  const session = selected.session ?? 'default';
  return { name, rest, options, session, globals: [...globals, '--session', session], json: routing.includes('--json'),
    help: normalized.help, commandPath: normalized.path, sessionRequired: selected.scoped };
}
