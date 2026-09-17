import type { NormalizedRouteRequest } from '../../types/route.js';
import type { RouteProvider, RouteProviderResult } from '../provider.js';
import { createGoogleUpstreamError, GoogleRoutesError } from './errors.js';
import { toGoogleRoutesRequest } from './mapper.js';
import { parseGoogleRoutesResponse } from './parser.js';
import { boundsFromPath, encodeGooglePolyline } from './polyline.js';
import type {
  GoogleRouteResult,
  NormalizedGoogleRoute,
  RouteCoordinate,
} from './types.js';

const GOOGLE_ROUTES_URL =
  'https://routes.googleapis.com/directions/v2:computeRoutes';

export const GOOGLE_ROUTES_FIELD_MASK = [
  'routes.description',
  'routes.routeLabels',
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.viewport',
  'routes.warnings',
  'routes.legs.distanceMeters',
  'routes.legs.duration',
  'routes.legs.startLocation',
  'routes.legs.endLocation',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.startLocation',
  'routes.legs.steps.endLocation',
  'routes.legs.steps.navigationInstruction.instructions',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails.stopDetails',
  'routes.legs.steps.transitDetails.headsign',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.stopCount',
].join(',');

export class GoogleRouteProvider implements RouteProvider {
  readonly providerName = 'google';

  constructor(private readonly apiKey: string) {}

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    if (request.travelMode === 'TRANSIT' && request.intermediates.length) {
      return this.getTransitRoute(request, signal);
    }

    if (!this.apiKey) {
      throw new GoogleRoutesError('GOOGLE_MAPS_API_KEY is not configured', {
        upstream: {
          httpStatus: null,
          status: 'NOT_CONFIGURED',
          message: 'The backend Google Routes API key is missing',
        },
      });
    }

    const upstreamRequest = toGoogleRoutesRequest(request);
    const startedAt = performance.now();

    let response: Response;
    try {
      response = await fetch(GOOGLE_ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': GOOGLE_ROUTES_FIELD_MASK,
        },
        body: JSON.stringify(upstreamRequest),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw new GoogleRoutesError('Unable to reach Google Routes API', {
        upstream: {
          httpStatus: null,
          status: 'UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Network error',
          requestBody: upstreamRequest,
        },
      });
    }

    const raw = redactSecret(await readBody(response), this.apiKey);
    if (!response.ok) {
      throw createGoogleUpstreamError(response.status, raw, upstreamRequest);
    }

    let routes;
    try {
      routes = parseGoogleRoutesResponse(raw);
    } catch (error) {
      throw new GoogleRoutesError(
        error instanceof Error
          ? `Invalid Google Routes response: ${error.message}`
          : 'Invalid Google Routes response',
        {
          upstream: {
            httpStatus: response.status,
            status: 'INVALID_RESPONSE',
            message: null,
            requestBody: upstreamRequest,
            rawErrorBody: raw,
          },
        },
      );
    }

    const result: GoogleRouteResult = {
      provider: 'google',
      routes,
      raw,
      debug: {
        request: upstreamRequest,
        fieldMask: GOOGLE_ROUTES_FIELD_MASK,
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    };
    return { provider: 'google', result };
  }

  private async getTransitRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    const locations = [
      request.origin,
      ...request.intermediates,
      request.destination,
    ];
    const segmentRequests = locations.slice(1).map((destination, index) => ({
      ...request,
      origin: locations[index]!,
      destination,
      intermediates: [],
      waypoints: [],
      computeAlternativeRoutes: false,
    }));
    const controller = new AbortController();
    const combinedSignal = AbortSignal.any([signal, controller.signal]);
    const startedAt = performance.now();

    try {
      const segmentResults = await Promise.all(
        segmentRequests.map(async (segmentRequest) => {
          const providerResult = await this.getRoute(
            segmentRequest,
            combinedSignal,
          );
          return providerResult.result as GoogleRouteResult;
        }),
      );
      const routes = segmentResults.map((result) => result.routes[0]);
      if (routes.some((route) => !route)) {
        throw new GoogleRoutesError(
          'Google Routes API returned no route for a transit segment',
          {
            upstream: {
              httpStatus: 200,
              status: 'ROUTE_NOT_FOUND',
              message: 'At least one transit segment returned no route',
            },
          },
        );
      }
      const merged = mergeTransitRoutes(routes as NormalizedGoogleRoute[]);
      const result: GoogleRouteResult = {
        provider: 'google',
        routes: [merged],
        raw: {
          segments: segmentResults.map((segment, index) => ({
            request: segmentRequests[index],
            response: segment.raw,
          })),
        },
        debug: {
          request: {
            segmentedTransit: true,
            segments: segmentResults.map((segment) => segment.debug.request),
          },
          fieldMask: GOOGLE_ROUTES_FIELD_MASK,
          httpStatus: 200,
          latencyMs: Math.round(performance.now() - startedAt),
        },
      };
      return { provider: 'google', result };
    } finally {
      controller.abort(new Error('Transit segment group finished'));
    }
  }
}

function mergeTransitRoutes(
  segments: NormalizedGoogleRoute[],
): NormalizedGoogleRoute {
  const path: RouteCoordinate[] = [];
  for (const segment of segments) {
    for (const point of segment.path) {
      const previous = path.at(-1);
      if (
        !previous ||
        previous.lat !== point.lat ||
        previous.lng !== point.lng
      ) {
        path.push(point);
      }
    }
  }

  return {
    description: `Transit route with ${segments.length} segments`,
    routeLabels: [],
    distanceMeters: sumNullable(segments.map((route) => route.distanceMeters)),
    durationSeconds: sumNullable(
      segments.map((route) => route.durationSeconds),
    ),
    encodedPolyline: encodeGooglePolyline(path),
    path,
    bounds: boundsFromPath(path),
    legs: segments.flatMap((route) => route.legs),
    warnings: [
      'Transit intermediates were queried as separate segments; connection timing and dwell time are not included.',
      ...new Set(segments.flatMap((route) => route.warnings)),
    ],
  };
}

function sumNullable(values: Array<number | null>): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function redactSecret(value: unknown, secret: string): unknown {
  if (!secret) return value;
  if (typeof value === 'string') return value.replaceAll(secret, '[REDACTED]');
  if (Array.isArray(value)) {
    return value.map((item) => redactSecret(item, secret));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      redactSecret(child, secret),
    ]),
  );
}
