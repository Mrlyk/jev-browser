# jev-browser

Control your browser with natural language in an interactive terminal, or use structured CLI commands from an AI agent.

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

Start `jevb`. If no API key is configured, it prompts you to sign in with a TypeSafe or OpenRouter key. Input is hidden; after login, the terminal opens automatically. You can also sign in separately:

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

### Interactive terminal

```bash
jevb
```

![Jev interactive terminal](docs/images/interactive-terminal.png)

By default, jevb connects to your existing Chrome. Enable remote debugging at `chrome://inspect/#remote-debugging` and allow the connection.

```bash
jevb tui --headed                     # Launch a headed browser
jevb tui --headless                   # Launch a headless browser
jevb tui --session demo               # Reuse an existing session
jevb tui --cdp 9222                   # Connect to a specific browser
jevb tui --auto-connect               # Connect to local Chrome
jevb tui --model-provider openrouter  # Choose a model provider
```

| Command | Action |
| --- | --- |
| `/back`, `/go`, `/reload` | Navigate or refresh |
| `/up [px]`, `/down [px]`, `/top`, `/bottom` | Scroll |
| `/open <url>`, `/new [url]` | Open a page or new tab |
| `/tab`, `/tab <id>`, `/close [id]` | Select, switch, or close a tab |
| `/provider auto\|typesafe\|openrouter` | Change model provider for this session |
| `/connect` | Choose existing Chrome, CDP, headed, headless, or an existing session |
| `/status` | Show session and connection statistics |
| `/clear`, `/reset` | Clear the display or reset operation context |
| `/help`, `/exit` | Show commands or exit |

`/connect auto` attaches to Chrome; `/connect headed` or `/connect headless` launches a new browser; `/connect cdp 9222` uses a specific address. The previous browser stays open.

The selected tab stays bound to the session. Use `/tab` to change it. `/exit` keeps the browser running; reconnect with the printed session command. `/exit --close` also closes a browser created by this interaction.

### Agent and script commands

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

Pages with many candidates are evaluated in batches of up to 253 targets, plus no-match and ambiguity options. The top two from each batch enter a final comparison; the highest-probability target wins, with confirmation when uncertain.

Requests also split by input size. If a single target or shared context is too large, narrow the scope with `--scope`.

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
| `session clear` | Close all running sessions | `jevb session clear` |
| `browser connect` | Connect to a browser's open debug port | `jevb browser connect demo 9222` |
| `state save` | Save login state | `jevb state save demo auth.json` |

Run `jevb --help` for all command groups. See the [command guide](skills/jev-browser/references/commands.md) for more examples.

For refs and session reuse, read the [snapshot guide](skills/jev-browser/references/snapshot-refs.md) and [session guide](skills/jev-browser/references/sessions-auth.md).

### Browser connection options

| Option | Purpose | Example |
| --- | --- | --- |
| `--auto-connect` | Connect to local Chrome with remote debugging enabled, reusing tabs and login state | `jevb tab list mychrome --auto-connect` |
| `--cdp <port\|url>` | Connect to a specific debug port or CDP address; cannot be combined with `--auto-connect` | `jevb page snapshot mychrome --cdp 9222` |
| `--pin-tab` | Bind the session to the selected tab and follow tabs it opens; other pages cannot take over the binding | `jevb page snapshot mychrome --auto-connect --pin-tab` |
| `--no-pin-tab` | Stop pinning the selected tab | `jevb page snapshot mychrome --auto-connect --no-pin-tab` |
| `--headed` | Show the window when launching a local browser; unnecessary when attaching to an existing browser | `jevb page open demo https://example.com --headed` |
| `--json` | Output operation results as JSON for scripts | `jevb tab list mychrome --auto-connect --json` |

To connect to your everyday Chrome (144+), open `chrome://inspect/#remote-debugging` and enable remote debugging. `--auto-connect` keeps the connection open until you answer Chrome's authorization prompt, with no authorization deadline. Allow the connection to continue, or press `Ctrl+C` to cancel:

```bash
jevb tab list mychrome --auto-connect
jevb tab switch mychrome t2 --auto-connect
jevb page snapshot mychrome --auto-connect --pin-tab
jevb page act mychrome "Search for jev" --auto-connect --pin-tab
```

Replace `t2` with the target tab ID from the list and keep using the same session name. These options also appear in `jevb help`, `jevb help browser connect`, `jevb help page act`, and `jevb help tab list`.

When a link in the bound page opens a new tab, the session follows it. `tab create` also switches the binding to the new tab. Use `tab switch` to select another existing tab.

If a bound tab has closed, a `page act` instruction to open a website creates a new tab. Clicking or filling still requires selecting a page. `session clear` removes all saved tab bindings, including those left by sessions that have already exited.

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

Run `npm test` for functional regressions. Terminal tests require Python 3 on macOS or Linux. Browser tests require a dedicated CDP browser; `test:live` and `test:tui:live` also need a configured model key.

```bash
npm run test:tui
npm run test:connections
JEV_TEST_CDP=9222 npm run test:smoke
JEV_TEST_CDP=9222 npm run test:tui:live
```

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
