# Sessions and authentication

Use for browser ownership, CDP, saved login state, and credential input. Adapted from upstream session, authentication, proxy, and trust-boundary guidance; names and paths below follow jev-browser.

## Model API keys

Version 0.1.2 and later support local model credentials and automatic login.

```bash
jev-browser auth login  # Enter your Key to sign in
printf '%s' "$OPENROUTER_API_KEY" | jev-browser auth login openrouter --with-token
jev-browser auth status --json
jev-browser auth logout openrouter
```

Commands without a configured Key prompt for login and resume after success. Help, version and model credential management do not require login. Non-interactive commands never consume their stdin as a Key; configure credentials first.

Use stdin for an authorized automated setup; keep the Key out of arguments, logs, and prompts. Failed login preserves the previous Key.

The plaintext file is `$XDG_CONFIG_HOME/jev-browser/credentials.json`, defaulting to `~/.config/jev-browser/credentials.json`. macOS/Linux permissions are `0700` for its directory and `0600` for the file. Each provider's non-empty environment variable overrides its stored Key; TypeSafe then wins across sources. `auth status` reports the selected provider and sources without exposing keys or making an API call. `logout` removes only the stored Key; an environment Key can remain active.

`auth login typesafe` and `auth login openrouter` are reserved for model keys. For website login use `jev-browser auth login <session> <saved-profile>`; `auth save/list/show/delete` remain global vault commands.

## Task ownership

Choose a unique session name for each independent task. Keep a sequential workflow in that session; use a different session for an unrelated task. Browser operations require a name immediately after the action. Names contain 1–48 letters, digits, underscores, or hyphens. `--session` is rejected, and `JEV_BROWSER_SESSION` does not replace a missing positional name.

```bash
jev-browser page open task-demo --headed --json https://example.com
jev-browser session info task-demo --json
jev-browser session close task-demo --json
```

A session lock covers observation through execution. It serializes jev-browser callers but does not prevent a human or another tool from changing a CDP browser. `SESSION_BUSY` is a conflict, not permission to remove the lock or take over another task.

## Connect to a browser

```bash
jev-browser browser connect task-demo --json 9222
jev-browser page snapshot task-demo --cdp 9222 --json
```

The browser must already expose CDP. Use a task-owned browser/profile, or one the user authorized. On a sandboxed host that cannot launch Chrome, use its supported outside-sandbox launch mechanism, then connect to the debug endpoint. Repeatedly attempting a blocked launch or disabling host safeguards does not fix the environment.

When multiple sessions share one CDP browser, choose the intended tab before pinning it:

```bash
jev-browser tab list task-demo --cdp 9222 --json
jev-browser tab switch task-demo t2 --cdp 9222 --json
jev-browser page snapshot task-demo --cdp 9222 --pin-tab --json
```

Replace `t2` with the observed tab ID or target ID. Continue passing `--pin-tab` for the shared-browser workflow. A missing bound tab should be resolved deliberately, not by interacting with whichever tab happens to be active.

## Login and state reuse

For a page with these observed controls, pass a secret through stdin and verify the logged-in state independently:

```bash
jev-browser page act task-demo --json --op fill 'Email field' --value 'user@example.test'
printf '%s' "$TEST_PASSWORD" | jev-browser page act task-demo --json --op fill 'Password field' --value-stdin
jev-browser page act task-demo --json --op click 'Sign in button'
jev-browser page wait task-demo --json --url '**/dashboard'
```

The value sent through stdin stays outside the natural-language instruction and is preserved exactly, including trailing newlines. Handle MFA or external account verification through the user's or host's supported flow; do not fabricate codes or treat a login click as proof of success.

When saved login reuse is part of the task, choose automatic restore or an explicit state file:

```bash
jev-browser page open task-demo --restore --json https://example.com
jev-browser session close task-demo --restore --json
```

Bare `--restore` uses the session name as its persistence key. Pass it consistently when using this workflow. The default restore-save policy protects previous state after a failed restore. A restored state still needs an application-specific login check.

```bash
jev-browser state save task-demo --json './auth-state.json'
jev-browser page open task-demo --state './auth-state.json' --json https://example.com
```

State files and dedicated `--profile` directories can contain credentials and account data. Use the task's intended identity, keep these files out of commits and model prompts, and close only the session owned by the task. Closing a session does not imply deletion of deliberately persisted login data.

## Configuration boundaries

Use `jev-browser.json` for this tool's configuration. User state is stored under `~/.jev-browser/`; runtime sockets/locks normally use a task-independent `jvb-<uid>` directory inside the system temporary directory. `JEV_BROWSER_RUNTIME_DIR` can change that runtime location.

Public executor settings use the `JEV_BROWSER_` prefix, for example `JEV_BROWSER_EXECUTABLE_PATH` and `JEV_BROWSER_PROFILE`. The wrapper strips inherited `AGENT_BROWSER_` settings, isolates its internal namespace, and removes both model keys from the executor environment. `--namespace` is not exposed by this wrapper; use sessions to separate tasks.

A browser `--proxy` configures browser traffic, not the TypeSafe/OpenRouter HTTP client. Preserve TLS verification and diagnose the actual certificate or proxy issue. Browser-domain restrictions have connection-mode limits; do not infer complete isolation just from passing `--allowed-domains` to an attached browser.
