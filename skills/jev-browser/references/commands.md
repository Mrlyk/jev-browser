# Commands

Use for command syntax and choosing between semantic and deterministic actions. Examples assume an already selected, task-owned session and matching controls; replace URLs, selectors, labels, and observed refs. This is a curated adaptation of agent-browser v0.38.1's core command guide for jev-browser.

## Semantic actions

```bash
jev-browser --session task-demo --json act --op fill 'Guest name field' --value 'Alex'
jev-browser --session task-demo --json act --op click 'Book button in the Standard King Room section'
jev-browser --session task-demo --json act --op check 'Booking terms checkbox'
jev-browser --session task-demo --json act --op uncheck 'Request invoice checkbox'
jev-browser --session task-demo --json act --op select 'Room count dropdown' --value '2 rooms'
jev-browser --session task-demo --json act --op fill 'Check-out date field' --value '2026-10-13'
jev-browser --session task-demo --json act --op get_text 'Order total'
```

`fill` replaces a value; `type` appends. Native `select` accepts a value or visible label. A custom dropdown normally requires separate open and option-click operations. Native dates use ISO values; malformed dates are rejected without clearing the previous value. Resolve relative dates from the task's time zone before supplying an explicit value.

Supported semantic operations: `click`, `dblclick`, `fill`, `type`, `check`, `uncheck`, `hover`, `focus`, `select`, `scrollintoview`, `get_text`, `open`, `back`, `forward`, `reload`, `scroll`, `press`. Other executor capabilities use atomic commands, not invented `act --op` values.

```bash
jev-browser --session task-demo --json act 'Fill the "Guest name" field with "Alex"'
jev-browser --session task-demo --json act --op click 'Confirm button' --scope '#guest-section' --dry-run
jev-browser --session task-demo --json act --op focus 'Search field'
jev-browser --session task-demo --json act --op press 'Press Enter' --value Enter
jev-browser --session task-demo --json act --op scroll 'Scroll down' --value down
```

`--scope` is a confirmed CSS selector. `--dry-run` selects and checks a target without acting. Semantic `scroll` moves 500 px in `up`, `down`, `left`, or `right`. Semantic `press` accepts common keys such as Enter, Tab, Escape, arrows, and `Control+a`/`Meta+a`; use help and atomic `press` for additional key syntax.

With `--op` and an explicit value, element selection normally needs one model request. Without `--op`, action classification comes first. When a value must be selected from quoted spans, target and value questions share the next request. Values supplied through `--value` or stdin are not included in those model questions.

## Navigation and deterministic interaction

```bash
jev-browser --session task-demo --json open https://example.com
jev-browser --session task-demo --json back
jev-browser --session task-demo --json forward
jev-browser --session task-demo --json reload
jev-browser --session task-demo --json click '#submit'
jev-browser --session task-demo --json fill '#guest-name' 'Alex'
jev-browser --session task-demo --json type '#guest-name' ' Smith'
jev-browser --session task-demo --json select '#room-count' '2'
jev-browser --session task-demo --json check '#terms'
jev-browser --session task-demo --json hover '@e12'
jev-browser --session task-demo --json press Enter
jev-browser --session task-demo --json scroll down 500
jev-browser --session task-demo --json scrollintoview '#footer'
```

Atomic commands take selectors or observed refs, not natural-language target descriptions. They do not call Jev. Snapshot/ref usage is covered in [snapshot-refs.md](snapshot-refs.md).

## Read and independently verify

```bash
jev-browser --session task-demo --json get title
jev-browser --session task-demo --json get url
jev-browser --session task-demo --json get text '#order-id'
jev-browser --session task-demo --json get value '#guest-name'
jev-browser --session task-demo --json get attr '#details-link' href
jev-browser --session task-demo --json get count '.hotel-card'
jev-browser --session task-demo --json is visible '#confirmation'
jev-browser --session task-demo --json is enabled '#submit'
jev-browser --session task-demo --json is checked '#terms'
```

`act --op get_text` returns text in `data.result.text`. Atomic `get text` and `get value` return `data.text` and `data.value`. State checks return fields such as `data.visible`, `data.enabled`, and `data.checked`. Inspect the actual result rather than assuming every command has the `act` envelope.

## Wait for a result

```bash
jev-browser --session task-demo --json wait '#confirmation'
jev-browser --session task-demo --json wait --text 'Booking confirmed' --timeout 15000
jev-browser --session task-demo --json wait --url '**/orders/**' --timeout 15000
jev-browser --session task-demo --json wait --load domcontentloaded
```

Choose a selector, text, or URL that represents the expected outcome. A load event alone does not prove an asynchronous search or order submission finished. Polling and persistent connections can prevent `networkidle`; do not use it as a universal wait. A timeout after a write does not authorize replaying the write.

## Tabs and frames

```bash
jev-browser --session task-demo --json tab
jev-browser --session task-demo --json tab new --label details https://example.com
jev-browser --session task-demo --json tab details
jev-browser --session task-demo --json tab close details
jev-browser --session task-demo --json frame '#booking-frame'
jev-browser --session task-demo --json snapshot
jev-browser --session task-demo --json frame main
```

Use a tab ID such as `t2`, a label, or an exact observed CDP target ID. `tab 2` is not a positional shortcut. Switch first, then observe that tab/frame. For multiple sessions on a shared CDP browser, read the pinning guidance in [sessions-auth.md](sessions-auth.md).

## Capture and additional operations

```bash
jev-browser --session task-demo --json screenshot './page.png' --full
jev-browser --session task-demo --json pdf './page.pdf'
jev-browser --session task-demo --json record start './flow.webm'
jev-browser --session task-demo --json record stop
jev-browser --session task-demo --json upload '#document' './document.pdf'
jev-browser --session task-demo --json dialog status
jev-browser --session task-demo --json dialog dismiss
```

Recording needs `ffmpeg` on PATH. Capture files can contain page and account data; use task-owned paths. Run `jev-browser help` for less common network, storage, drag, or diagnostic commands, and check their syntax before use. These atomic capabilities do not add automatic planning or business assertions.
