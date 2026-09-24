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
import { registerCreateMatrixJob } from './api/create-matrix-job.js';
import { registerGetMatrixJob } from './api/get-matrix-job.js';
import { registerGetMatrixResult } from './api/get-matrix-result.js';
import { registerCancelMatrixJob } from './api/cancel-matrix-job.js';
import { registerMatrixEvents } from './api/matrix-events.js';
import { registerRouteProviderCatalog } from './api/provider-catalog.js';

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
  if (options.context.providerCatalog) {
    registerRouteProviderCatalog(app, options.context.providerCatalog);
  }
  if (options.context.matrix) {
    registerCreateMatrixJob(app, options.context.matrix);
    registerGetMatrixJob(app, options.context.matrix);
    registerGetMatrixResult(app, options.context.matrix);
    registerMatrixEvents(app, options.context.matrix);
    registerCancelMatrixJob(app, options.context.matrix);
  }
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
