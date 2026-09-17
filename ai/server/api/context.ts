import type { AiJobEventBus } from '../jobs/ai-job-events.js';
import type { AiJobService } from '../jobs/ai-job-service.js';
import type { OpenWebUIModelService } from '../providers/openwebui/models.js';
import type { AiRequestDefaults } from '../types/ai.js';

export interface AiApiContext {
  jobs: AiJobService;
  events: AiJobEventBus;
  requestDefaults?: AiRequestDefaults;
  openWebUIModels?: OpenWebUIModelService;
}

export function notFound(jobId: string) {
  return {
    error: {
      code: 'JOB_NOT_FOUND' as const,
      message: `AI job not found: ${jobId}`,
    },
  };
}
