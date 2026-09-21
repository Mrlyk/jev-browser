import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToString } from 'ink';
import { stripVTControlCharacters } from 'node:util';
import { Footer, Menu } from '../dist/interactive/Layout.js';

const state = { model: 'TypeSafe / jev-latest', connection: '已连接 · CDP 接入', mode: '模式未知',
  tabs: [{ active: true, tabId: 't7', title: '中文测试页面及很长的标题'.repeat(8) }] };

test('footer stays on one line and retains provider, tab ID and connection at narrow widths', () => {
  for (const width of [30, 60, 100, 120]) {
    for (const model of ['TypeSafe / jev-latest', 'OpenRouter / ~typesafe/jev-latest']) {
      const text = stripVTControlCharacters(renderToString(h(Footer, { state: { ...state, model }, session: 'tui-test', width }), { columns: width })).trim();
      assert.equal(text.split('\n').length, 1, text);
      assert.match(text, model.startsWith('TypeSafe') ? /TypeSafe/ : /OpenRouter/);
      assert.match(text, /t7/); assert.match(text, /CDP/);
    }
  }
});

test('footer clears closed tab titles and never interprets terminal control sequences', () => {
  const text = stripVTControlCharacters(renderToString(h(Footer, { state: { ...state, tabs: [] }, session: 'test', width: 100 })));
  assert.match(text, /\/tab 选择操作页/); assert.doesNotMatch(text, /中文测试/);
  const dirty = renderToString(h(Footer, { state: { ...state, model: 'TypeSafe\x1b[2J' }, session: 'test', width: 100 }));
  assert.ok(!dirty.includes('\x1b[2J'));
});

test('menu keeps the selected item visible with more than six choices', () => {
  const text = stripVTControlCharacters(renderToString(h(Menu, {
    title: '连接', selected: 9, items: Array.from({ length: 12 }, (_, i) => [`选项${i}`, `说明${i}`]),
  })));
  assert.match(text, /› 选项9/); assert.doesNotMatch(text, /选项0/);
});
