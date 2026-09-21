import { JevError } from '../errors.js';

export const commands = [
  ['back', 'Back'], ['go', 'Forward'], ['reload', 'Reload'], ['tab', 'Switch tabs [id]'],
  ['connect', 'Change connection'], ['exit', 'Exit [--close]'], ['up', 'Scroll up [px]'], ['down', 'Scroll down [px]'],
  ['top', 'Scroll to top'], ['bottom', 'Scroll to bottom'], ['open', 'Open <url>'],
  ['new', 'New tab [url]'], ['close', 'Close tab [id]'], ['provider', 'Provider [auto|typesafe|openrouter]'],
  ['status', 'Show status'], ['clear', 'Clear display'], ['reset', 'Reset context'], ['help', 'Help'],
] as const;
export const aliases: Record<string, string> = { 后退: '/back', 前进: '/go', 刷新: '/reload', 上滚: '/up', 下滚: '/down' };
const legacy: Record<string, string> = { forward: 'go', quit: 'exit', tabs: 'tab', browser: 'connect' };
export const commandHelp = commands.map(([name, label]) => `/${name}  ${label}`).join('\n');

export function parseCommand(text: string) {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
  const raw = match?.[1] ?? 'help';
  const name = Object.hasOwn(legacy, raw) ? legacy[raw] : raw;
  if (!commands.some(([key]) => key === name)) {
    const suggestion = commands.find(([key]) => key.startsWith(name.slice(0, 2)))?.[0];
    throw new JevError('UNKNOWN_COMMAND', `Unknown command /${name}. ${suggestion ? `Did you mean /${suggestion}?` : 'Use /help to see commands.'}`);
  }
  return { name, value: match?.[2]?.trim() ?? '' };
}

export function navigationCommand(name: string, value: string): string[] | undefined {
  if (name === 'go') name = 'forward';
  if (['back', 'forward', 'reload'].includes(name)) {
    if (value) throw new JevError('INVALID_ARGUMENT', `/${name} takes no arguments.`);
    return [name];
  }
  if (['up', 'down'].includes(name)) {
    if (value && (!/^\d+$/.test(value) || +value < 1 || +value > 100_000)) throw new JevError('INVALID_ARGUMENT', 'Scroll distance must be an integer from 1 to 100000.');
    return ['scroll', name, value || '600'];
  }
  if (name === 'top' || name === 'bottom') {
    if (value) throw new JevError('INVALID_ARGUMENT', `/${name} takes no arguments.`);
    return ['eval', name === 'top' ? 'window.scrollTo(0,0)' : 'window.scrollTo(0,document.documentElement.scrollHeight)'];
  }
  if (name === 'open' || name === 'new') {
    const url = value || (name === 'new' ? 'about:blank' : '');
    if (url !== 'about:blank' && !/^https?:\/\//i.test(url)) throw new JevError('INVALID_ARGUMENT', 'Enter a full http:// or https:// URL.');
    try { new URL(url); } catch { throw new JevError('INVALID_ARGUMENT', 'Invalid URL.'); }
    return name === 'open' ? ['open', url] : ['tab', 'new', url];
  }
  if (name === 'tab' || name === 'close') {
    if ((!value && name === 'tab') || (value && !/^t\d+$/.test(value))) throw new JevError('INVALID_ARGUMENT', 'Use a tab ID from /tab, such as t2.');
    return name === 'tab' ? ['tab', value] : ['tab', 'close', ...(value ? [value] : [])];
  }
}
