import type { MatrixJobEventBus } from '../matrix/matrix-job-events.js';
import type { MatrixJobService } from '../matrix/matrix-job-service.js';

export interface MatrixApiContext {
  jobs: MatrixJobService;
  events: MatrixJobEventBus;
}

export function matrixNotFound(jobId: string) {
  return {
    error: {
      code: 'JOB_NOT_FOUND' as const,
      message: `Matrix job not found: ${jobId}`,
    },
  };
}
