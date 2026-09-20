import { randomUUID } from 'node:crypto';
import { JevError } from '../errors.js';

export type InteractiveOptions = { session: string; headed: boolean; cdp?: string; autoConnect?: boolean;
  provider: 'auto' | 'typesafe' | 'openrouter' };
export const interactiveHelp = `用法：jevb tui [选项]

  --session <名称>                  复用指定会话（默认独立 tui-<id>）
  --headed / --headless              新浏览器显示模式（默认有头）
  --cdp <端口或URL> / --auto-connect  接入已有浏览器
  --model-provider <提供方>          auto、typesafe、openrouter

输入自然语言操作浏览器，/help 查看快捷命令。退出默认保留浏览器。
`;

export function parseInteractive(args: string[]): InteractiveOptions {
  const options: InteractiveOptions = { session: `tui-${randomUUID().slice(0, 8)}`, headed: true, provider: 'auto' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headed' || arg === '--headless') { options.headed = arg === '--headed'; continue; }
    if (arg === '--auto-connect') { options.autoConnect = true; continue; }
    if (!['--session', '--cdp', '--model-provider'].includes(arg)) throw new JevError('INVALID_ARGUMENT', `未知交互参数：${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new JevError('INVALID_ARGUMENT', `${arg} 需要参数。`);
    if (arg === '--session') options.session = value;
    if (arg === '--cdp') options.cdp = value;
    if (arg === '--model-provider') {
      if (!['auto', 'typesafe', 'openrouter'].includes(value)) throw new JevError('INVALID_ARGUMENT', '提供方：auto、typesafe、openrouter。');
      options.provider = value as InteractiveOptions['provider'];
    }
  }
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(options.session)) throw new JevError('INVALID_SESSION', '会话名限 1–48 位字母、数字、下划线和短横线。');
  if (options.cdp && options.autoConnect) throw new JevError('INVALID_ARGUMENT', '--cdp 与 --auto-connect 不能同时使用。');
  return options;
}

export function browserArgs(options: InteractiveOptions): string[] {
  return ['--session', options.session, '--pin-tab', ...(options.cdp ? ['--cdp', options.cdp] :
    options.autoConnect ? ['--auto-connect'] : ['--headed', String(options.headed)])];
}
