import type { JrEastFailureCode } from './model.js';

export class JrEastPipelineError extends Error {
  constructor(
    readonly code: JrEastFailureCode,
    message: string,
    readonly sourceUrl?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'JrEastPipelineError';
  }
}
