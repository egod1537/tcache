import { EventEmitter } from 'node:events';

import type { RouteJobEvent } from './route-job.js';

export type RouteJobEventHandler = (event: RouteJobEvent) => void;
export type Unsubscribe = () => void;

export interface RouteJobEventBus {
  publish(jobId: string, event: RouteJobEvent): Promise<void>;
  subscribe(jobId: string, handler: RouteJobEventHandler): Unsubscribe;
}

export class InMemoryRouteJobEventBus implements RouteJobEventBus {
  private readonly emitter = new EventEmitter();

  async publish(jobId: string, event: RouteJobEvent): Promise<void> {
    this.emitter.emit(jobId, event);
  }

  subscribe(jobId: string, handler: RouteJobEventHandler): Unsubscribe {
    this.emitter.on(jobId, handler);
    return () => this.emitter.off(jobId, handler);
  }
}
