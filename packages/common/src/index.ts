export type CacheSystem = 'route-cache' | 'ai-cache';

export interface PingResponse {
  system: CacheSystem;
  status: 'ok';
}

export interface ServiceStatus {
  status: 'ok';
  service: 'tcache';
  version: string;
  environment: string;
  uptime: number;
  redis: 'ok' | 'error';
  postgres: 'ok' | 'error';
}
