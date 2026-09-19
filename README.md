# jev-browser

A browser automation CLI for AI agents, powered by the Jev model's millisecond decisions and near-zero inference costs.

English | [简体中文](README.zh-CN.md)

- **Millisecond decisions.** Jev is a structured decision model built for fast judgments. OpenRouter reports a model-service P50 of approximately **250 ms** for Jev 1.13.
- **Near-zero inference cost.** Input costs **$0.042 per million tokens**, with free output. One project validation run made 32 real API requests for approximately **$0.000852** in total.
- **Fewer round trips.** Independent target and value questions within one operation share a single model request.

Model metrics and pricing: [OpenRouter](https://openrouter.ai/typesafe/jev-1.13), checked September 19, 2026. A complete browser operation also includes network, snapshot, and execution time. See [validation results](VALIDATION.md).

## 1. Installation

Requires Node.js 22 or later. The current prebuilt package targets macOS Apple Silicon. See [Development](#4-development) to build for other platforms.

Install the npm package `jev-browser-cli`; its command is `jev-browser`:

```bash
npm install -g jev-browser-cli
jev-browser --version
```

The package includes its browser executor; users do not need agent-browser or Rust. On the first `open`, it finds Chrome or downloads it. Linux needs browser system libraries. On Linux ARM64, install Chromium and pass `--executable-path`.

## 2. Usage

### Configure a model

Choose either an OpenRouter or a TypeSafe API key:

```bash
export OPENROUTER_API_KEY="your OpenRouter key"
# For the direct API instead: export TYPESAFE_API_KEY="your TypeSafe key"
```

When both keys are set, TypeSafe takes priority. Failed requests do not switch providers automatically.

### Pair with another model or agent

Give the calling model access to a terminal tool and the [jev-browser skill](skills/jev-browser/SKILL.md). It plans the workflow and checks results; the CLI uses Jev to select a target and execute one action at a time.

The companion skill lives in `skills/jev-browser/`. Load that folder with a skill-compatible agent, or have the model read `SKILL.md` before invoking the CLI.

### Operate in natural language

Open a browser, then describe each action with `act`:

```bash
jev-browser --session demo --headed open https://example.com
jev-browser --session demo act 'Read the Example Domain heading'
jev-browser --session demo act 'Click the Learn more link'
jev-browser --session demo act 'Go back to the previous page'
jev-browser --session demo close
```

`--headed` shows the browser window. Reuse the same `--session` name to keep working in the same browser.

For your own site, open its URL first and use the actual control names. These are independent examples for pages containing the named controls:

```bash
jev-browser --session hotel act 'Fill the "Hotel keyword" field with "Garden"'
jev-browser --session hotel act 'Click the Search hotels button'
jev-browser --session hotel act 'Click Book in the Standard King Room section'
jev-browser --session hotel act 'Check the I agree to the booking terms checkbox'
```

Each `act` performs one action. Call it sequentially for a longer workflow. Quote values to enter and name the section when controls share a label. `executed` means the action completed; verify business outcomes with page or API assertions.

### Useful controls

```bash
# Specify the action; let the model select its target
jev-browser --session hotel act --op fill 'Guest name field' --value 'Alex'

# Preview the target without acting, and return JSON
jev-browser --session hotel act --op click 'Confirm booking button' --dry-run --json

# Pass a sensitive value through stdin
printf '%s' "$TEST_PASSWORD" | jev-browser --session demo act --op fill 'Password field' --value-stdin
```

When you know the selector, use commands such as `click '#submit'` or `fill '#name' 'Alex'` directly. These do not need a model key. Run `jev-browser --help` or `jev-browser help` for more options.

## 3. How it works

- **TypeScript CLI:** parses the instruction, builds target candidates from the page snapshot, and validates model answers.
- **Jev model:** selects from supplied options and returns probabilities. Input values come from the user's original text or explicit parameters; the CLI maps the choice to a browser command.
- **Bundled Rust executor:** uses forked agent-browser source to connect to the browser, perform atomic actions, and retain sessions.

Ambiguous or stale targets stop execution. An action with an unknown outcome is never automatically replayed.

For `act 'Fill the "Name" field with "Alex"'`, the CLI first identifies the action, then asks target and value questions together.

`--op` skips action classification. Consecutive operations observe the updated page and are not batched into one model request.

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

## 5. License

[Apache-2.0](LICENSE). Browser execution is based on [agent-browser](https://github.com/vercel-labs/agent-browser). See [UPSTREAM.json](UPSTREAM.json) for the source revision and patches, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency licenses.
