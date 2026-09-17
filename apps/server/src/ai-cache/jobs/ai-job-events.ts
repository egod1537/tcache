import { EventEmitter } from 'node:events';

import type { AiJobEvent } from './ai-job.js';

export type AiJobEventHandler = (event: AiJobEvent) => void;
export type Unsubscribe = () => void;

export interface AiJobEventBus {
  publish(jobId: string, event: AiJobEvent): Promise<void>;
  subscribe(jobId: string, handler: AiJobEventHandler): Unsubscribe;
}

export class InMemoryAiJobEventBus implements AiJobEventBus {
  private readonly emitter = new EventEmitter();

  async publish(jobId: string, event: AiJobEvent): Promise<void> {
    this.emitter.emit(jobId, event);
  }

  subscribe(jobId: string, handler: AiJobEventHandler): Unsubscribe {
    this.emitter.on(jobId, handler);
    return () => this.emitter.off(jobId, handler);
  }
}
