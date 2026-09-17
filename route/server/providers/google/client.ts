import type { NormalizedRouteRequest } from '../../types/route.js';
import type { RouteProvider, RouteProviderResult } from '../provider.js';
import { toGoogleRoutesRequest } from './mapper.js';

const GOOGLE_ROUTES_URL =
  'https://routes.googleapis.com/directions/v2:computeRoutes';

export class GoogleRouteProvider implements RouteProvider {
  constructor(private readonly apiKey: string) {}

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    if (!this.apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY is not configured');
    }

    const response = await fetch(GOOGLE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs',
      },
      body: JSON.stringify(toGoogleRoutesRequest(request)),
      signal,
    });

    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(`Google Routes API returned HTTP ${response.status}`);
    }

    return { provider: 'google', result: body };
  }
}
