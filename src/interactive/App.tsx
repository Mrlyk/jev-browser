import { useEffect, useReducer, useState } from 'react';
import { Box, Static, Text, useApp, useInput, usePaste, useStdout } from 'ink';
import { Controller } from './controller.js';
import { commands } from './commands.js';
import { clean } from './messages.js';
import { edit, graphemes, type Editor } from './editor.js';
import { Footer, Menu, Welcome } from './Layout.js';

const connections: Array<readonly [string, string]> = [['auto', 'Connect to existing Chrome (default)'], ['cdp', 'Enter a CDP address'],
  ['headed', 'Launch a headed browser'], ['headless', 'Launch a headless browser'], ['session', 'Reuse a session']];

export function App({ controller }: { controller: Controller }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [, redraw] = useReducer(x => x + 1, 0);
  const [editor, setEditor] = useState<Editor>({ value: '', cursor: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const state = controller.state;
  const pendingChoices: Array<readonly [string, string]> | undefined = state.pending ?
    state.pending.choices.length > 1 ? state.pending.choices.map((item, index) => [String(index + 1), item.label]) :
      [['yes', 'Execute this action'], ['no', 'Cancel this action']] : undefined;
  const picker = state.choosingTab ? state.tabs.map(item => [item.tabId, `${item.title} · ${item.url}`] as const) :
    state.choosingBrowser ? connections : pendingChoices;
  const width = Math.max(12, stdout.columns || 80);
  const matches = !dismissed && /^\/\S*$/.test(editor.value) ? commands.filter(([name]) => `/${name}`.startsWith(editor.value)) : [];
  const activeIndex = Math.min(selection, Math.max(0, matches.length - 1));
  const setText = (value: string) => { setEditor({ value, cursor: graphemes(value).length }); setSelection(0); setDismissed(false); };
  const submit = (value: string) => {
    if (controller.isBusy) { controller.log('An action is running. Your input has been kept.'); return; }
    setHistory(items => [...items, value].slice(-100)); setHistoryIndex(-1); setDraft('');
    void controller.submit(value).then(() => controller.reconnect());
    setText('');
  };
  useEffect(() => {
    const listener = () => { redraw(); if (controller.state.exited) exit(); };
    controller.on('change', listener); stdout.on('resize', redraw);
    void controller.start();
    const timer = setInterval(() => { void controller.poll(); }, 2000);
    return () => { clearInterval(timer); controller.off('change', listener); stdout.off('resize', redraw); };
  }, [controller, exit, stdout]);
  useEffect(() => { setSelection(0); }, [state.choosingTab, state.choosingBrowser, state.pending]);
  usePaste(text => { if (state.pending) controller.cancel(); setDismissed(false); setSelection(0); setEditor(current => edit(current, { insert: text })); });
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (controller.isBusy || state.pending || state.choosingTab || state.choosingBrowser) controller.cancel();
      else if (editor.value) setText('');
      else void controller.shutdown();
      return;
    }
    if (key.escape) { if (picker) controller.cancel(); else if (matches.length) setDismissed(true); else controller.cancel(); return; }
    const menu = picker;
    if (menu) {
      const index = Math.min(selection, Math.max(0, menu.length - 1));
      if (key.upArrow || key.downArrow || key.tab) setSelection((index + (key.upArrow || key.tab && key.shift ? -1 : 1) + menu.length) % Math.max(1, menu.length));
      if (key.return && menu[index]) {
        const value = menu[index][0];
        if (pendingChoices) submit(value);
        else if (state.choosingTab) submit(`/tab ${value}`);
        else if (['session', 'cdp'].includes(value)) { controller.cancel(); setText(`/connect ${value} `); }
        else submit(`/connect ${value}`);
      }
      if (pendingChoices && !key.ctrl && !key.meta && !key.return && input && !/[\x00-\x1f\x7f]/.test(input)) { controller.cancel(); setText(input); }
      return;
    }
    if (key.return && (key.shift || key.meta)) { setEditor(current => edit(current, { insert: '\n' })); return; }
    if (matches.length && (key.upArrow || key.downArrow)) {
      setSelection((activeIndex + (key.upArrow ? -1 : 1) + matches.length) % matches.length); return;
    }
    if (key.tab) { if (matches.length) setText(`/${matches[activeIndex][0]} `); return; }
    if (key.return) {
      if (!editor.value.trim()) return;
      if (matches.length && !commands.some(([name]) => editor.value === `/${name}`)) {
        const name = matches[activeIndex][0];
        if (name === 'open') setText('/open '); else submit(`/${name}`);
      } else submit(editor.value);
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (historyIndex < 0) setDraft(editor.value);
      const index = key.upArrow ? Math.max(0, (historyIndex < 0 ? history.length : historyIndex) - 1) : historyIndex < 0 ? history.length : historyIndex + 1;
      if (index >= history.length) { setHistoryIndex(-1); setText(draft); }
      else { setHistoryIndex(index); setText(history[index] ?? ''); }
      return;
    }
    if (key.leftArrow || key.rightArrow) { setEditor(current => edit(current, { move: key.leftArrow ? -1 : 1 })); return; }
    if (key.home || key.end || key.ctrl && ['a', 'e'].includes(input)) { setEditor(current => edit(current, { edge: key.home || input === 'a' ? 'start' : 'end' })); return; }
    if (key.backspace || key.delete) { setDismissed(false); setSelection(0); setEditor(current => edit(current, { remove: key.backspace ? 'before' : 'after' })); return; }
    if (key.ctrl && input === 'u') { setText(''); return; }
    if (!key.ctrl && !key.meta && input) { setDismissed(false); setSelection(0); setEditor(current => edit(current, { insert: input })); }
  });
  const chars = graphemes(editor.value);
  const before = chars.slice(Math.max(0, editor.cursor - 100), editor.cursor).join('');
  const after = chars.slice(editor.cursor + 1, editor.cursor + 80).join('');
  const menu = picker;
  const entries = [{ id: 0, text: '', role: 'assistant' as const }, ...state.transcript];
  const historyLines = state.transcript.reduce((total, entry) => total + (entry.role === 'user' ? 2 : 0) + entry.text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(graphemes(line).length * 1.5 / (width - (entry.role === 'user' ? 2 : 0)))), 0), 0);
  const welcomeLines = width >= 66 ? 15 : 18;
  return <Box flexDirection="column">
    <Static key={state.revision} items={entries}>{entry => entry.id === 0 ? <Welcome key={0} width={width} /> :
      <Box key={entry.id} width={width} marginBottom={1} paddingX={entry.role === 'user' ? 1 : 0}
        paddingY={entry.role === 'user' ? 1 : 0} backgroundColor={entry.role === 'user' ? '#e8e8e8' : undefined}>
        <Text color={entry.role === 'user' ? '#242424' : undefined}>{entry.text}</Text>
      </Box>}</Static>
    <Box flexDirection="column" minHeight={Math.max(0, (stdout.rows || 24) - welcomeLines - historyLines - state.transcript.length - 1)} justifyContent="flex-end">
      {state.phase && <Text color="cyan" wrap="truncate-end">{state.phase}</Text>}
      {state.pending && <Box flexDirection="column">
        <Text color="yellow">Confirmation · {clean(state.pending.plan.target?.name ?? state.pending.plan.operation)}</Text>
      </Box>}
      <Text color="magenta">{'─'.repeat(width)}</Text>
      {menu ? <Menu items={menu} selected={Math.min(selection, Math.max(0, menu.length - 1))} title={state.choosingTab ? 'Select a tab' : state.choosingBrowser ? 'Select a connection' : (state.pending?.choices.length ?? 0) > 1 ? 'Select a target' : 'Execute this action?'} /> :
        <Box flexDirection="column">
          <Text>› {before}<Text inverse>{chars[editor.cursor] === '\n' ? ' ' : chars[editor.cursor] ?? ' '}</Text>{after}</Text>
          {matches.length > 0 && <Menu items={matches.map(([name, label]) => [`/${name}`, label])} selected={activeIndex} title="Commands" />}
        </Box>}
      <Text color="magenta">{'─'.repeat(width)}</Text>
      <Footer state={state} session={controller.options.session} width={width} />
    </Box>
  </Box>;
}
