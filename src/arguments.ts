import { operation, type ActOptions } from './actions.js';
import { JevError } from './errors.js';
import { commandGroups, normalizeCommand } from './command-tree.js';

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

function parseSessionArgs(args: string[], action: string): { rest: string[]; session?: string; all?: boolean } {
  if (args.some(arg => arg === '--help' || arg === '-h')) return { rest: args };
  const rest: string[] = [];
  let session: string | undefined, all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all' && action === 'close') { all = true; rest.push(args[i]); continue; }
    const n = globalLength(args, i, false);
    if (n) { rest.push(...args.slice(i, i + n)); i += n - 1; continue; }
    if (args[i].startsWith('-')) throw new JevError('INVALID_ARGUMENT', `未知 session ${action} 参数：${args[i]}。用法：jev-browser session ${action} [会话名]。`);
    if (session !== undefined) throw new JevError('INVALID_ARGUMENT', `session ${action} 只接受一个会话名。用法：jev-browser session ${action} demo。`);
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(args[i])) throw new JevError('INVALID_SESSION', '会话名应为 1–48 个字母、数字、下划线或短横线。');
    session = args[i];
  }
  return { rest, session, all };
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
  const normalized = normalizeCommand(commandArgs);
  const [name, ...parameters] = normalized.args;
  const inspecting = name === 'session' && parameters[0] === 'info';
  const selected = name === 'close' ? parseSessionArgs(parameters, 'close') :
    inspecting ? parseSessionArgs(parameters.slice(1), 'inspect') : undefined;
  const rest = selected ? [...(inspecting ? ['info'] : []), ...selected.rest] : parameters;
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
  const routing = name === 'act' ? globals : args;
  let session = process.env.JEV_BROWSER_SESSION || 'default';
  let explicitSession = false;
  for (let i = 0; i < routing.length; i++) {
    if (routing[i] === '--namespace') throw new JevError('INVALID_ARGUMENT', 'jev-browser 使用独立命名空间；请用 --session 区分会话。');
    if (routing[i] === '--session') { session = routing[++i]; explicitSession = true; }
    else if (valued.has(routing[i])) i++;
  }
  if (selected?.session !== undefined && explicitSession)
    throw new JevError('INVALID_ARGUMENT', `会话名与 --session 不能同时使用。用法：jev-browser session ${inspecting ? 'inspect' : 'close'} demo。`);
  if (selected?.all && (selected.session !== undefined || explicitSession))
    throw new JevError('INVALID_ARGUMENT', '--all 不能与具体会话同时使用。请选择：jev-browser session close demo 或 jev-browser session close --all。');
  session = selected?.session ?? session;
  // An explicit final session overrides project/user configuration as well.
  return { name, rest, options, session, globals: [...globals, '--session', session], json: routing.includes('--json'),
    help: normalized.help, commandPath: normalized.path };
}
