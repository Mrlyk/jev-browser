import { useEffect, useReducer, useState } from 'react';
import { Box, Static, Text, useApp, useInput, usePaste } from 'ink';
import { Controller } from './controller.js';
import { commands, shortcuts } from './commands.js';
import { clean } from './messages.js';
import { edit, graphemes, type Editor } from './editor.js';

const connections = [['headed', '新建有头浏览器'], ['headless', '新建无头浏览器'], ['auto', '连接本机 Chrome'],
  ['cdp', '输入 CDP 地址'], ['session', '输入已有会话名']];

export function App({ controller }: { controller: Controller }) {
  const { exit } = useApp();
  const [, redraw] = useReducer(x => x + 1, 0);
  const [editor, setEditor] = useState<Editor>({ value: '', cursor: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [bar, setBar] = useState(-1);
  const [selection, setSelection] = useState(0);
  const state = controller.state;
  const setText = (value: string) => setEditor({ value, cursor: graphemes(value).length });
  const submit = (value: string) => {
    if (controller.isBusy) { controller.log('正在执行上一条操作，输入已保留。'); return; }
    void controller.submit(value).then(() => controller.reconnect());
  };
  useEffect(() => {
    const listener = () => { redraw(); if (controller.state.exited) exit(); };
    controller.on('change', listener);
    void controller.start();
    const timer = setInterval(() => { void controller.poll(); }, 2000);
    return () => { clearInterval(timer); controller.off('change', listener); };
  }, [controller, exit]);
  useEffect(() => { setSelection(0); }, [state.choosingTab, state.choosingBrowser, state.pending]);
  usePaste(text => { setBar(-1); setEditor(current => edit(current, { insert: text })); });
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (controller.isBusy || state.pending || state.choosingTab || state.choosingBrowser) controller.cancel();
      else void controller.shutdown();
      return;
    }
    if (key.escape) { if (bar >= 0) setBar(-1); else controller.cancel(); return; }
    const menu = state.choosingTab ? state.tabs.map(tab => [tab.tabId, tab.title]) : state.choosingBrowser ? connections : undefined;
    if (menu) {
      if (key.upArrow || key.downArrow) setSelection(index => (index + (key.upArrow ? -1 : 1) + menu.length) % Math.max(1, menu.length));
      if (key.return && menu[selection]) {
        const value = menu[selection][0];
        if (state.choosingTab) submit(`/tab ${value}`);
        else if (['session', 'cdp'].includes(value)) { state.choosingBrowser = false; setText(`/browser ${value} `); }
        else submit(`/browser ${value}`);
      }
      return;
    }
    if (key.tab) {
      const matches = editor.value.startsWith('/') ? commands.filter(([name]) => `/${name}`.startsWith(editor.value)) : [];
      if (matches.length === 1) setText(`/${matches[0][0]} `);
      else if (matches.length) controller.log(matches.map(([name]) => `/${name}`).join('  '));
      else setBar(index => (index + 1) % shortcuts.length);
      return;
    }
    if (bar >= 0) {
      if (key.leftArrow || key.rightArrow) setBar(index => (index + (key.leftArrow ? -1 : 1) + shortcuts.length) % shortcuts.length);
      if (key.return) { submit(`/${shortcuts[bar]}`); setBar(-1); }
      return;
    }
    if (key.return && (key.shift || key.meta)) { setEditor(current => edit(current, { insert: '\n' })); return; }
    if (key.return) {
      if (!editor.value.trim()) return;
      if (controller.isBusy) { controller.log('正在执行上一条操作，输入已保留。'); return; }
      setHistory(items => [...items, editor.value].slice(-100)); setHistoryIndex(-1); setDraft('');
      submit(editor.value); setText(''); return;
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
    if (key.backspace || key.delete) { setEditor(current => edit(current, { remove: key.backspace ? 'before' : 'after' })); return; }
    if (key.ctrl && input === 'u') { setText(''); return; }
    if (!key.ctrl && !key.meta && input) setEditor(current => edit(current, { insert: input }));
  });
  const tab = state.tabs.find(item => item.active);
  const chars = graphemes(editor.value);
  // A bounded viewport keeps the caret visible even for long or pasted input.
  const before = chars.slice(Math.max(0, editor.cursor - 100), editor.cursor).join('');
  const after = chars.slice(editor.cursor + 1, editor.cursor + 80).join('');
  return <Box flexDirection="column">
    <Static key={state.revision} items={state.transcript}>{entry => <Text key={entry.id}>{entry.text}</Text>}</Static>
    <Box flexDirection="column" marginTop={1}>
      <Text color="green" bold>Jev Browser · {controller.options.session}</Text>
      {state.phase && <Text>{state.phase}</Text>}
      <Text wrap="truncate-end">操作页  {tab ? clean(`${tab.tabId} · ${tab.title || '无标题'} · 共 ${state.tabs.length} 个标签页`) : '未选择 · /tabs 选择或 /new 新建'}</Text>
      {tab && <Text dimColor wrap="truncate-end">{clean(tab.url)}</Text>}
      <Text>连接    {state.connection} / {state.mode}</Text>
      <Text>模型    {state.model} · {state.modelState}</Text>
      {state.choosingTab && state.tabs.map((item, index) => <Text key={item.tabId} color={selection === index ? 'green' : undefined}>{selection === index ? '› ' : '  '}{clean(`${item.tabId} · ${item.title} · ${item.url}`)}</Text>)}
      {state.choosingBrowser && connections.map((item, index) => <Text key={item[0]} color={selection === index ? 'green' : undefined}>{selection === index ? '› ' : '  '}{item[1]}</Text>)}
      {state.pending && <Box flexDirection="column">
        <Text color="yellow">待确认 · {clean(state.pending.plan.target?.name ?? state.pending.plan.operation)}</Text>
        {state.pending.choices.map((item, index) => <Text key={item.ref}>{index + 1}. {clean(item.label)}</Text>)}
        <Text dimColor>{state.pending.choices.length > 1 ? '输入序号选择目标' : '输入「确认」执行'} · Esc 取消</Text>
      </Box>}
      <Box flexWrap="wrap">{shortcuts.map((name, index) => <Text key={name} inverse={bar === index}> [{commands.find(([key]) => key === name)![1].replace(' [px]', '')}] </Text>)}</Box>
      <Box borderStyle="round" borderColor="green" paddingX={1}><Text>› {before}<Text inverse>{chars[editor.cursor] === '\n' ? ' ' : chars[editor.cursor] ?? ' '}</Text>{after}</Text></Box>
      <Text dimColor>Enter 发送 · ↑↓ 历史 · Tab 补全/快捷栏 · Esc 取消 · /help</Text>
    </Box>
  </Box>;
}
