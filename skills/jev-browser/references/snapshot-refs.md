# Snapshots and refs

Use when inspecting structure, disambiguating similar controls, or recovering after a page changes. Adapted from the upstream snapshot/ref guide and the current jev-browser identity checks.

## Choose the observation

```bash
jev-browser page snapshot task-demo --json
jev-browser page snapshot task-demo --json -i
jev-browser page snapshot task-demo --json -s '#guest-section'
```

The full snapshot preserves region and ancestor context. `-i` is useful for a small interactive-control view; it may omit context needed to distinguish identical labels. `-s` scopes observation to a verified CSS selector. These options are for explicit observation; `page act` builds and validates its own snapshot.

A simplified snapshot excerpt:

```text
- region "Guest details" [ref=e1]
  - textbox "Name" [ref=e2]
  - button "Confirm" [ref=e3]
- region "Invoice details" [ref=e4]
  - button "Confirm" [ref=e5]
```

The atomic target is `@e3`; a useful semantic description is “Confirm button in Guest details.” Refs may appear alongside state attributes, for example `[checked=false, ref=e6]`. The JSON `data.refs` map supplies role, name, backend node identity, and frame identity; the snapshot text preserves hierarchy.

## Ref lifetime

A ref is meaningful within the observed browser session, page, and frame. It is not a permanent selector or business identifier. Refs for surviving DOM elements may persist across snapshots, while navigation, replaced documents/elements, and virtual accessibility nodes can invalidate them.

Before using a stored ref after navigation, tab/frame changes, or a rerender, observe again. Do not fabricate a replacement ref by incrementing its number. `page act` rechecks page identity, ref, DOM identity, name, context, and applicable state before dispatch; a stale result stops rather than selecting a similar-looking target automatically.

## Keep target coverage explicit

- A target absent from the current observation cannot be selected reliably. Wait for a loading result or switch to the correct tab/frame before trying again.
- Repeated labels need their region or business context. The current CSS scope must come from actual page/code evidence; `--scope` does not accept natural language or an `@eN` ref.
- Large candidate sets are evaluated in batches of at most 253 targets plus `none` and `ambiguous`. Each batch's top two targets enter a common comparison; final probabilities drive the existing confirmation thresholds. Requests also split by byte size. `CONTEXT_TOO_LARGE` means the shared context or remaining candidates cannot fit after splitting; narrow the verified scope.
- Native date controls are selected as whole `Date`/`DateTime` inputs. `fill` excludes their internal year/month/day spinbuttons; pass an explicit ISO date to the whole field.
- `get_text` can select a named container or a `StaticText` node. Name the container to read its complete text, or describe a specific text node for a narrower reading.

For example, after confirming `#guest-section` from the actual page:

```bash
jev-browser page act task-demo --json --op click 'Confirm button' --scope '#guest-section' --dry-run
```

`resolved` means the preview identified a target. It is not an execution token; the next real `page act` observes and checks the page again.

For assertions, prefer independent stable selectors or business identifiers established by the test contract. Rechecking only the ref chosen by the same model can miss selection of the wrong field.
