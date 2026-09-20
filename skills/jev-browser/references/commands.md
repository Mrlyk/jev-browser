# Commands

Use for command syntax and choosing between semantic and deterministic actions. Examples assume an already selected, task-owned session and matching controls; replace URLs, selectors, labels, and observed refs. This is a curated adaptation of agent-browser v0.38.1's core command guide for jev-browser.

Use `--json` for machine-readable operation results and check the exit code as well. This flag controls output formatting and does not itself invoke a model. Help and version output remain text, and result/error fields vary by command; do not assume every response uses the `page act` schema. For listing, closing, or clearing sessions, read [sessions-auth.md](sessions-auth.md).

## Semantic actions

```bash
jev-browser page act task-demo --json --op fill 'Guest name field' --value 'Alex'
jev-browser page act task-demo --json --op click 'Book button in the Standard King Room section'
jev-browser page act task-demo --json --op check 'Booking terms checkbox'
jev-browser page act task-demo --json --op uncheck 'Request invoice checkbox'
jev-browser page act task-demo --json --op select 'Room count dropdown' --value '2 rooms'
jev-browser page act task-demo --json --op fill 'Check-out date field' --value '2026-10-13'
jev-browser page act task-demo --json --op get_text 'Order total'
```

`fill` replaces a value; `type` appends. Native `select` accepts a value or visible label. A custom dropdown normally requires separate open and option-click operations. Native dates use ISO values; malformed dates are rejected without clearing the previous value. Resolve relative dates from the task's time zone before supplying an explicit value.

Supported semantic operations: `click`, `dblclick`, `fill`, `type`, `check`, `uncheck`, `hover`, `focus`, `select`, `scrollintoview`, `get_text`, `open`, `back`, `forward`, `reload`, `scroll`, `press`. Other executor capabilities use atomic commands, not invented `page act <session> --op` values.

```bash
jev-browser page act task-demo --json 'Fill the "Guest name" field with "Alex"'
jev-browser page act task-demo --json --op click 'Confirm button' --scope '#guest-section' --dry-run
jev-browser page act task-demo --json --op focus 'Search field'
jev-browser page act task-demo --json --op press 'Press Enter' --value Enter
jev-browser page act task-demo --json --op scroll 'Scroll down' --value down
```

`--scope` is a confirmed CSS selector. `--dry-run` selects and checks a target without acting. Semantic `scroll` moves 500 px in `up`, `down`, `left`, or `right`. Semantic `press` accepts common keys such as Enter, Tab, Escape, arrows, and `Control+a`/`Meta+a`; use help and atomic `press` for additional key syntax.

Without `--op`, action, input target, source value, clearing, and submission judgments share one model request. Only relevant branches affect execution. `page act demo '搜索 jev'` can fill the search field and press Enter. Explicit `--op fill/type` keeps its atomic behavior and does not submit. Values supplied through `--value` or stdin are not sent to the model or echoed.

When `data.status` is `needs_confirmation`, inspect `data.plan` and `data.uncertainties` and obtain the user's decision before using the returned `confirmation.confirmCommand` or `confirmation.cancelCommand`. Do not automatically confirm or lower thresholds. The ID expires after five minutes, is bound to the original session, and is consumed once. Confirmation reuses the displayed plan without a new model call and revalidates the page and target. `--dry-run` does not create a confirmation ID.

For CI, use `--non-interactive`: it disables login, URL and confirmation prompts and does not create pending plans. A confident plan still executes; an uncertain plan returns `needs_confirmation` with exit code 2 and no confirmation ID. Log in beforehand. Without this flag, JSON and non-TTY callers retain confirmation IDs for user-approved follow-up commands.

`page act` exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Executed, resolved dry-run, or cancelled. Verify `data.status` and the expected business state. |
| 1 | Error before dispatch. Read `error.code`. |
| 2 | Needs confirmation; nothing executed. Includes uncertain dry-runs. Parse the result even though the exit code is nonzero. |
| 3 | `EXECUTION_UNKNOWN` or an error with `dispatched: true`. Inspect the page before any retry. |

JSON results preserve available model evidence in `meta.decisions`, including `NO_MATCH`, `AMBIGUOUS`, validation and execution errors. Each decision includes `answers` with model probabilities. Failures before a model answer may have empty or absent evidence. `success: true` alone does not mean an action executed.

```bash
jev-browser page act ci-demo --json --non-interactive --op click 'Learn more link'
jev-browser page act task-demo --json '搜索 jev'
jev-browser page act task-demo --json --confirm <confirmation-id>
jev-browser page act task-demo --json --cancel <confirmation-id>
```

## Navigation and deterministic interaction

```bash
jev-browser page open task-demo --json https://example.com
jev-browser page back task-demo --json
jev-browser page forward task-demo --json
jev-browser page reload task-demo --json
jev-browser element click task-demo --json '#submit'
jev-browser element fill task-demo --json '#guest-name' 'Alex'
jev-browser element type task-demo --json '#guest-name' ' Smith'
jev-browser element select task-demo --json '#room-count' '2'
jev-browser element check task-demo --json '#terms'
jev-browser element hover task-demo --json '@e12'
jev-browser keyboard press task-demo --json Enter
jev-browser page scroll task-demo --json down 500
jev-browser element scrollintoview task-demo --json '#footer'
```

Atomic commands take selectors or observed refs, not natural-language target descriptions. They do not call Jev. Snapshot/ref usage is covered in [snapshot-refs.md](snapshot-refs.md).

## Read and independently verify

```bash
jev-browser page get task-demo --json title
jev-browser page get task-demo --json url
jev-browser page get task-demo --json text '#order-id'
jev-browser page get task-demo --json value '#guest-name'
jev-browser page get task-demo --json attr '#details-link' href
jev-browser page get task-demo --json count '.hotel-card'
jev-browser element is task-demo --json visible '#confirmation'
jev-browser element is task-demo --json enabled '#submit'
jev-browser element is task-demo --json checked '#terms'
```

`page act <session> --op get_text` returns text in `data.result.text`. Atomic `get text` and `get value` return `data.text` and `data.value`. State checks return fields such as `data.visible`, `data.enabled`, and `data.checked`. Inspect the actual result rather than assuming every command has the `page act` envelope.

## Wait for a result

```bash
jev-browser page wait task-demo --json '#confirmation'
jev-browser page wait task-demo --json --text 'Booking confirmed' --timeout 15000
jev-browser page wait task-demo --json --url '**/orders/**' --timeout 15000
jev-browser page wait task-demo --json --load domcontentloaded
```

Choose a selector, text, or URL that represents the expected outcome. A load event alone does not prove an asynchronous search or order submission finished. Polling and persistent connections can prevent `networkidle`; do not use it as a universal wait. A timeout after a write does not authorize replaying the write.

## Tabs and frames

```bash
jev-browser tab list task-demo --json
jev-browser tab create task-demo --json --label details https://example.com
jev-browser tab switch task-demo details --json
jev-browser tab close task-demo --json details
jev-browser frame switch task-demo '#booking-frame' --json
jev-browser page snapshot task-demo --json
jev-browser frame main task-demo --json
```

Use a tab ID such as `t2`, a label, or an exact observed CDP target ID. `tab 2` is not a positional shortcut. Switch first, then observe that tab/frame. For multiple sessions on a shared CDP browser, read the pinning guidance in [sessions-auth.md](sessions-auth.md).

## Capture and additional operations

```bash
jev-browser page screenshot task-demo --json './page.png' --full
jev-browser page pdf task-demo --json './page.pdf'
jev-browser record start task-demo --json './flow.webm'
jev-browser record stop task-demo --json
jev-browser element upload task-demo --json '#document' './document.pdf'
jev-browser dialog status task-demo --json
jev-browser dialog dismiss task-demo --json
```

Recording needs `ffmpeg` on PATH. Capture files can contain page and account data; use task-owned paths. Run `jev-browser help` for less common network, storage, drag, or diagnostic commands, and check their syntax before use. These atomic capabilities do not add automatic planning or business assertions.
