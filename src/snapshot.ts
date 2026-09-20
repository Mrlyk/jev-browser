import { createHash } from 'node:crypto';
import { JevError, object } from './errors.js';
import type { Operation } from './actions.js';

export type Candidate = { ref: string; role: string; name: string; context: string; backendNodeId: number | null; frameId: string | null };
export type Snapshot = { id: string; origin: string; pageId: string; frameId: string | null; candidates: Candidate[] };

export function snapshot(data: unknown): Snapshot {
  if (!object(data) || typeof data.snapshot !== 'string' || !object(data.refs) ||
    typeof data.origin !== 'string' || typeof data.pageId !== 'string') throw new JevError('INVALID_SNAPSHOT', '执行器快照格式不完整。');
  const stack: Array<{ indent: number; text: string }> = [];
  const candidates: Candidate[] = [];
  for (const line of data.snapshot.split('\n')) {
    const match = /^(\s*)-\s+(.*)$/.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const markers = [...match[2].matchAll(/\[(?:[^\]]*,\s*)?ref=(e\d+)\]/g)];
    if (markers.length > 1) throw new JevError('INVALID_SNAPSHOT', '单个节点出现多个引用标记，无法确认目标。');
    const ref = markers[0]?.[1];
    if (ref) {
      const entry = data.refs[ref];
      if (!object(entry) || typeof entry.role !== 'string' || typeof entry.name !== 'string')
        throw new JevError('INVALID_SNAPSHOT', '快照引用与元素映射不一致。');
      candidates.push({ ref, role: entry.role, name: entry.name, context: stack.map(p => p.text).join(' > '),
        backendNodeId: typeof entry.backendNodeId === 'number' ? entry.backendNodeId : null,
        frameId: typeof entry.frameId === 'string' ? entry.frameId : null });
    }
    stack.push({ indent, text: match[2].replace(/\s*\[[^\]]*\bref=e\d+\]/g, '').replace(/:$/, '') });
  }
  return { id: createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16), origin: data.origin,
    pageId: data.pageId, frameId: data.frameId ?? null, candidates };
}

export function candidatesFor(observation: Snapshot, op: Operation): Candidate[] {
  const roles: Partial<Record<Operation, string[]>> = {
    fill: ['textbox', 'searchbox', 'combobox', 'spinbutton', 'date', 'datetime'], type: ['textbox', 'searchbox', 'combobox', 'spinbutton'],
    check: ['checkbox', 'switch', 'menuitemcheckbox'], uncheck: ['checkbox', 'switch', 'menuitemcheckbox'], select: ['combobox', 'listbox'],
  };
  const candidates = observation.candidates.filter(c =>
    !(op === 'fill' && c.role === 'spinbutton' && /\bDate(?:Time)? "/.test(c.context)) &&
    (op === 'get_text' || c.role.toLowerCase() !== 'statictext') &&
    (!roles[op] || roles[op]!.includes(c.role.toLowerCase())));
  if (!candidates.length) throw new JevError('NO_MATCH', '当前范围内没有可供该动作选择的目标。');
  return candidates;
}

export function assertFresh(before: Snapshot, after: Snapshot, candidate: Candidate): void {
  const current = after.candidates.find(c => c.ref === candidate.ref);
  if (before.origin !== after.origin || before.pageId !== after.pageId || before.frameId !== after.frameId ||
    !candidate.backendNodeId || JSON.stringify(current) !== JSON.stringify(candidate))
    throw new JevError('STALE_TARGET', '页面、目标身份或上下文已变化；未执行动作，请重新观察。');
}
