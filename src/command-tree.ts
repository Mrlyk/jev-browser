import { JevError } from './errors.js';

type Group = { description: string; actions: Record<string, string[]> };

function direct(names: string): Record<string, string[]> {
  return Object.fromEntries(names.split(' ').map(name => [name, [name]]));
}

// Translate the public resource/action grammar to the existing executor protocol.
// Browser operations and model decisions keep their existing implementations.
export const commandGroups: Record<string, Group> = {
  session: { description: '会话管理', actions: {
    list: ['session', 'list'], ls: ['session', 'list'], inspect: ['session', 'info'],
    info: ['session', 'info'], current: ['session'], id: ['session', 'id'], close: ['close'], clear: ['close', '--all'],
  } },
  browser: { description: '浏览器连接、安装与配置', actions: {
    ...direct('connect inspect install doctor upgrade'), configure: ['set'],
  } },
  page: { description: '页面导航、语义操作、读取与检查', actions: {
    ...direct('open act back forward reload read snapshot screenshot pdf eval wait scroll get diff react vitals a11y pushstate batch'),
  } },
  element: { description: '确定性元素操作', actions: {
    ...direct('click dblclick fill type hover focus check uncheck select drag upload download scrollintoview get is find highlight'),
  } },
  tab: { description: '标签页管理', actions: {
    list: ['tab', 'list'], ls: ['tab', 'list'], create: ['tab', 'new'],
    switch: ['tab'], close: ['tab', 'close'],
  } },
  window: { description: '浏览器窗口', actions: { create: ['window', 'new'] } },
  frame: { description: '页面框架', actions: { switch: ['frame'], main: ['frame', 'main'] } },
  keyboard: { description: '键盘输入', actions: {
    press: ['press'], down: ['keydown'], up: ['keyup'], type: ['keyboard', 'type'], inserttext: ['keyboard', 'inserttext'],
  } },
  touch: { description: '触摸操作', actions: direct('tap swipe') },
  cookie: { description: 'Cookie 管理', actions: {
    list: ['cookies', 'get'], get: ['cookies', 'get'], set: ['cookies', 'set'], clear: ['cookies', 'clear'],
  } },
  console: { description: '控制台日志与错误', actions: {
    list: ['console'], clear: ['console', '--clear'], errors: ['errors'],
  } },
  script: { description: '初始化脚本', actions: { remove: ['removeinitscript'] } },
  approval: { description: '执行器操作确认', actions: direct('confirm deny') },
  skill: { description: '配套技能', actions: {
    list: ['skills', 'list'], ls: ['skills', 'list'], get: ['skills', 'get'], path: ['skills', 'path'],
  } },
  profile: { description: '本机浏览器配置档案', actions: { list: ['profiles'] } },
  server: { description: 'MCP 服务', actions: { start: ['mcp'] } },
};

export const existingGroups = {
  auth: '模型及网站登录', network: '请求与网络控制', storage: '本地存储与会话存储',
  mouse: '鼠标操作', dialog: '页面对话框', state: '登录状态文件', stream: '浏览器画面流',
  trace: '浏览器追踪', profiler: '性能分析', record: '视频录制', clipboard: '剪贴板',
  device: '设备', plugin: '执行器插件', webmcp: '页面提供的工具',
};

// Session names belong to browser operations; account/package utilities stay global.
export function requiresSession(args: string[]): boolean {
  const [resource, action, target] = args;
  if (resource === 'session') return ['close', 'inspect', 'info'].includes(action);
  if (resource === 'browser') return ['connect', 'configure'].includes(action);
  if (resource === 'state') return ['save', 'load'].includes(action);
  if (resource === 'auth') return action === 'login' && !!target && !target.startsWith('-') && !['typesafe', 'openrouter'].includes(target);
  return ['page', 'element', 'tab', 'window', 'frame', 'keyboard', 'touch', 'cookie', 'console', 'script', 'approval',
    'network', 'storage', 'mouse', 'dialog', 'stream', 'trace', 'profiler', 'record', 'clipboard', 'device', 'webmcp'].includes(resource);
}

const usages: Record<string, string> = {
  'session clear': '[--json]（关闭全部运行中的会话，无需会话名）',
  'session list': '[--json]', 'session ls': '[--json]', 'session current': '[--json]',
  'session inspect': '[--json]', 'session info': '[--json]',
  'session id': '[--scope worktree|cwd|git-root] [--prefix <前缀>]',
  'tab list': '[--json]', 'tab ls': '[--json]', 'tab create': '[URL] [--label <名称>]',
  'tab switch': '<标签页ID或名称>', 'tab close': '[标签页ID或名称]',
  'window create': '', 'frame switch': '<选择器>', 'frame main': '',
  'keyboard type': '<文本>', 'keyboard inserttext': '<文本>',
  'cookie list': '[--json]', 'cookie get': '[--json]',
  'cookie set': '<名称> <值> [--url <URL>] [--domain <域名>]', 'cookie clear': '',
  'console list': '[--json]', 'console clear': '', 'console errors': '[--clear] [--json]',
  'skill list': '[--json]', 'skill ls': '[--json]', 'skill get': '<名称> [--full] [--json]',
  'skill path': '<名称>', 'profile list': '[--json]', 'server start': '[--tools <profiles>]',
};

export const browserOptionsHelp = `浏览器连接参数：
  --auto-connect       自动连接已开启远程调试的本机 Chrome，复用标签页和登录状态
  --cdp <port|url>      连接指定调试端口或 CDP 地址；与 --auto-connect 二选一
  --pin-tab            绑定当前标签页并跟随它打开的子标签页，避免其他页面抢走绑定
  --no-pin-tab         取消固定标签页
  --headed             启动本地浏览器时显示窗口；连接已有浏览器无需此参数
  --json               以 JSON 输出操作结果，便于脚本读取

连接日常使用的 Chrome（144+）：
  先在 chrome://inspect/#remote-debugging 启用远程调试，连接时在 Chrome 中允许授权。
  jevb tab list mychrome --auto-connect
  jevb tab switch mychrome t2 --auto-connect
  jevb page snapshot mychrome --auto-connect --pin-tab
  jevb page act mychrome "搜索 jev" --auto-connect --pin-tab
  t2 替换为 tab list 返回的标签页 ID；后续使用同一会话名。
  已有固定调试端口时：jevb browser connect mychrome 9222
`;

export function connectionHelp(resource: string): string {
  return ['browser', 'page', 'tab'].includes(resource) ? `\n${browserOptionsHelp}` : '';
}

export function groupHelp(name: string): string {
  const group = commandGroups[name];
  return `用法：jev-browser ${name} <动作> [会话名] [对象] [选项]\n\n${group.description}\n\n动作：\n` +
    Object.keys(group.actions).map(action => `  ${action}`).join('\n') +
    `\n\n需要浏览器会话的动作使用：jev-browser ${name} <动作> <会话名> [对象] [选项]。\n使用 jev-browser ${name} <动作> --help 查看参数。\n` + connectionHelp(name);
}

export function normalizeCommand(args: string[]): { args: string[]; path?: string; help?: string } {
  // Both "help page open" and "page open --help" follow the same route.
  if (args[0] === 'help' && args[1]) return normalizeCommand([...args.slice(1), '--help']);
  const [resource, action, ...rest] = args;
  if (!resource || resource === 'help') return { args };
  if (Object.hasOwn(existingGroups, resource)) return { args: action ? args : [resource, '--help'], path: action ? `${resource} ${action}` : resource };
  if (!Object.hasOwn(commandGroups, resource)) {
    const replacement = Object.entries(commandGroups).flatMap(([group, spec]) =>
      Object.entries(spec.actions).filter(([, target]) => target[0] === resource).map(([verb]) => `${group} ${verb}`))[0];
    throw new JevError('INVALID_ARGUMENT', replacement
      ? `顶层命令 ${resource} 已移除，请使用：jev-browser ${replacement}。`
      : `未知资源：${resource}。使用 jev-browser --help 查看资源命令。`);
  }
  const group = commandGroups[resource];
  if (action === '--help' || action === '-h' || !action)
    return { args: ['help'], help: groupHelp(resource) };
  const target = Object.hasOwn(group.actions, action) ? group.actions[action] : undefined;
  if (!target) {
    throw new JevError('INVALID_ARGUMENT', `未知 ${resource} 动作：${action}。可用动作：${Object.keys(group.actions).join(', ')}。用法：jev-browser ${resource} --help。`);
  }
  const path = `${resource} ${action}`;
  if (Object.hasOwn(usages, path) && rest.some(arg => ['--help', '-h'].includes(arg)))
    return { args: ['help'], help: `用法：jev-browser ${path} ${requiresSession(args) ? '<会话名> ' : ''}${usages[path]}\n\n${group.description}。\n` + connectionHelp(resource) };
  if (((resource === 'tab' || resource === 'frame') && action === 'switch') &&
    (!rest.length || rest[0].startsWith('-')) && !rest.some(arg => ['--help', '-h'].includes(arg)))
    throw new JevError('NEEDS_INPUT', `缺少目标。用法：jev-browser ${resource} switch <会话名> <对象>。`);
  return { args: [...target, ...rest], path };
}

export function resourceOverview(): string {
  return [...Object.entries(commandGroups).map(([name, group]) => [name, group.description]),
    ...Object.entries(existingGroups)].map(([name, description]) => `  ${name.padEnd(12)} ${description}`).join('\n');
}
