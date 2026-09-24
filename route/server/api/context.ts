import type { RouteJobEventBus } from '../jobs/route-job-events.js';
import type { RouteJobService } from '../jobs/route-job-service.js';
import type { RouteAnalyticsReader } from '../analytics/query-types.js';
import type { RouteCacheInspector } from '../cache/inspector.js';
import type { GoogleProviderDebugContext } from './google-provider.js';
import type { MatrixApiContext } from './matrix-context.js';
import type { RouteProviderCatalogContext } from './provider-catalog.js';

export interface RouteApiContext {
  jobs: RouteJobService;
  events: RouteJobEventBus;
  analytics?: RouteAnalyticsReader;
  cacheInspector?: RouteCacheInspector;
  googleProviderDebug?: GoogleProviderDebugContext;
  matrix?: MatrixApiContext;
  providerCatalog?: RouteProviderCatalogContext;
}

export function notFound(jobId: string) {
  return {
    error: {
      code: 'JOB_NOT_FOUND' as const,
      message: `Route job not found: ${jobId}`,
    },
  };
}
