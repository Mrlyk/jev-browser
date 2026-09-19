import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

export function publish(options = {}, run = spawnSync) {
  const env = options.env ?? process.env;
  // npm also runs scripts.publish as a post-publication lifecycle hook.
  if (env.npm_command === 'publish') return 0;
  if (!env.npm_execpath) throw new Error('请通过 npm run publish 执行发布。');
  const args = options.args ?? process.argv.slice(2);
  const steps = [
    [env.npm_execpath, 'run', 'build:core'],
    [env.npm_execpath, 'run', 'build'],
    [join(root, 'scripts/licenses.mjs')],
    [join(root, 'scripts/check-package.mjs')],
    // Preparation was completed above. Skip lifecycle hooks to avoid recursion.
    [env.npm_execpath, 'publish', '.', ...args, '--ignore-scripts'],
  ];
  for (const step of steps) {
    const result = run(process.execPath, step, { cwd: root, env, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = publish(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
