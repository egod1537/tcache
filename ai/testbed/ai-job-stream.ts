import type {
  AiJobStatus,
  AiJobStreamEventType,
  AiJobStreamState,
  AiJobView,
} from '../../apps/testbed/src/api/client';

/** Debug-only cap so a long-lived Job cannot grow the timeline unbounded. */
export const MAX_TIMELINE_ENTRIES = 200;

export type AiConnectionState = AiJobStreamState | 'connecting';

export interface AiTimelineEventEntry {
  id: number;
  kind: 'event';
  receivedAt: string;
  /** 1-based EventSource connection the event arrived on. */
  connection: number;
  eventType: AiJobStreamEventType;
  status: AiJobStatus | undefined;
  stage: string | undefined;
  progress: number | undefined;
  message: string | undefined;
  payload: unknown;
}

export interface AiTimelineConnectionEntry {
  id: number;
  kind: 'connection';
  receivedAt: string;
  connection: number;
  state: AiJobStreamState;
}

export type AiTimelineEntry = AiTimelineEventEntry | AiTimelineConnectionEntry;

/**
 * Per-Job debug state. Everything is keyed by `jobId` and actions for any other
 * Job are dropped, so events from a previous selection can never leak in.
 */
export interface AiStreamState {
  jobId: string | null;
  connection: AiConnectionState;
  /** Number of times the stream has (re)opened for this Job. */
  connectionCount: number;
  entries: AiTimelineEntry[];
  nextId: number;
}

export type AiStreamAction =
  | { type: 'select'; jobId: string | null }
  | {
      type: 'connection';
      jobId: string;
      state: AiJobStreamState;
      receivedAt: string;
    }
  | {
      type: 'event';
      jobId: string;
      eventType: AiJobStreamEventType;
      payload: unknown;
      receivedAt: string;
    };

export function createAiStreamState(jobId: string | null): AiStreamState {
  return {
    jobId,
    connection: jobId ? 'connecting' : 'disconnected',
    connectionCount: 0,
    entries: [],
    nextId: 1,
  };
}

function pushEntry(
  state: AiStreamState,
  entry: AiTimelineEntry,
): AiTimelineEntry[] {
  const entries = [...state.entries, entry];
  return entries.length > MAX_TIMELINE_ENTRIES
    ? entries.slice(entries.length - MAX_TIMELINE_ENTRIES)
    : entries;
}

function readView(payload: unknown): Partial<AiJobView> {
  return payload && typeof payload === 'object'
    ? (payload as Partial<AiJobView>)
    : {};
}

export function aiStreamReducer(
  state: AiStreamState,
  action: AiStreamAction,
): AiStreamState {
  if (action.type === 'select') {
    return state.jobId === action.jobId
      ? state
      : createAiStreamState(action.jobId);
  }
  if (action.jobId !== state.jobId) return state;

  if (action.type === 'connection') {
    if (action.state === state.connection) return state;
    const connectionCount =
      action.state === 'connected'
        ? state.connectionCount + 1
        : state.connectionCount;
    return {
      ...state,
      connection: action.state,
      connectionCount,
      nextId: state.nextId + 1,
      entries: pushEntry(state, {
        id: state.nextId,
        kind: 'connection',
        receivedAt: action.receivedAt,
        connection: connectionCount,
        state: action.state,
      }),
    };
  }

  const view = readView(action.payload);
  return {
    ...state,
    nextId: state.nextId + 1,
    entries: pushEntry(state, {
      id: state.nextId,
      kind: 'event',
      receivedAt: action.receivedAt,
      connection: state.connectionCount,
      eventType: action.eventType,
      status: view.status,
      stage: view.stage,
      progress: view.progress,
      message: view.message,
      payload: action.payload,
    }),
  };
}

/** Timeline entries that carry an SSE payload, in receive order. */
export function eventEntries(entries: AiTimelineEntry[]) {
  return entries.filter(
    (entry): entry is AiTimelineEventEntry => entry.kind === 'event',
  );
}
