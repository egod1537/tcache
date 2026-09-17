import type { RouteJobEventBus } from '../jobs/route-job-events.js';
import type { RouteJobService } from '../jobs/route-job-service.js';

export interface RouteApiContext {
  jobs: RouteJobService;
  events: RouteJobEventBus;
}

export function notFound(jobId: string) {
  return {
    error: {
      code: 'JOB_NOT_FOUND' as const,
      message: `Route job not found: ${jobId}`,
    },
  };
}
