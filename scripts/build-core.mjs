import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env };
if (existsSync(join(root, '.cache/rustup/settings.toml'))) {
  env.RUSTUP_HOME = join(root, '.cache/rustup');
  env.CARGO_HOME = join(root, '.cache/cargo');
}
const result = spawnSync('cargo', ['build', '--profile', 'ci', '--locked', '--manifest-path', 'cli/Cargo.toml'], { cwd: root, env, stdio: 'inherit', shell: false });
if (result.error || result.status !== 0) process.exit(result.status || 1);
mkdirSync(join(root, 'libexec'), { recursive: true });
const suffix = process.platform === 'win32' ? '.exe' : '';
const destination = join(root, `libexec/jev-browser-core-${process.platform}-${process.arch}${suffix}`);
copyFileSync(join(root, `cli/target/ci/jev-browser-core${suffix}`), destination);
chmodSync(destination, 0o755);
console.log(destination);
