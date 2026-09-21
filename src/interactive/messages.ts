import { stripVTControlCharacters } from 'node:util';
import type { Candidate } from '../snapshot.js';
import type { Plan } from '../semantic.js';

export function clean(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}
export function planMessage(plan: Plan): string {
  const actions: Record<Plan['operation'], string> = {
    click: 'Click', dblclick: 'Double-click', fill: 'Replace input', type: 'Append text',
    check: 'Check', uncheck: 'Uncheck', hover: 'Hover', focus: 'Focus', select: 'Select option',
    scrollintoview: 'Scroll into view', get_text: 'Read text', open: 'Open page', back: 'Go back',
    forward: 'Go forward', reload: 'Reload page', scroll: 'Scroll', press: 'Press key',
  };
  return [actions[plan.operation], plan.target && targetLabel(plan.target),
    plan.value !== undefined && (plan.hiddenValue ? '(content hidden)' : `"${plan.value}"`),
    plan.submit && 'then press Enter to submit'].filter(Boolean).join(' · ');
}
export function targetLabel(target: Candidate): string {
  return `${target.role} "${target.name || 'Unnamed'}"${target.context ? ` (${target.context})` : ''}`;
}
export function needsConfirmation(plan: Plan): boolean {
  return !!plan.uncertainties.length || plan.submit || plan.operation === 'press' ||
    /删除|移除|付款|支付|购买|下单|发布|发送|提交|确认|delete|remove|pay|purchase|buy|publish|send|submit|confirm/i.test(plan.target?.name ?? '');
}
