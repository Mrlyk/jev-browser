import { clean } from './messages.js';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (value: string) => [...segmenter.segment(value)].map(part => part.segment);
export type Editor = { value: string; cursor: number };
export function edit(editor: Editor, action: { insert?: string; move?: number; remove?: 'before' | 'after'; edge?: 'start' | 'end' }): Editor {
  const chars = graphemes(editor.value);
  let cursor = Math.min(editor.cursor, chars.length);
  if (action.insert !== undefined) {
    const inserted = graphemes(clean(action.insert.replace(/\r\n?/g, '\n')));
    chars.splice(cursor, 0, ...inserted); cursor += inserted.length;
  }
  if (action.remove === 'before' && cursor > 0) chars.splice(--cursor, 1);
  if (action.remove === 'after') chars.splice(cursor, 1);
  if (action.move) cursor = Math.max(0, Math.min(chars.length, cursor + action.move));
  if (action.edge) cursor = action.edge === 'start' ? 0 : chars.length;
  const value = chars.slice(0, 16_000).join('');
  return { value, cursor: Math.min(cursor, graphemes(value).length) };
}
