import { JevError } from '../errors.js';

export const commands = [
  ['back', '后退'], ['go', '前进'], ['reload', '刷新'], ['tab', '切换标签页 [id]'],
  ['connect', '切换浏览器连接'], ['exit', '退出 [--close]'], ['up', '上滚 [px]'], ['down', '下滚 [px]'],
  ['top', '顶部'], ['bottom', '底部'], ['open', '打开 <url>'],
  ['new', '新建 [url]'], ['close', '关闭 [id]'], ['provider', '模型 [auto|typesafe|openrouter]'],
  ['status', '查看状态'], ['clear', '清理显示'], ['reset', '重置上下文'], ['help', '帮助'],
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
    throw new JevError('UNKNOWN_COMMAND', `未知命令 /${name}。${suggestion ? `是否要用 /${suggestion}？` : '输入 /help 查看命令。'}`);
  }
  return { name, value: match?.[2]?.trim() ?? '' };
}

export function navigationCommand(name: string, value: string): string[] | undefined {
  if (name === 'go') name = 'forward';
  if (['back', 'forward', 'reload'].includes(name)) {
    if (value) throw new JevError('INVALID_ARGUMENT', `/${name} 不接受参数。`);
    return [name];
  }
  if (['up', 'down'].includes(name)) {
    if (value && (!/^\d+$/.test(value) || +value < 1 || +value > 100_000)) throw new JevError('INVALID_ARGUMENT', '滚动距离需为 1–100000 的整数。');
    return ['scroll', name, value || '600'];
  }
  if (name === 'top' || name === 'bottom') {
    if (value) throw new JevError('INVALID_ARGUMENT', `/${name} 不接受参数。`);
    return ['eval', name === 'top' ? 'window.scrollTo(0,0)' : 'window.scrollTo(0,document.documentElement.scrollHeight)'];
  }
  if (name === 'open' || name === 'new') {
    const url = value || (name === 'new' ? 'about:blank' : '');
    if (url !== 'about:blank' && !/^https?:\/\//i.test(url)) throw new JevError('INVALID_ARGUMENT', '请提供完整的 http:// 或 https:// 网址。');
    try { new URL(url); } catch { throw new JevError('INVALID_ARGUMENT', '网址无效。'); }
    return name === 'open' ? ['open', url] : ['tab', 'new', url];
  }
  if (name === 'tab' || name === 'close') {
    if ((!value && name === 'tab') || (value && !/^t\d+$/.test(value))) throw new JevError('INVALID_ARGUMENT', '使用 /tab 中的稳定标签页 ID，例如 t2。');
    return name === 'tab' ? ['tab', value] : ['tab', 'close', ...(value ? [value] : [])];
  }
}
