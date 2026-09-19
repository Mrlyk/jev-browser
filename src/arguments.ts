import { operation, type ActOptions } from './actions.js';
import { JevError } from './errors.js';

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
  skills dashboard plugin plugins chat webmcp`.split(/\s+/));

function globalLength(args: string[], i: number, beforeCommand = true): number {
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

export function parseArgs(args: string[]) {
  let index = 0;
  const globals: string[] = [];
  while (index < args.length) {
    const n = globalLength(args, index);
    if (!n) break;
    globals.push(...args.slice(index, index + n)); index += n;
  }
  const name = args[index];
  const rest = args.slice(index + 1);
  const options: ActOptions = { instruction: '', probability: 0.85, margin: 0.2 };
  if (name === 'act') {
    const words: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--') { words.push(...rest.slice(i + 1)); break; }
      if (arg === '--dry-run') { options.dryRun = true; continue; }
      if (arg === '--value-stdin') { options.valueStdin = true; continue; }
      if (['--op', '--value', '--scope', '--min-probability', '--min-margin'].includes(arg)) {
        const value = rest[++i];
        if (value === undefined) throw new JevError('INVALID_ARGUMENT', `${arg} 缺少参数。`);
        if (arg === '--op') options.op = operation(value);
        if (arg === '--value') options.value = value;
        if (arg === '--scope') options.scope = value;
        if (arg === '--min-probability') options.probability = Number(value);
        if (arg === '--min-margin') options.margin = Number(value);
        continue;
      }
      const n = globalLength(rest, i, false);
      if (n) { globals.push(...rest.slice(i, i + n)); i += n - 1; continue; }
      if (arg.startsWith('-')) throw new JevError('INVALID_ARGUMENT', `未知 act 参数：${arg}`);
      words.push(arg);
    }
    options.instruction = words.join(' ').trim();
    if (!options.instruction) throw new JevError('NEEDS_INPUT', 'act 需要一条指令或目标描述。');
    if (options.valueStdin && options.value !== undefined) throw new JevError('INVALID_ARGUMENT', '--value 与 --value-stdin 不能同时使用。');
    for (const v of [options.probability, options.margin])
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new JevError('INVALID_ARGUMENT', '概率和差值阈值必须在 0 到 1 之间。');
    if (globals.some(x => ['--max-output', '--content-boundaries', '--confirm-interactive'].includes(x)))
      throw new JevError('INVALID_ARGUMENT', 'act 不接受截断输出、内容包裹或交互确认参数。');
  }
  const routing = name === 'act' ? globals : args;
  let session = process.env.JEV_BROWSER_SESSION || 'default';
  for (let i = 0; i < routing.length; i++) {
    if (routing[i] === '--namespace') throw new JevError('INVALID_ARGUMENT', 'jev-browser 使用独立命名空间；请用 --session 区分会话。');
    if (routing[i] === '--session') session = routing[++i];
    else if (valued.has(routing[i])) i++;
  }
  // An explicit final session overrides project/user configuration as well.
  return { name, rest, options, session, globals: [...globals, '--session', session], json: routing.includes('--json') };
}
