import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env };
if (existsSync(join(root, '.cache/rustup/settings.toml'))) {
  env.RUSTUP_HOME = join(root, '.cache/rustup'); env.CARGO_HOME = join(root, '.cache/cargo');
}
const result = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'cli/Cargo.toml'],
  { cwd: root, env, encoding: 'utf8', maxBuffer: 20_000_000 });
if (result.status !== 0) throw Error(result.stderr || 'cargo metadata failed');
const metadata = JSON.parse(result.stdout);
const blocks = ['# Rust dependency licenses\n\nGenerated from cli/Cargo.lock. Includes build and platform dependencies.\n'];
for (const pkg of metadata.packages.filter(p => p.source).sort((a, b) => `${a.name}${a.version}`.localeCompare(`${b.name}${b.version}`))) {
  const directory = dirname(pkg.manifest_path);
  const files = readdirSync(directory, { withFileTypes: true }).filter(e => e.isFile() && /^(licen[cs]e|copying|copyright|notice)/i.test(e.name)).map(e => e.name);
  if (pkg.license_file && !files.includes(pkg.license_file)) files.push(pkg.license_file);
  blocks.push(`\n## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license || 'See license file'}\nSource: https://crates.io/crates/${pkg.name}/${pkg.version}\n`);
  for (const file of files) blocks.push(`\n### ${file}\n\n${readFileSync(join(directory, file), 'utf8')}\n`);
}
const output = join(root, 'third-party');
mkdirSync(output, { recursive: true });
const file = join(output, 'RUST-LICENSES.md');
if (existsSync(file)) readFileSync(file);
writeFileSync(file, blocks.join('').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n');
const axe = join(output, 'axe.min.js');
if (existsSync(axe)) readFileSync(axe);
copyFileSync(join(root, 'cli/src/native/a11y/axe.min.js'), axe);
const axeNotices = join(output, 'AXE-THIRD-PARTY.txt');
if (existsSync(axeNotices)) readFileSync(axeNotices);
copyFileSync(join(root, 'cli/src/native/a11y/LICENSE-axe-core-THIRD-PARTY.txt'), axeNotices);
console.log(`Collected licenses for ${metadata.packages.length - 1} crates.`);
