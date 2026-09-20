import { JevError, object } from './errors.js';
import { type Credentials } from './credentials.js';

export type Question = { type: 'choice' | 'noul'; instructions: string; criteria: Record<string, string> };
export type Answer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number };
export type NoulAnswer = { type: 'noul'; noul: number };
export type Evaluation = { model: string; answers: Record<string, Answer | NoulAnswer>; usage?: unknown; id?: string };
export type ModelConfig = { transport: 'typesafe' | 'openrouter'; endpoint: string; model: string; key: string };

export function modelConfig(env = process.env, stored: Credentials = {}): ModelConfig {
  const typesafe = env.TYPESAFE_API_KEY?.trim() || stored.typesafe;
  const openrouter = env.OPENROUTER_API_KEY?.trim() || stored.openrouter;
  if (typesafe) return {
    transport: 'typesafe', endpoint: 'https://api.typesafe.ai/v1/systemone',
    model: env.TYPESAFE_MODEL?.trim() || 'jev-latest', key: typesafe,
  };
  if (openrouter) return {
    transport: 'openrouter', endpoint: 'https://openrouter.ai/api/alpha/decisions',
    model: env.OPENROUTER_MODEL?.trim() || '~typesafe/jev-latest', key: openrouter,
  };
  throw new JevError('MISSING_API_KEY', 'No API key configured. Run jevb auth login or set TYPESAFE_API_KEY / OPENROUTER_API_KEY.');
}

export function choice(instructions: string, criteria: Record<string, string>): Question {
  return { type: 'choice', instructions, criteria };
}

export function noul(instructions: string, criteria: { true: string; false: string }): Question {
  return { type: 'noul', instructions, criteria };
}

// A yes/no probability uses the same gate as a two-option choice.
export function asChoice(answer: Answer | NoulAnswer): Answer {
  if (answer.type === 'choice') return answer;
  return { type: 'choice', choice: answer.noul > 0.5 ? 'true' : 'false',
    probabilities: { true: answer.noul, false: 1 - answer.noul }, confidence: Math.abs(2 * answer.noul - 1) };
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateEvaluation(raw: unknown, questions: Record<string, Question>): Evaluation {
  const invalid = () => new JevError('INVALID_MODEL_RESPONSE', 'Invalid model response: missing fields, unknown choices, or invalid probabilities.');
  if (!object(raw) || typeof raw.model !== 'string' || !raw.model || !object(raw.answers)) throw invalid();
  for (const [id, q] of Object.entries(questions)) {
    const a = raw.answers[id];
    if (q.type === 'noul') {
      if (!object(a) || a.type !== 'noul' || !probability(a.noul)) throw invalid();
      continue;
    }
    if (!object(a) || a.type !== 'choice' || typeof a.choice !== 'string' ||
      !Object.hasOwn(q.criteria, a.choice) || !probability(a.confidence) || !object(a.probabilities)) throw invalid();
    const keys = Object.keys(q.criteria);
    if (keys.length !== Object.keys(a.probabilities).length ||
      !keys.every(k => Object.hasOwn(a.probabilities, k) && probability(a.probabilities[k]))) throw invalid();
    const values = Object.values(a.probabilities) as number[];
    if (Math.abs(values.reduce((s, p) => s + p, 0) - 1) > 0.025 ||
      a.probabilities[a.choice] < Math.max(...values)) throw invalid();
  }
  return raw as Evaluation;
}

export function accepted(answer: Answer, thresholds = { probability: 0.85, margin: 0.2 }): string {
  const selected = answer.probabilities[answer.choice];
  const second = Math.max(0, ...Object.entries(answer.probabilities).filter(([k]) => k !== answer.choice).map(([, p]) => p));
  if (selected < thresholds.probability || selected - second < thresholds.margin)
    throw new JevError('AMBIGUOUS', 'The model selection is below the probability or margin threshold. No action was taken.');
  return answer.choice;
}

export class Jev {
  readonly evidence: Array<Record<string, unknown>> = [];
  constructor(readonly config: ModelConfig, private request: typeof fetch = fetch) {}

  async evaluate(state: unknown, questions: Record<string, Question>): Promise<Evaluation> {
    const entries = Object.entries(questions);
    const body = JSON.stringify({ model: this.config.model, state, questions });
    if (entries.every(([, q]) => Object.keys(q.criteria).length <= 255) && Buffer.byteLength(body) <= 48_000)
      return this.send(body, questions);
    if (entries.length > 1) {
      const results = await Promise.all(entries.map(([id, q]) => this.evaluate(state, { [id]: q })));
      return { model: results[0].model, answers: Object.assign({}, ...results.map(r => r.answers)) };
    }
    if (!entries.length || entries[0][1].type !== 'choice') throw this.contextTooLarge();
    return this.evaluateBatches(state, entries[0]);
  }

  private contextTooLarge(): JevError {
    return new JevError('CONTEXT_TOO_LARGE', 'Model input still exceeds the 48 KB limit after batching. Narrow the scope with --scope.');
  }

  private async evaluateBatches(state: unknown, [id, question]: [string, Question]): Promise<Evaluation> {
    const escapes = Object.fromEntries(Object.entries(question.criteria).filter(([key]) => ['none', 'ambiguous'].includes(key)));
    const candidates = Object.entries(question.criteria).filter(([key]) => !Object.hasOwn(escapes, key));
    const batches: Question[] = [];
    let criteria = { ...escapes };
    const fits = (values: Record<string, string>) => Object.keys(values).length <= 255 &&
      Buffer.byteLength(JSON.stringify({ model: this.config.model, state,
        questions: { [id]: { ...question, criteria: values } } })) <= 48_000;
    for (const [key, label] of candidates) {
      if (!fits({ ...criteria, [key]: label })) {
        if (Object.keys(criteria).length === Object.keys(escapes).length) throw this.contextTooLarge();
        batches.push({ ...question, criteria });
        criteria = { ...escapes };
        if (!fits({ ...criteria, [key]: label })) throw this.contextTooLarge();
      }
      criteria[key] = label;
    }
    if (!candidates.length) throw this.contextTooLarge();
    batches.push({ ...question, criteria });
    // Keep runners-up so close alternatives survive into the common comparison.
    // Probabilities from separate Choice distributions must not be compared directly.
    const finalists: Record<string, string> = { ...escapes };
    for (let offset = 0; offset < batches.length; offset += 4) {
      const results = await Promise.all(batches.slice(offset, offset + 4).map(q => this.evaluate(state, { [id]: q })));
      for (const result of results) {
        const answer = asChoice(result.answers[id]);
        const ranked = Object.entries(answer.probabilities).filter(([key]) => !Object.hasOwn(escapes, key))
          .sort((a, b) => b[1] - a[1]).slice(0, 2);
        for (const [key] of ranked) finalists[key] = question.criteria[key];
      }
    }
    if (Object.keys(finalists).length >= Object.keys(question.criteria).length) throw this.contextTooLarge();
    return this.evaluate(state, { [id]: { ...question, criteria: finalists } });
  }

  private async send(body: string, questions: Record<string, Question>): Promise<Evaluation> {
    const start = performance.now();
    try {
      const response = await this.request(this.config.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${this.config.key}`, 'Content-Type': 'application/json' }, body,
      });
      if (!response.ok) throw new JevError(`MODEL_HTTP_${response.status}`, `${this.config.transport} returned HTTP ${response.status}. No action was taken.`);
      const raw = await response.json();
      const result = validateEvaluation(raw, questions);
      this.evidence.push({ transport: this.config.transport, requestedModel: this.config.model,
        resolvedModel: result.model, requestId: result.id ?? response.headers.get('x-request-id') ?? undefined,
        usage: result.usage, answers: result.answers, durationMs: Math.round(performance.now() - start) });
      return result;
    } catch (error) {
      if (error instanceof JevError) throw error;
      if (error instanceof SyntaxError) throw new JevError('INVALID_MODEL_RESPONSE', 'The model returned invalid JSON.');
      throw new JevError('MODEL_UNAVAILABLE', `${this.config.transport} request failed or timed out. No fallback provider was used.`);
    }
  }
}
