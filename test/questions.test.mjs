import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions } from '../dist/questions.js';
import { snapshot } from '../dist/snapshot.js';

const page = snapshot({ origin: 'https://example.com', pageId: 'p1', frameId: null,
  snapshot: '- heading "Example Domain" [ref=e1]\n- StaticText "Example text" [ref=e2]\n- link "Learn more" [ref=e3]',
  refs: { e1: { role: 'heading', name: 'Example Domain' }, e2: { role: 'StaticText', name: 'Example text' },
    e3: { role: 'link', name: 'Learn more' } } });

test('minimal link pages expose targets without a conflicting partial page inventory', () => {
  for (const op of [undefined, 'click']) {
    for (const instruction of ['Click Learn more link', '点击 Learn more 链接']) {
      const built = buildQuestions({ instruction, op, probability: .8, margin: .2 }, page);
      assert.match(built.questions.target.criteria.e3, /Learn more/);
      assert.deepEqual(built.state.page, { url: 'https://example.com' });
      assert.match(built.questions.target.instructions, /候选列表给出全部可选目标/);
    }
  }
});

test('search buttons remain auxiliary input context and never gate other target roles', () => {
  const roles = ['button', 'searchbox', 'checkbox', 'radio', 'listbox'];
  const before = { ...page, candidates: [...page.candidates, ...roles.map((role, i) => ({
    ref: `e${i + 4}`, role, name: role === 'button' ? '搜索' : role, context: '', backendNodeId: null, frameId: null,
  }))] };
  const built = buildQuestions({ instruction: '搜索 jev', probability: .8, margin: .2 }, before);
  assert.deepEqual(built.state.page.buttons, [{ name: '搜索', context: '' }]);
  assert.equal(built.state.page.controls, undefined);
  for (const ref of ['e3', 'e6', 'e7', 'e8']) assert.ok(built.questions.target.criteria[ref]);
  assert.ok(built.questions.input_target.criteria.e5);
  const click = buildQuestions({ instruction: '点击 Learn more', op: 'click', probability: .8, margin: .2 }, before);
  assert.deepEqual(click.state.page, { url: 'https://example.com' });
});
