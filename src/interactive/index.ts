import { JevError } from '../errors.js';
import { interactiveHelp, parseInteractive } from './options.js';

export async function startInteractive(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(interactiveHelp); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb')
    throw new JevError('TTY_REQUIRED', '交互模式需要可交互的输入、输出终端。脚本请使用 jevb page 等资源命令。');
  const options = parseInteractive(args);
  const [{ render }, { createElement }, { App }, { Controller }] = await Promise.all([
    import('ink'), import('react'), import('./App.js'), import('./controller.js'),
  ]);
  const controller = new Controller(options);
  const onSignal = () => { void controller.shutdown(); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal); process.on('SIGHUP', onSignal);
  const instance = render(createElement(App, { controller }), { exitOnCtrlC: false });
  try { await instance.waitUntilExit(); }
  finally {
    await controller.shutdown(); instance.unmount();
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); process.off('SIGHUP', onSignal);
  }
  process.stdout.write(controller.browserClosed ? '已退出交互模式，浏览器已关闭。\n' :
    `已退出交互模式。继续连接：jevb tui --session ${controller.options.session}\n`);
}
