import assert from 'node:assert/strict';
import { Controller } from '../dist/interactive/controller.js';
import { parseInteractive } from '../dist/interactive/options.js';
import { Browser } from '../dist/browser.js';

// Run outside a browser-launching sandbox. Each case owns a separate browser.
for (const mode of ['headed', 'headless']) {
  const session = `tm-${mode}-${process.pid}`;
  const options = parseInteractive(['--session', session, ...(mode === 'headless' ? ['--headless'] : [])]);
  const controller = new Controller(options);
  try {
    await controller.start();
    assert.match(controller.state.connection, /本地托管/, controller.state.transcript.map(x => x.text).join('\n'));
    assert.equal(controller.state.mode, mode === 'headed' ? '有头' : '无头');
    await controller.shutdown(true);
    const info = await new Browser(['--session', session]).request(['session', 'info']);
    assert.equal(info.active, false);
    console.log(`PASS ${mode}: actual mode and owned-browser cleanup`);
  } finally { await controller.shutdown(true); }
}
