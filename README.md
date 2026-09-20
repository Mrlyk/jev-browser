# jev-browser

A browser CLI for AI agents. Jev interprets natural-language instructions to search, click, fill fields, and read page content.

English | [简体中文](README.zh-CN.md)

## 1. Install

Requires Node.js 22+. The prebuilt package supports macOS Apple Silicon. Other platforms need a [source build](#4-local-development).

```bash
npm install -g jev-browser-cli
```

Use `jevb` or the equivalent `jev-browser`. When you first open a page, the CLI finds Chrome or downloads it if needed.

### Copy to your agent

Paste this prompt into your coding agent to install both the CLI and its companion skill:

```text
Install the jev-browser CLI with `npm install -g jev-browser-cli`.
Then run `npx skills add Mrlyk/jev-browser --skill jev-browser` and select
your agent. Read the skill at
https://github.com/Mrlyk/jev-browser/blob/master/skills/jev-browser/SKILL.md
and use it for browser tasks in this project.
```

## 2. Configure a model

Get a TypeSafe or OpenRouter API key, then sign in once:

```bash
jevb auth login
jevb auth status
```

CI can set `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`, for example:

```bash
export TYPESAFE_API_KEY="your API key"
```

Environment variables override saved keys for the same provider. When both providers have a key, TypeSafe takes priority.

For non-interactive login, logout, and credential storage, see the [authentication guide](skills/jev-browser/references/sessions-auth.md#model-api-keys).

## 3. Use commands

### Complete an operation

```bash
jevb page open demo https://www.baidu.com --headed
jevb page act demo "Search for jev"
jevb page snapshot demo
jevb session close demo
```

`demo` is the session name, placed after the action. Reuse it across related operations. `--headed` shows the browser window.

Browser operations use `jevb <resource> <action> <session> [object] [options]`. Global commands such as `auth login` and `session list` need no session.

`page act` accepts natural language. When you know the URL, selector, or key, use commands such as `page open`, `element click`, or `keyboard press` without a model decision.

Each `page act` performs one operation; a search may include typing and pressing Enter. Split other multi-step tasks into separate calls. Natural-language navigation requires a full URL.

### Common commands

Replace selectors and tab IDs with values from your page. Use `jevb <resource> <action> --help` for arguments.

| Command | Description | Example |
| --- | --- | --- |
| `page open` | Open a page | `jevb page open demo https://www.baidu.com --headed` |
| `page act` | Follow a natural-language instruction | `jevb page act demo "Search for jev"` |
| `page snapshot` | Inspect page elements and refs | `jevb page snapshot demo --json` |
| `page get` | Read page information | `jevb page get demo title` |
| `page wait` | Wait for page content | `jevb page wait demo --text "Completed"` |
| `element click` | Click an element | `jevb element click demo '#submit'` |
| `element fill` | Replace a field's contents | `jevb element fill demo '#name' 'Alex'` |
| `element type` | Append text | `jevb element type demo '#name' ' Smith'` |
| `keyboard press` | Press a key | `jevb keyboard press demo Enter` |
| `tab list` | List tabs | `jevb tab list demo` |
| `tab switch` | Switch tabs | `jevb tab switch demo t2` |
| `page screenshot` | Save a screenshot | `jevb page screenshot demo page.png` |
| `console errors` | Read page errors | `jevb console errors demo` |
| `session list` | List running sessions | `jevb session list` |
| `session inspect` | Inspect a session | `jevb session inspect demo` |
| `session close` | Close a session | `jevb session close demo` |
| `browser connect` | Connect to a browser's open debug port | `jevb browser connect demo 9222` |
| `state save` | Save login state | `jevb state save demo auth.json` |

Run `jevb --help` for all command groups. See the [command guide](skills/jev-browser/references/commands.md) for more examples.

For refs and session reuse, read the [snapshot guide](skills/jev-browser/references/snapshot-refs.md) and [session guide](skills/jev-browser/references/sessions-auth.md).

### Preview and confirm

Inspect a plan without executing it:

```bash
jevb page act demo "Search for jev" --dry-run --json
```

When uncertain, the CLI shows the page, target, value, and submission behavior. Enter `y` to execute or anything else to cancel.

With `--json`, `needs_confirmation` means nothing has executed. Use the returned ID to confirm or cancel:

```bash
jevb page act demo --confirm <confirmation-id>
jevb page act demo --cancel <confirmation-id>
```

IDs work only in the original session, expire after five minutes, and can be used once. Confirmation rechecks the page and target. `--dry-run` does not create an executable confirmation ID.

`executed` means the browser operation completed; check the page for the business result. After `EXECUTION_UNKNOWN`, inspect the state before retrying.

For other errors, see [troubleshooting](skills/jev-browser/references/troubleshooting.md).

### Specify the action and value

```bash
jevb page act demo --op fill 'Name field' --value 'Alex'
printf '%s' "$TEST_PASSWORD" | jevb page act demo --op fill 'Password field' --value-stdin
```

`--op fill` replaces contents; `--op type` appends. Neither presses Enter automatically. Values passed through `--value` or stdin are neither sent to the model nor echoed.

## 4. Local development

Requires Node.js 22+ and stable Rust. From the repository root:

```bash
npm run dev
```

This installs dependencies, builds the project, and links `jevb` and `jev-browser` to your checkout. Test from any directory; rerun after source changes.

To restore a released version, use the same Node/npm installation. This replaces the development link and keeps your source files:

```bash
npm install -g jev-browser-cli@latest
```

Run `npm test` for functional regressions. With a dedicated browser exposing CDP, run `JEV_TEST_CDP=9222 npm run test:smoke`. Real model tests use `test:live` and require `OPENROUTER_API_KEY`.

Package or publish:

```bash
node scripts/licenses.mjs
npm pack
npm run publish -- --dry-run  # Preview publication
npm run publish              # Publish with npm permissions
```

See [validation results](VALIDATION.md) for measured model latency, costs, and test coverage.

## 5. License

[Apache-2.0](LICENSE). Browser execution uses [agent-browser](https://github.com/vercel-labs/agent-browser).

See [UPSTREAM.json](UPSTREAM.json) for the source revision and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency licenses.
