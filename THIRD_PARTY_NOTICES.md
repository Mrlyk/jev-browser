# Third-party notices

jev-browser includes source from [agent-browser](https://github.com/vercel-labs/agent-browser), tag v0.38.1, commit aff6125c023b810ea3f2e5deec5379e9a4270bdc, under Apache-2.0. Copyright and license text are preserved in LICENSE and the imported source. The pinned upstream tree contains no NOTICE file.

The fork adds a TypeScript CLI and Jev decision layer. Rust changes isolate persisted state and configuration, name the internal binary, prevent IPC replay when enabled, and expose snapshot identities. Modified Rust files carry fork comments; UPSTREAM.json records the source revision. The original README is retained under upstream/README.md for reference and upstream tests.

The companion skill's references adapt and condense the upstream core usage guides to this fork's commands, environment and behavior. They are distributed under skills/jev-browser/.

Remaining specialty guides in source skill-data/ are retained unchanged as upstream reference material and excluded from the npm package and default CLI skill discovery.

The native binary statically links Rust dependencies. Their license declarations and available copyright/license files are collected from the locked crates in third-party/RUST-LICENSES.md. Regenerate with `node scripts/licenses.mjs` after changing Cargo.lock.

The imported accessibility engine includes axe-core 4.12.1, Copyright 2015–2026 Deque Systems, Inc., under Mozilla Public License 2.0. Its unmodified source is shipped in third-party/axe.min.js and cli/src/native/a11y/axe.min.js; the license is in third-party/MPL-2.0.txt. Its bundled dependency notices are preserved in third-party/AXE-THIRD-PARTY.txt. Upstream source: https://github.com/dequelabs/axe-core/tree/v4.12.1.

Chrome for Testing is downloaded only when required and is distributed by Google under its own terms. Chrome is not included in this npm package.
