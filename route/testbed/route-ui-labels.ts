import type {
  RouteJobStatus,
  RouteTravelMode,
} from '../../apps/testbed/src/api/client';

export const ROUTE_MODE_LABELS: Record<RouteTravelMode, string> = {
  DRIVING: '자동차',
  WALKING: '도보',
  BICYCLING: '자전거',
  TRANSIT: '대중교통',
};

export const ROUTE_JOB_STATUS_LABELS: Record<RouteJobStatus, string> = {
  queued: '대기 중',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

export function routeModeLabel(value: RouteTravelMode): string {
  return ROUTE_MODE_LABELS[value];
}

export function routeJobStatusLabel(value: RouteJobStatus): string {
  return ROUTE_JOB_STATUS_LABELS[value];
}
