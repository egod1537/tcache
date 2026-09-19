import type { PingResponse, ServiceStatus } from '@tcache/common';

export type RouteJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RouteJobError {
  code: string;
  message: string;
  details?: unknown;
}

export type RouteTravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT';

export type RouteLocation =
  | { type: 'address'; address: string }
  | { type: 'coordinates'; latitude: number; longitude: number }
  | { type: 'placeId'; placeId: string };

export type PublicRouteLocation =
  | { placeId: string }
  | { address: string }
  | { latitude: number; longitude: number };

export interface PublicRouteRequest {
  locations: PublicRouteLocation[];
  mode: RouteTravelMode;
  departureTime: string;
  computeAlternativeRoutes?: boolean;
  languageCode?: string;
  regionCode?: string;
  routingPreference?: string;
  units?: string;
}

export interface RouteRequest {
  origin: RouteLocation;
  intermediates: RouteLocation[];
  destination: RouteLocation;
  travelMode: RouteTravelMode;
  computeAlternativeRoutes: boolean;
  languageCode?: string;
  regionCode?: string;
  departureTime?: string;
  routingPreference?: string;
  units?: string;
}

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface NormalizedRouteLeg {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startLocation: RouteCoordinate | null;
  endLocation: RouteCoordinate | null;
  steps: unknown[];
}

export interface NormalizedRoute {
  description: string;
  routeLabels: string[];
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string;
  path: RouteCoordinate[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
  legs: NormalizedRouteLeg[];
  warnings: string[];
}

export interface GoogleRouteProviderResult {
  provider: 'google';
  routes: NormalizedRoute[];
  raw: unknown;
  debug: {
    request: unknown;
    fieldMask: string;
    httpStatus: number;
    latencyMs: number;
  };
}

export interface NormalizedRouteRequest extends RouteRequest {
  waypoints: RouteLocation[];
  options: Record<string, unknown>;
}

export interface GoogleProviderComputeResponse {
  provider: string;
  normalizedRequest: NormalizedRouteRequest;
  result: GoogleRouteProviderResult;
}

export interface RouteJobView {
  jobId: string;
  status: RouteJobStatus;
  stage: string;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  request: RouteRequest;
  normalizedRequest?: RouteRequest & { waypoints?: RouteLocation[] };
  requestMetadata?: {
    fromKey: string;
    toKey: string;
    intermediateKeys: string[];
    dayType: 'weekday' | 'saturday' | 'sunday' | 'holiday';
    timeBucket: string;
  };
  cache?: { hit: boolean; key: string; ttl: number };
  provider?: string;
  providerLatencyMs?: number;
  error?: RouteJobError;
}

export interface RouteJobResult {
  jobId: string;
  status: RouteJobStatus;
  cache?: { hit: boolean; key: string; ttl: number };
  provider?: string;
  providerLatencyMs?: number;
  result?: unknown;
  error?: RouteJobError;
}

export interface CreateRouteJobResponse {
  jobId: string;
  status: 'queued';
  eventsUrl: string;
  resultUrl: string;
}

export interface RouteCacheEntrySummary {
  key: string;
  provider: string | null;
  ttlSeconds: number;
  sizeBytes: number;
}

export interface RouteCacheEntry extends RouteCacheEntrySummary {
  value: {
    provider: string;
    result: unknown;
  };
}

export interface RouteAnalyticsFilters {
  from: string;
  to: string;
  mode?: RouteTravelMode;
  provider?: string;
  status?: RouteJobStatus;
}

export interface RouteAnalyticsSummary {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  providerCalls: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface RouteAnalyticsTimeseriesPoint {
  time: string;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface RouteAnalyticsMode {
  mode: RouteTravelMode;
  requests: number;
  cacheHitRate: number;
}

export interface RouteAnalyticsTopRoute {
  fromKey: string;
  toKey: string;
  mode: RouteTravelMode;
  requests: number;
  cacheHitRate: number;
  avgLatencyMs: number;
}

export interface RouteAnalyticsError {
  errorCode: string;
  count: number;
}

export interface RouteAnalyticsRecentRequest {
  createdAt: string;
  jobId: string;
  fromKey: string;
  toKey: string;
  mode: RouteTravelMode;
  provider: string | null;
  cacheHit: boolean | null;
  latency: number | null;
  status: RouteJobStatus;
  errorCode: string | null;
}

export interface RouteAnalyticsDashboard {
  summary: RouteAnalyticsSummary;
  points: RouteAnalyticsTimeseriesPoint[];
  modes: RouteAnalyticsMode[];
  routes: RouteAnalyticsTopRoute[];
  errors: RouteAnalyticsError[];
  recent: RouteAnalyticsRecentRequest[];
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export async function checkHealth(signal?: AbortSignal) {
  const body = await getJson<{ status: string }>('/health', signal);
  if (body.status !== 'ok') throw new Error('Unexpected health response');
  return body;
}

export function getServiceStatus(signal?: AbortSignal) {
  return getJson<ServiceStatus>('/api/status', signal);
}

export function pingRouteCache(signal?: AbortSignal) {
  return getJson<PingResponse>('/api/route/ping', signal);
}

export function pingAiCache(signal?: AbortSignal) {
  return getJson<PingResponse>('/api/ai/ping', signal);
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { code?: string; message?: string; details?: unknown };
  };
  if (!response.ok) {
    throw new ApiRequestError(
      body.error?.message ?? `HTTP ${response.status}`,
      response.status,
      body.error?.code ?? 'HTTP_ERROR',
      body.error?.details,
    );
  }
  return body;
}

export function computeGoogleRoute(request: unknown, signal?: AbortSignal) {
  return requestJson<GoogleProviderComputeResponse>(
    '/api/route/provider/google/compute',
    {
      method: 'POST',
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    },
  );
}

export function createRouteJob(request: unknown) {
  return requestJson<CreateRouteJobResponse>('/api/route/jobs', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function listRouteJobs() {
  const response = await requestJson<{ jobs: RouteJobView[] }>(
    '/api/route/jobs?limit=50',
  );
  return response.jobs;
}

export function getRouteJob(jobId: string) {
  return requestJson<RouteJobView>(
    `/api/route/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function getRouteJobResult(jobId: string) {
  const response = await fetch(
    `/api/route/jobs/${encodeURIComponent(jobId)}/result`,
    { cache: 'no-store' },
  );
  const body = (await response.json()) as RouteJobResult;
  if (!response.ok && response.status !== 409) {
    throw new Error(`HTTP ${response.status}`);
  }
  return body;
}

export function cancelRouteJob(jobId: string) {
  return requestJson<{ jobId: string; status: RouteJobStatus }>(
    `/api/route/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
}

export async function listRouteCacheEntries(limit = 50, signal?: AbortSignal) {
  const response = await requestJson<{ entries: RouteCacheEntrySummary[] }>(
    `/api/route/cache?limit=${limit}`,
    { ...(signal ? { signal } : {}) },
  );
  return response.entries;
}

export function getRouteCacheEntry(key: string, signal?: AbortSignal) {
  return requestJson<RouteCacheEntry>(
    `/api/route/cache/entry?key=${encodeURIComponent(key)}`,
    { ...(signal ? { signal } : {}) },
  );
}

export async function getRouteAnalyticsDashboard(
  filters: RouteAnalyticsFilters,
  interval: 'hour' | 'day',
  signal?: AbortSignal,
): Promise<RouteAnalyticsDashboard> {
  const query = createAnalyticsQuery(filters);
  const request = <T>(path: string, extraQuery = '') =>
    requestJson<T>(`/api/route/analytics/${path}?${query}${extraQuery}`, {
      ...(signal ? { signal } : {}),
    });
  const [summary, timeseries, modes, topRoutes, errors, recent] =
    await Promise.all([
      request<RouteAnalyticsSummary>('summary'),
      request<{ points: RouteAnalyticsTimeseriesPoint[] }>(
        'timeseries',
        `&interval=${interval}`,
      ),
      request<{ modes: RouteAnalyticsMode[] }>('modes'),
      request<{ routes: RouteAnalyticsTopRoute[] }>('top-routes', '&limit=20'),
      request<{ errors: RouteAnalyticsError[] }>('errors'),
      request<{ requests: RouteAnalyticsRecentRequest[] }>(
        'recent',
        '&limit=50',
      ),
    ]);
  return {
    summary,
    points: timeseries.points,
    modes: modes.modes,
    routes: topRoutes.routes,
    errors: errors.errors,
    recent: recent.requests,
  };
}

function createAnalyticsQuery(filters: RouteAnalyticsFilters) {
  const query = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.mode) query.set('mode', filters.mode);
  if (filters.provider) query.set('provider', filters.provider);
  if (filters.status) query.set('status', filters.status);
  return query.toString();
}

export function subscribeRouteJob(
  jobId: string,
  onEvent: (job: RouteJobView, eventType: RouteJobStreamEventType) => void,
  onConnectionState: (state: RouteJobStreamState) => void,
) {
  const source = new EventSource(
    `/api/route/jobs/${encodeURIComponent(jobId)}/events`,
  );
  const eventNames = [
    'snapshot',
    'progress',
    'completed',
    'failed',
    'cancelled',
  ] as const;

  source.onopen = () => onConnectionState('connected');

  for (const eventName of eventNames) {
    source.addEventListener(eventName, (event) => {
      const job = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as RouteJobView;
      onEvent(job, eventName);
      if (['completed', 'failed', 'cancelled'].includes(eventName)) {
        source.close();
        onConnectionState('disconnected');
      }
    });
  }
  source.onerror = () =>
    onConnectionState(
      source.readyState === EventSource.CLOSED
        ? 'disconnected'
        : 'reconnecting',
    );
  return () => source.close();
}

export type RouteJobStreamState = 'connected' | 'reconnecting' | 'disconnected';

export type RouteJobStreamEventType =
  'snapshot' | 'progress' | 'completed' | 'failed' | 'cancelled';

export type AiJobStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AiRequestMetadata {
  provider: string;
  model: string;
  messageCount: number;
  promptHash: string;
  promptVersion?: string;
  hasSystemPrompt: boolean;
  optionKeys: string[];
  toolCount: number;
  hasResponseSchema: boolean;
  cacheEnabled: boolean;
}

export interface AiJobView {
  jobId: string;
  status: AiJobStatus;
  stage: string;
  progress: number;
  provider: string;
  model: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  requestMetadata: AiRequestMetadata;
  cache?: { enabled: boolean; hit: boolean; key: string; ttl: number };
  error?: RouteJobError;
}

export interface AiJobResult {
  jobId: string;
  status: AiJobStatus;
  cache?: { enabled: boolean; hit: boolean; key: string; ttl: number };
  provider: string;
  model: string;
  request?: {
    provider: string;
    model: string;
    systemPrompt?: string;
    promptVersion?: string;
    messages: Array<{ role: string; content: string }>;
    options: Record<string, unknown>;
    cache: { enabled: boolean };
  };
  text?: string;
  result?: unknown;
  error?: RouteJobError;
}

export interface OpenWebUIModel {
  id: string;
  name: string;
}

export interface CreateAiJobResponse {
  jobId: string;
  status: 'queued';
  eventsUrl: string;
  resultUrl: string;
}

export function createAiJob(request: unknown) {
  return requestJson<CreateAiJobResponse>('/api/ai/jobs', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getOpenWebUIModels(signal?: AbortSignal) {
  const response = await requestJson<{
    provider: 'openwebui';
    models: OpenWebUIModel[];
  }>('/api/ai/providers/openwebui/models', signal ? { signal } : undefined);
  return response.models;
}

export async function listAiJobs() {
  const response = await requestJson<{ jobs: AiJobView[] }>(
    '/api/ai/jobs?limit=50',
  );
  return response.jobs;
}

export function getAiJob(jobId: string) {
  return requestJson<AiJobView>(`/api/ai/jobs/${encodeURIComponent(jobId)}`);
}

export async function getAiJobResult(jobId: string) {
  const response = await fetch(
    `/api/ai/jobs/${encodeURIComponent(jobId)}/result`,
    { cache: 'no-store' },
  );
  const body = (await response.json()) as AiJobResult;
  if (!response.ok && response.status !== 409) {
    throw new Error(`HTTP ${response.status}`);
  }
  return body;
}

export function cancelAiJob(jobId: string) {
  return requestJson<{ jobId: string; status: AiJobStatus }>(
    `/api/ai/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
}

export function subscribeAiJob(
  jobId: string,
  onEvent: (job: AiJobView) => void,
  onConnectionError: () => void,
) {
  const source = new EventSource(
    `/api/ai/jobs/${encodeURIComponent(jobId)}/events`,
  );
  const eventNames = [
    'snapshot',
    'progress',
    'completed',
    'failed',
    'cancelled',
  ] as const;
  for (const eventName of eventNames) {
    source.addEventListener(eventName, (event) => {
      const job = JSON.parse((event as MessageEvent<string>).data) as AiJobView;
      onEvent(job);
      if (['completed', 'failed', 'cancelled'].includes(eventName))
        source.close();
    });
  }
  source.onerror = onConnectionError;
  return () => source.close();
}
