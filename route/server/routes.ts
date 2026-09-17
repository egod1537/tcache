import type { PingResponse } from '@tcache/common';
import type { FastifyPluginAsync } from 'fastify';

import { registerCancelJob } from './api/cancel-job.js';
import { registerRouteAnalytics } from './api/analytics.js';
import { registerRouteCacheExplorer } from './api/cache-explorer.js';
import type { RouteApiContext } from './api/context.js';
import { registerCreateJob } from './api/create-job.js';
import { registerJobEvents } from './api/events.js';
import { registerGetJob } from './api/get-job.js';
import { registerGetResult } from './api/get-result.js';
import { registerGoogleProviderDebug } from './api/google-provider.js';

export interface RouteCacheRoutesOptions {
  context?: RouteApiContext;
}

export const routeCacheRoutes: FastifyPluginAsync<
  RouteCacheRoutesOptions
> = async (app, options) => {
  app.get<{ Reply: PingResponse }>('/ping', async () => ({
    system: 'route-cache',
    status: 'ok',
  }));

  if (!options.context) return;
  registerCreateJob(app, options.context);
  registerGetJob(app, options.context);
  registerGetResult(app, options.context);
  registerJobEvents(app, options.context);
  registerCancelJob(app, options.context);
  if (options.context.analytics) {
    registerRouteAnalytics(app, options.context.analytics);
  }
  if (options.context.cacheInspector) {
    registerRouteCacheExplorer(app, options.context.cacheInspector);
  }
  if (options.context.googleProviderDebug) {
    registerGoogleProviderDebug(app, options.context.googleProviderDebug);
  }
};
