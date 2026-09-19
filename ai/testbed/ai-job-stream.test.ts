import { describe, expect, it } from 'vitest';

import {
  aiStreamReducer,
  createAiStreamState,
  eventEntries,
  MAX_TIMELINE_ENTRIES,
  type AiStreamAction,
  type AiStreamState,
} from './ai-job-stream';

const view = (overrides: Record<string, unknown> = {}) => ({
  jobId: 'ai_a',
  status: 'running',
  stage: 'provider',
  progress: 40,
  message: 'Calling provider',
  requestMetadata: { messageCount: 1, promptHash: 'h', hasSystemPrompt: true },
  ...overrides,
});

const at = (n: number) => `2026-01-01T00:00:0${n}.000Z`;

function run(initial: AiStreamState, actions: AiStreamAction[]) {
  return actions.reduce(aiStreamReducer, initial);
}

describe('AI SSE stream state', () => {
  it('starts connecting for a Job and disconnected without one', () => {
    expect(createAiStreamState('ai_a').connection).toBe('connecting');
    expect(createAiStreamState(null).connection).toBe('disconnected');
  });

  it('tracks connected -> reconnecting -> connected -> disconnected', () => {
    const state = run(createAiStreamState('ai_a'), [
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'connected',
        receivedAt: at(1),
      },
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'reconnecting',
        receivedAt: at(2),
      },
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'connected',
        receivedAt: at(3),
      },
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'disconnected',
        receivedAt: at(4),
      },
    ]);
    expect(state.connection).toBe('disconnected');
    expect(state.connectionCount).toBe(2);
    expect(state.entries.map((entry) => entry.kind)).toEqual([
      'connection',
      'connection',
      'connection',
      'connection',
    ]);
  });

  it('does not record repeated identical connection states', () => {
    const state = run(createAiStreamState('ai_a'), [
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'reconnecting',
        receivedAt: at(1),
      },
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'reconnecting',
        receivedAt: at(2),
      },
    ]);
    expect(state.entries).toHaveLength(1);
  });

  it('records progress and terminal events with their raw payload', () => {
    const progress = view();
    const completed = view({
      status: 'completed',
      stage: 'done',
      progress: 100,
    });
    const state = run(createAiStreamState('ai_a'), [
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'connected',
        receivedAt: at(1),
      },
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'snapshot',
        payload: view({ status: 'queued', progress: 0 }),
        receivedAt: at(1),
      },
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'progress',
        payload: progress,
        receivedAt: at(2),
      },
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'completed',
        payload: completed,
        receivedAt: at(3),
      },
    ]);
    const events = eventEntries(state.entries);
    expect(events.map((entry) => entry.eventType)).toEqual([
      'snapshot',
      'progress',
      'completed',
    ]);
    expect(events[1]).toMatchObject({
      receivedAt: at(2),
      status: 'running',
      stage: 'provider',
      progress: 40,
      message: 'Calling provider',
      connection: 1,
    });
    expect(events[1]?.payload).toBe(progress);
    expect(events[2]).toMatchObject({ status: 'completed', progress: 100 });
  });

  it('stamps events received after a reconnect with the new connection', () => {
    const state = run(createAiStreamState('ai_a'), [
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'connected',
        receivedAt: at(1),
      },
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'reconnecting',
        receivedAt: at(2),
      },
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'connected',
        receivedAt: at(3),
      },
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'snapshot',
        payload: view(),
        receivedAt: at(3),
      },
    ]);
    expect(eventEntries(state.entries)[0]).toMatchObject({
      eventType: 'snapshot',
      connection: 2,
    });
  });

  it('does not mix events between Jobs after switching', () => {
    let state = run(createAiStreamState('ai_a'), [
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'progress',
        payload: view(),
        receivedAt: at(1),
      },
    ]);
    state = aiStreamReducer(state, { type: 'select', jobId: 'ai_b' });
    expect(state.entries).toEqual([]);
    expect(state.connection).toBe('connecting');

    // Late callbacks from the previous Job's stream are dropped.
    state = run(state, [
      {
        type: 'connection',
        jobId: 'ai_a',
        state: 'connected',
        receivedAt: at(2),
      },
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'completed',
        payload: view({ status: 'completed' }),
        receivedAt: at(2),
      },
    ]);
    expect(state.entries).toEqual([]);
    expect(state.connection).toBe('connecting');

    state = aiStreamReducer(state, {
      type: 'event',
      jobId: 'ai_b',
      eventType: 'snapshot',
      payload: view({ jobId: 'ai_b' }),
      receivedAt: at(3),
    });
    expect(eventEntries(state.entries)).toHaveLength(1);
  });

  it('keeps the timeline when the same Job is selected again', () => {
    const state = run(createAiStreamState('ai_a'), [
      {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'progress',
        payload: view(),
        receivedAt: at(1),
      },
    ]);
    expect(aiStreamReducer(state, { type: 'select', jobId: 'ai_a' })).toBe(
      state,
    );
  });

  it('bounds the timeline size', () => {
    let state = createAiStreamState('ai_a');
    for (let i = 0; i < MAX_TIMELINE_ENTRIES + 25; i += 1) {
      state = aiStreamReducer(state, {
        type: 'event',
        jobId: 'ai_a',
        eventType: 'progress',
        payload: view({ progress: i }),
        receivedAt: at(1),
      });
    }
    expect(state.entries).toHaveLength(MAX_TIMELINE_ENTRIES);
    expect(eventEntries(state.entries).at(-1)?.progress).toBe(
      MAX_TIMELINE_ENTRIES + 24,
    );
  });

  it('tolerates non-object payloads', () => {
    const state = aiStreamReducer(createAiStreamState('ai_a'), {
      type: 'event',
      jobId: 'ai_a',
      eventType: 'progress',
      payload: null,
      receivedAt: at(1),
    });
    expect(eventEntries(state.entries)[0]).toMatchObject({
      status: undefined,
      payload: null,
    });
  });
});
