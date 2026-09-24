import { EventEmitter } from 'node:events';
import type { MatrixJobEvent } from './matrix-job.js';

export interface MatrixJobEventBus {
  publish(jobId: string, event: MatrixJobEvent): Promise<void>;
  subscribe(
    jobId: string,
    handler: (event: MatrixJobEvent) => void,
  ): () => void;
}

export class InMemoryMatrixJobEventBus implements MatrixJobEventBus {
  private readonly emitter = new EventEmitter();

  async publish(jobId: string, event: MatrixJobEvent): Promise<void> {
    this.emitter.emit(jobId, event);
  }

  subscribe(jobId: string, handler: (event: MatrixJobEvent) => void) {
    this.emitter.on(jobId, handler);
    return () => this.emitter.off(jobId, handler);
  }
}
