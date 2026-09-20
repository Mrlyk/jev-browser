export type DecisionMeta = { modelRequests: number; decisions: Array<Record<string, unknown>> };

export class JevError extends Error {
  readonly code: string;
  readonly dispatched: boolean;
  meta?: DecisionMeta;

  constructor(code: string, message: string, dispatched = false) {
    super(message);
    this.name = 'JevError';
    this.code = code;
    this.dispatched = dispatched;
  }
}

export function withDecisionMeta(error: unknown, meta: DecisionMeta) {
  if (error instanceof JevError) error.meta = meta;
  return error;
}

export function object(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function failure(error: unknown) {
  const e = error instanceof JevError ? error : new JevError('INTERNAL_ERROR', 'Internal error. The command did not complete.');
  return { success: false, error: { code: e.code, message: e.message, dispatched: e.dispatched },
    ...(e.meta ? { meta: e.meta } : {}) };
}
