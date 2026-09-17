import { boundsFromPath, decodeGooglePolyline } from './polyline.js';
import type {
  NormalizedGoogleRoute,
  NormalizedRouteLeg,
  NormalizedRouteStep,
  RouteBounds,
  RouteCoordinate,
} from './types.js';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(value)) {
    return null;
  }
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) ? seconds : null;
}

function coordinate(value: unknown): RouteCoordinate | null {
  const latLng = record(record(value)?.latLng);
  const lat = numberOrNull(latLng?.latitude);
  const lng = numberOrNull(latLng?.longitude);
  return lat === null || lng === null ? null : { lat, lng };
}

function parseStep(value: unknown): NormalizedRouteStep {
  const step = record(value) ?? {};
  const navigationInstruction = record(step.navigationInstruction);
  return {
    distanceMeters: numberOrNull(step.distanceMeters),
    durationSeconds: durationSeconds(step.staticDuration ?? step.duration),
    startLocation: coordinate(step.startLocation),
    endLocation: coordinate(step.endLocation),
    travelMode: typeof step.travelMode === 'string' ? step.travelMode : null,
    instruction:
      typeof navigationInstruction?.instructions === 'string'
        ? navigationInstruction.instructions
        : null,
    transitDetails: record(step.transitDetails),
  };
}

function parseLeg(value: unknown): NormalizedRouteLeg {
  const leg = record(value) ?? {};
  return {
    distanceMeters: numberOrNull(leg.distanceMeters),
    durationSeconds: durationSeconds(leg.duration ?? leg.staticDuration),
    startLocation: coordinate(leg.startLocation),
    endLocation: coordinate(leg.endLocation),
    steps: Array.isArray(leg.steps) ? leg.steps.map(parseStep) : [],
  };
}

function parseBounds(value: unknown): RouteBounds | null {
  const viewport = record(value);
  const low = record(viewport?.low);
  const high = record(viewport?.high);
  const north = numberOrNull(high?.latitude);
  const south = numberOrNull(low?.latitude);
  const east = numberOrNull(high?.longitude);
  const west = numberOrNull(low?.longitude);
  return north === null || south === null || east === null || west === null
    ? null
    : { north, south, east, west };
}

function parseRoute(value: unknown): NormalizedGoogleRoute {
  const route = record(value);
  if (!route) throw new Error('Google route must be an object');
  const polyline = record(route.polyline);
  const encodedPolyline =
    typeof polyline?.encodedPolyline === 'string'
      ? polyline.encodedPolyline
      : '';
  const path = encodedPolyline ? decodeGooglePolyline(encodedPolyline) : [];
  const routeLabels = Array.isArray(route.routeLabels)
    ? route.routeLabels.filter(
        (label): label is string => typeof label === 'string',
      )
    : [];

  return {
    description:
      typeof route.description === 'string'
        ? route.description
        : routeLabels.join(', '),
    routeLabels,
    distanceMeters: numberOrNull(route.distanceMeters),
    durationSeconds: durationSeconds(route.duration),
    encodedPolyline,
    path,
    bounds: parseBounds(route.viewport) ?? boundsFromPath(path),
    legs: Array.isArray(route.legs) ? route.legs.map(parseLeg) : [],
    warnings: Array.isArray(route.warnings)
      ? route.warnings.filter(
          (warning): warning is string => typeof warning === 'string',
        )
      : [],
  };
}

export function parseGoogleRoutesResponse(value: unknown) {
  const response = record(value);
  if (!response || !Array.isArray(response.routes)) {
    throw new Error('Google Routes response does not contain routes');
  }
  return response.routes.map(parseRoute);
}
