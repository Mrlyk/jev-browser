# Troubleshooting

Read the actual CLI result before deciding whether to observe, correct input, or stop. This guide adapts the relevant upstream failure patterns to jev-browser's semantic error contract.

## Uncertain or rejected semantic actions

| Result | Next step |
| --- | --- |
| `NO_MATCH`, `AMBIGUOUS` | Inspect the current page and improve the description or verified scope. Do not lower thresholds merely to obtain an action. |
| `NEEDS_INPUT` | Supply an exact value from the user/test data using `--value` or stdin. Ask only when the required value is unavailable. |
| `MULTI_STEP_UNSUPPORTED` | Split the workflow into individual actions, observing each result before the next. |
| `STALE_TARGET` with `dispatched: false` | Observe again and resolve the intended target on the new page. Stop if identity remains uncertain. |
| `TOO_MANY_CANDIDATES`, `CONTEXT_TOO_LARGE` | Narrow with a verified CSS `--scope`; do not silently truncate candidates. |
| `INVALID_MODEL_RESPONSE` | Report the invalid model result. Do not turn an unknown choice or missing probability into a successful selection. |
| `MISSING_API_KEY`, `MODEL_HTTP_*`, `MODEL_UNAVAILABLE` | Check the selected provider's configuration or service status. Do not print keys or silently route data through a different provider. |

`EXECUTION_UNKNOWN`, or a failed write with `dispatched: true`, requires independent inspection of the resulting business state. A submission may have succeeded before the response was lost. Do not replay until non-execution is established. `BROWSER_ERROR` is not sufficient evidence that nothing happened.

Native atomic errors can use a different envelope, including a string `error` and top-level `code`. The semantic `act` error schema must not be assumed for every command.

## Page and environment problems

- **Loading or stale ref:** use the expected selector, text, or URL as the wait condition, then take a fresh snapshot. Follow [snapshot-refs.md](snapshot-refs.md).
- **Covered or disabled control:** inspect the overlay or disabled state. Resolve a legitimate prerequisite before trying again; do not force a click through a blocking element.
- **Wrong tab/frame:** list tabs and select the observed target; switch frame context if required. Session reuse alone does not identify the correct page.
- **Blank or purely graphical target:** Jev consumes textual candidates. Do not invent a target for a canvas or unlabelled icon; use available page/code evidence and suitable deterministic controls within the task scope.
- **`SESSION_BUSY`:** wait for the active command or report the conflict. An abandoned lock may be removed only after checking its recorded process has ended and the task owns it.
- **`CORE_NOT_INSTALLED`:** check the platform and the package's binary. For a source checkout run `npm run build:core`. Install npm package `jev-browser-cli`, not the different package named `jev-browser`.
- **Browser download/launch failure:** the first `open` can prepare Chrome. Check network, certificate, directory permissions, and browser system libraries. Linux ARM64 needs an installed Chromium via `--executable-path`; a host sandbox may require an outside-sandbox browser and CDP.
- **Expired login:** check the expected account and authenticated page, then re-establish login within the task's scope. See [sessions-auth.md](sessions-auth.md).

## Skill discovery

Current source builds serve `skills/jev-browser/`:

```bash
jev-browser skills list
jev-browser skills get jev-browser
jev-browser skills path jev-browser
```

The default `get` returns only the main guide. Read the referenced file from the returned folder when needed. `skills get jev-browser --full` explicitly includes all four reference files.

If an older installed release lacks this entry, use the repository's companion skill folder or build the current source. The old upstream `core` entry is no longer part of the active skill set. Retained specialty documents under source `skill-data/` are upstream reference material, not installed jev-browser skills.
