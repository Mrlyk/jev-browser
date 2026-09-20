# jev-browser

A browser automation CLI for AI agents, powered by the Jev model's millisecond decisions and near-zero inference costs.

English | [简体中文](README.zh-CN.md)

- **Millisecond decisions.** Jev is a structured decision model built for fast judgments. OpenRouter reports a model-service P50 of approximately **250 ms** for Jev 1.13.
- **Near-zero inference cost.** Input costs **$0.042 per million tokens**, with free output. One project validation run made 32 real API requests for approximately **$0.000852** in total.
- **Fewer round trips.** Independent target and value questions within one operation share a single model request.

Model metrics and pricing: [OpenRouter](https://openrouter.ai/typesafe/jev-1.13), checked September 19, 2026. A complete browser operation also includes network, snapshot, and execution time. See [validation results](VALIDATION.md).

## 1. Installation

Requires Node.js 22 or later. The current prebuilt package targets macOS Apple Silicon. See [Development](#4-development) to build for other platforms.

Install the npm package `jev-browser-cli`; both `jevb` and `jev-browser` invoke the same CLI:

```bash
npm install -g jev-browser-cli
jevb --version
```

The package includes its browser executor; users do not need agent-browser or Rust. On the first `page open`, it finds Chrome or downloads it. Linux needs browser system libraries. On Linux ARM64, install Chromium and pass `--executable-path`.

### Copy to your agent

Paste this prompt into your coding agent to install both the CLI and its companion skill:

```text
Install the jev-browser CLI with `npm install -g jev-browser-cli`.
Then run `npx skills add Mrlyk/jev-browser --skill jev-browser` and select
your agent. Read the skill at
https://github.com/Mrlyk/jev-browser/blob/master/skills/jev-browser/SKILL.md
and use it for browser tasks in this project.
```

## 2. Usage

### CLI commands

Use `jevb <resource> <action> [object] [options]`. Select the browser session with `--session <name>`. Session management takes the name directly, for example `jevb session close demo`.

| Resource | Actions and purpose |
| --- | --- |
| `session` | `list`, `inspect <name>`, `close <name>`, `close --all`, `current`, `id` |
| `browser` | `connect <port-or-URL>`, `inspect`, `install`, `doctor`, `configure` |
| `page` | `open <URL>`, `act <instruction>`, `back/forward/reload`, `snapshot`, `read/get`, `wait`, `scroll`, `screenshot/pdf` |
| `element` | `click/dblclick`, `fill/type`, `check/uncheck/select`, `hover/focus`, `get/is/find`, `drag/upload/download/scrollintoview/highlight` |
| `tab` / `window` / `frame` | `tab list/create/switch/close`, `window create`, `frame switch/main` |
| `keyboard` / `mouse` / `touch` | Keyboard `press/down/up/type/inserttext`, mouse actions, touch `tap/swipe` |
| `cookie` / `storage` / `state` | Cookie `list/set/clear`, web storage, saved state `save/load/list/show/clear/clean/rename` |
| `auth` | Model `login/status/logout`; website authentication retains its subcommands |
| `network` / `dialog` / `clipboard` | Network controls, dialog `status/accept/dismiss`, clipboard access |
| `console` / `trace` / `profiler` / `record` | Logs `list/errors/clear`, tracing, profiling, recording |
| `skill` / `profile` / `script` | Skills `list/get/path`, browser profiles `list`, initialization scripts `remove` |
| `approval` / `stream` / `device` / `plugin` / `webmcp` / `server` | Executor `confirm/deny`, streaming, devices, plugins, page tools, MCP `server start` |

`page` also provides `eval/diff/react/vitals/a11y/pushstate/batch`. Use scoped help for arguments:

```bash
jevb --help
jevb page --help
jevb page open --help
jevb --session demo --headed page open https://www.baidu.com
jevb --session demo page act 'Click the search field'
jevb session inspect demo
jevb session close demo
```

Legacy top-level commands such as `open`, `act`, `click`, and `close` have been removed and report their replacement. Update scripts and agent instructions: `close demo` becomes `session close demo`, and `act` becomes `page act`.

### Why both act and open?

`page act` asks Jev to interpret natural language and then invokes browser actions. Deterministic commands such as `page open` and `element click` execute known URLs or selectors without a model decision. Both use the same executor; natural-language navigation does not require a preceding `page open`.

The CLI currently requires a full URL for navigation through `page act`, for example `jevb --session demo page act 'Open https://www.baidu.com'`. The browser extension additionally maps known site names such as “baidu” to URLs. That mapping is not yet implemented in the CLI.

### Configure a model

Sign in once with an OpenRouter or TypeSafe API key:

```bash
jev-browser auth login             # Enter your Key to sign in
jev-browser auth status            # Check the active provider
jev-browser auth logout openrouter # Remove the saved Key
```

For CI, you can also use an environment variable:

```bash
export OPENROUTER_API_KEY="your OpenRouter key"
# Or: export TYPESAFE_API_KEY="your TypeSafe key"
```

On first use, the CLI prompts you to sign in, then continues your command. For non-interactive setup, pipe the Key to `auth login --with-token`.

Environment variables override saved Keys for the same provider. When both providers have a Key, TypeSafe takes priority.

### Pair with another model or agent

Give the calling model access to a terminal tool and the [jev-browser skill](skills/jev-browser/SKILL.md). It plans the workflow and checks results; the CLI uses Jev to select a target and execute one action at a time.

The companion skill lives in `skills/jev-browser/`. Load that folder with a skill-compatible agent, or have the model read `SKILL.md` before invoking the CLI.

Its four `references/` guides cover commands, snapshots, sessions/authentication, and troubleshooting. Version 0.1.1 and later serve the main guide with `jev-browser skill get jev-browser`; add `--full` only when all references are needed.

### Operate in natural language

Open a browser, then describe each action with `page act`:

```bash
jev-browser --session demo --headed page open https://example.com
jev-browser --session demo page act 'Read the Example Domain heading'
jev-browser --session demo page act 'Click the Learn more link'
jev-browser --session demo page act 'Go back to the previous page'
jev-browser session close demo
```

`--headed` shows the browser window. Reuse the same `--session` name to keep working in the same browser.

Finish with `jev-browser session close demo`; success prints `Closed session: demo`. Without a session argument or flag, the CLI uses `JEV_BROWSER_SESSION` or falls back to `default`. The session argument, `--session`, and `--all` are mutually exclusive. Closing a session attached to your Chrome only disconnects the controller.

For your own site, open its URL first and use the actual control names. These are independent examples for pages containing the named controls:

```bash
jev-browser --session hotel page act 'Fill the "Hotel keyword" field with "Garden"'
jev-browser --session hotel page act 'Click the Search hotels button'
jev-browser --session hotel page act 'Click Book in the Standard King Room section'
jev-browser --session hotel page act 'Check the I agree to the booking terms checkbox'
```

Each `page act` performs one operation, including input followed by submission, such as `page act 'Search for jev'`. Jev judges the action, input field, value, clearing, and submission in parallel. Split other independent workflows into separate calls. Quote complex values and name the section when controls share a label. `executed` means the operation completed; verify business outcomes with page or API assertions.

Uncertain decisions display the page, target, value, clearing/submission behavior, and reason for confirmation. In a terminal, enter `y` to execute or anything else to cancel. JSON and non-interactive calls return `needs_confirmation` with a confirmation ID and commands:

```bash
jev-browser --session demo page act --confirm <confirmation-id>
jev-browser --session demo page act --cancel <confirmation-id>
```

IDs are bound to the original session, expire after five minutes, and can be used once. Confirmation rechecks the page and target before executing the displayed plan. Dry runs never execute or create executable confirmation IDs. Explicit and stdin values are hidden in output; pending plans are temporarily saved in owner-only files and removed on confirmation or cancellation.

### Useful controls

```bash
# Specify the action; let the model select its target
jev-browser --session hotel page act --op fill 'Guest name field' --value 'Alex'

# Preview the target without acting, and return JSON
jev-browser --session hotel page act --op click 'Confirm booking button' --dry-run --json

# Pass a sensitive value through stdin
printf '%s' "$TEST_PASSWORD" | jev-browser --session demo page act --op fill 'Password field' --value-stdin
```

When you know the selector, use commands such as `element click '#submit'` or `element fill '#name' 'Alex'` directly. After login, these execute without calling the model. Run `jev-browser --help` or `jev-browser help` for more options.

## 3. How it works

- **TypeScript CLI:** parses the instruction, builds target candidates from the page snapshot, and validates model answers.
- **Jev model:** selects from supplied options and returns probabilities. Input values come from the user's original text or explicit parameters; the CLI maps the choice to a browser command.
- **Bundled Rust executor:** uses forked agent-browser source to connect to the browser, perform atomic actions, and retain sessions.

Low-probability decisions require confirmation. Missing or stale targets stop execution. Targets are also rechecked between input and submission. Partially executed operations and unknown outcomes are never automatically replayed.

For `page act 'Search for jev'`, independent questions share one request, and code consumes only the relevant branches. Every relevant uncertain decision requires confirmation. Explicit `--op fill/type` retains replacement/append behavior without automatically pressing Enter.

## 4. Development

Requires Node.js 22+ and stable Rust. From the repository root:

```bash
npm ci
npm run build:core
npm run build
npm test
node dist/cli.js --help
```

For TypeScript changes in `src/`, rerun `npm run build`. Rebuild the executor with `npm run build:core` after changing Rust code in `cli/` or updating upstream source.

Create a local package:

```bash
node scripts/licenses.mjs
npm pack
```

Build and publish:

```bash
npm run publish -- --dry-run  # Build and preview without uploading
npm run publish              # Build and publish with registry credentials
```

The command builds Rust and TypeScript, collects licenses, checks the package, and publishes it. Any failed step stops the process.

Pass npm options after `--`. The build targets the current machine; the package includes binaries already present in `libexec/`.

With a dedicated test browser exposing CDP on port 9222, run `JEV_TEST_CDP=9222 npm run test:smoke`. Use `test:live` with an OpenRouter key for real model calls. Tested coverage is recorded in [VALIDATION.md](VALIDATION.md).

After building the executor, `npm run test:skills` checks skill discovery, reference loading, and retired entries without launching a browser.

## 5. License

[Apache-2.0](LICENSE). Browser execution is based on [agent-browser](https://github.com/vercel-labs/agent-browser). See [UPSTREAM.json](UPSTREAM.json) for the source revision and patches, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency licenses.
