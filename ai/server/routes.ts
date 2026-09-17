import type { PingResponse } from '@tcache/common';
import type { FastifyPluginAsync } from 'fastify';

import { registerCancelJob } from './api/cancel-job.js';
import type { AiApiContext } from './api/context.js';
import { registerCreateJob } from './api/create-job.js';
import { registerJobEvents } from './api/events.js';
import { registerGetJob } from './api/get-job.js';
import { registerGetResult } from './api/get-result.js';
import { registerOpenWebUIModels } from './api/openwebui-models.js';

export interface AiCacheRoutesOptions {
  context?: AiApiContext;
}

export const aiCacheRoutes: FastifyPluginAsync<AiCacheRoutesOptions> = async (
  app,
  options,
) => {
  app.get<{ Reply: PingResponse }>('/ping', async () => ({
    system: 'ai-cache',
    status: 'ok',
  }));

  if (!options.context) return;
  registerCreateJob(app, options.context);
  registerGetJob(app, options.context);
  registerGetResult(app, options.context);
  registerJobEvents(app, options.context);
  registerCancelJob(app, options.context);
  registerOpenWebUIModels(app, options.context);
};
