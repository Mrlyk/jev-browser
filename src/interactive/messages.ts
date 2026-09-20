import { stripVTControlCharacters } from 'node:util';
import { operations } from '../actions.js';
import { describe } from '../questions.js';
import type { Plan } from '../semantic.js';

export function clean(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}
export function planMessage(plan: Plan): string {
  return [operations[plan.operation], plan.target && describe(plan.target),
    plan.value !== undefined && (plan.hiddenValue ? '（内容已隐藏）' : `「${plan.value}」`),
    plan.submit && '然后按回车提交'].filter(Boolean).join(' · ');
}
export function needsConfirmation(plan: Plan): boolean {
  return !!plan.uncertainties.length || plan.submit || plan.operation === 'press' ||
    /删除|移除|付款|支付|购买|下单|发布|发送|提交|确认|delete|remove|pay|purchase|buy|publish|send|submit|confirm/i.test(plan.target?.name ?? '');
}
