import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  subscribeAiJob,
  type AiJobStreamState,
} from '../../apps/testbed/src/api/client';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  emit(name: string, data: string) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

describe('subscribeAiJob', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => vi.unstubAllGlobals());

  function subscribe() {
    const events: Array<{ type: string; payload: unknown }> = [];
    const states: AiJobStreamState[] = [];
    const unsubscribe = subscribeAiJob(
      'ai_a/b',
      (_job, type, payload) => events.push({ type, payload }),
      (state) => states.push(state),
    );
    const source = FakeEventSource.instances[0]!;
    return { events, states, unsubscribe, source };
  }

  it('reports connected, reconnecting and disconnected without ending the Job', () => {
    const { states, source, events } = subscribe();
    expect(source.url).toBe('/api/ai/jobs/ai_a%2Fb/events');

    source.open();
    source.onerror?.(); // readyState is OPEN -> EventSource is retrying
    expect(states).toEqual(['connected', 'reconnecting']);

    source.close();
    source.onerror?.();
    expect(states.at(-1)).toBe('disconnected');
    expect(events).toEqual([]);
  });

  it('passes through the raw parsed payload of each event', () => {
    const { events, source } = subscribe();
    const snapshot = { jobId: 'ai_a', status: 'queued', progress: 0 };
    source.emit('snapshot', JSON.stringify(snapshot));
    source.emit('progress', JSON.stringify({ ...snapshot, progress: 30 }));
    expect(events).toEqual([
      { type: 'snapshot', payload: snapshot },
      { type: 'progress', payload: { ...snapshot, progress: 30 } },
    ]);
    expect(source.closed).toBe(false);
  });

  it.each(['completed', 'failed', 'cancelled'])(
    'closes the stream and reports disconnected after %s',
    (terminal) => {
      const { events, states, source } = subscribe();
      source.open();
      source.emit(
        terminal,
        JSON.stringify({ jobId: 'ai_a', status: terminal }),
      );
      expect(events.map((event) => event.type)).toEqual([terminal]);
      expect(source.closed).toBe(true);
      expect(states).toEqual(['connected', 'disconnected']);
    },
  );

  it('ignores malformed event data', () => {
    const { events, source } = subscribe();
    source.emit('progress', 'not json');
    expect(events).toEqual([]);
  });

  it('closes the EventSource on unsubscribe', () => {
    const { unsubscribe, source } = subscribe();
    unsubscribe();
    expect(source.closed).toBe(true);
  });
});
