import type { NormalizedRouteRequest } from '../../types/route.js';
import type { RouteProvider, RouteProviderResult } from '../provider.js';

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export class MockRouteProvider implements RouteProvider {
  readonly providerName = 'mock';

  async getRoute(
    request: NormalizedRouteRequest,
    signal: AbortSignal,
  ): Promise<RouteProviderResult> {
    await delay(500, signal);
    return {
      provider: 'mock',
      result: {
        routes: [
          {
            travelMode: request.travelMode,
            origin: request.origin,
            destination: request.destination,
            waypoints: request.waypoints,
            duration: '0s',
            distanceMeters: 0,
          },
        ],
      },
    };
  }
}
