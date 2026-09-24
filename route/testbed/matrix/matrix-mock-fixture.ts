import type {
  CreateMatrixJobResponse,
  MatrixJobView,
  MatrixRequest,
  MatrixResult,
} from '../../../apps/testbed/src/api/client';

export const MATRIX_MOCK_REQUEST: MatrixRequest = {
  locations: [
    { id: 'A', address: 'Tokyo Station' },
    { id: 'B', address: 'Shibuya Station' },
    { id: 'C', address: 'Shinjuku Station' },
  ],
  mode: 'TRANSIT',
  departureTime: '2026-10-01T00:00:00.000Z',
  options: { languageCode: 'ja', regionCode: 'JP' },
};

export const MATRIX_MOCK_CREATE_RESPONSE: CreateMatrixJobResponse = {
  jobId: 'route-matrix-fixture',
  status: 'queued',
  statusUrl: '/api/route/matrix/jobs/route-matrix-fixture',
  eventsUrl: '/api/route/matrix/jobs/route-matrix-fixture/events',
  resultUrl: '/api/route/matrix/jobs/route-matrix-fixture/result',
};

export const MATRIX_MOCK_RUNNING_JOB: MatrixJobView = {
  jobId: MATRIX_MOCK_CREATE_RESPONSE.jobId,
  status: 'running',
  stage: 'resolving_routes',
  progress: 50,
  message: 'Resolving route 3 / 6',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.300Z',
  request: MATRIX_MOCK_REQUEST,
  stats: {
    totalPairs: 6,
    completedPairs: 3,
    cacheHits: 2,
    cacheMisses: 1,
    providerCalls: 1,
  },
};

export const MATRIX_MOCK_COMPLETED_JOB: MatrixJobView = {
  ...MATRIX_MOCK_RUNNING_JOB,
  status: 'completed',
  stage: 'completed',
  progress: 100,
  message: 'Matrix job completed',
  updatedAt: '2026-10-01T00:00:00.700Z',
  completedAt: '2026-10-01T00:00:00.700Z',
  stats: {
    totalPairs: 6,
    completedPairs: 6,
    cacheHits: 3,
    cacheMisses: 3,
    providerCalls: 3,
  },
};

export const MATRIX_MOCK_RESULT: MatrixResult = {
  jobId: MATRIX_MOCK_CREATE_RESPONSE.jobId,
  locations: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  durationSeconds: [
    [0, 540, 930],
    [510, 0, 620],
    [900, 600, 0],
  ],
  metadata: {
    mode: 'TRANSIT',
    departureTime: MATRIX_MOCK_REQUEST.departureTime,
    totalPairs: 6,
    cacheHits: 3,
    cacheMisses: 3,
    providerCalls: 3,
  },
};
