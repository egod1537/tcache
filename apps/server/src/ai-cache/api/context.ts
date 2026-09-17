import type { AiJobEventBus } from '../jobs/ai-job-events.js';
import type { AiJobService } from '../jobs/ai-job-service.js';

export interface AiApiContext {
  jobs: AiJobService;
  events: AiJobEventBus;
}

export function notFound(jobId: string) {
  return {
    error: {
      code: 'JOB_NOT_FOUND' as const,
      message: `AI job not found: ${jobId}`,
    },
  };
}
