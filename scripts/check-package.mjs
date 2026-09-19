import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
const platform = `${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
await access(new URL(`../libexec/jev-browser-core-${platform}`, import.meta.url), constants.X_OK);
for (const file of ['THIRD_PARTY_NOTICES.md', 'third-party/RUST-LICENSES.md', 'third-party/MPL-2.0.txt', 'third-party/AXE-THIRD-PARTY.txt', 'third-party/axe.min.js'])
  await access(new URL(`../${file}`, import.meta.url));
for (const file of ['SKILL.md', 'references/commands.md', 'references/snapshot-refs.md', 'references/sessions-auth.md', 'references/troubleshooting.md'])
  await access(new URL(`../skills/jev-browser/${file}`, import.meta.url));
