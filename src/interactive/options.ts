import { randomUUID } from 'node:crypto';
import { JevError } from '../errors.js';

export type InteractiveOptions = { session: string; headed: boolean; cdp?: string; autoConnect?: boolean;
  provider: 'auto' | 'typesafe' | 'openrouter' };
export const interactiveHelp = `Usage: jevb tui [options]

  --session <name>                  Reuse a session (default: tui-<id>)
  --headed / --headless              Launch a headed or headless browser
  --cdp <port|url> / --auto-connect   Attach to Chrome (default: auto-connect)
  --model-provider <provider>        auto, typesafe, openrouter

Type / for commands, /connect to switch browsers, or /exit to leave the browser open.
`;

export function parseInteractive(args: string[]): InteractiveOptions {
  const options: InteractiveOptions = { session: `tui-${randomUUID().slice(0, 8)}`, headed: true, provider: 'auto' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headed' || arg === '--headless') { options.headed = arg === '--headed'; continue; }
    if (arg === '--auto-connect') { options.autoConnect = true; continue; }
    if (!['--session', '--cdp', '--model-provider'].includes(arg)) throw new JevError('INVALID_ARGUMENT', `Unknown interactive option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new JevError('INVALID_ARGUMENT', `Missing value for ${arg}.`);
    if (arg === '--session') options.session = value;
    if (arg === '--cdp') options.cdp = value;
    if (arg === '--model-provider') {
      if (!['auto', 'typesafe', 'openrouter'].includes(value)) throw new JevError('INVALID_ARGUMENT', 'Choose auto, typesafe, or openrouter.');
      options.provider = value as InteractiveOptions['provider'];
    }
  }
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(options.session)) throw new JevError('INVALID_SESSION', 'Session names must contain 1–48 letters, digits, underscores, or hyphens.');
  if (options.cdp && options.autoConnect) throw new JevError('INVALID_ARGUMENT', 'Cannot combine --cdp with --auto-connect.');
  const launch = args.includes('--headed') || args.includes('--headless');
  if (launch && (options.cdp || options.autoConnect)) throw new JevError('INVALID_ARGUMENT', 'Cannot combine browser launch and attachment options.');
  if (args.includes('--headed') && args.includes('--headless')) throw new JevError('INVALID_ARGUMENT', 'Cannot combine --headed with --headless.');
  if (!launch && !options.cdp && !args.includes('--session')) options.autoConnect = true;
  return options;
}

export function browserArgs(options: InteractiveOptions): string[] {
  return ['--session', options.session, '--pin-tab', ...(options.cdp ? ['--cdp', options.cdp] :
    options.autoConnect ? ['--auto-connect'] : ['--headed', String(options.headed)])];
}
