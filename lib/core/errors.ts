/** Shared domain errors, independent of Next.js and session authentication. */
export class HttpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}

export function fail(status: number, message: string, extra?: Record<string, unknown>): HttpError {
  return new HttpError(status, message, extra);
}
