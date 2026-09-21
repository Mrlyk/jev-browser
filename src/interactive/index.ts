import { JevError } from '../errors.js';
import { interactiveHelp, parseInteractive } from './options.js';

export async function startInteractive(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(interactiveHelp); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb')
    throw new JevError('TTY_REQUIRED', 'Interactive mode requires a terminal for input and output. Use commands such as jevb page in scripts.');
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
  process.stdout.write(controller.browserClosed ? 'Exited. Browser closed.\n' :
    `Exited. Reconnect with: jevb tui --session ${controller.options.session}\n`);
}
