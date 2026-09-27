import type { ServiceStatus } from '@tcache/common';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  checkHealth,
  getRouteProviderDiagnostics,
  getServiceStatus,
  pingAiCache,
  pingRouteCache,
} from './client';
import type { RouteProviderDiagnostics } from './client';

export type CheckState = 'checking' | 'online' | 'offline';

export interface TcacheStatusState {
  server: CheckState;
  routeCache: CheckState;
  aiCache: CheckState;
  otp: CheckState;
  service: ServiceStatus | null;
  providerDiagnostics: RouteProviderDiagnostics | null;
  error: string | null;
  refreshing: boolean;
  lastCheckedAt: number | null;
  refresh: () => Promise<void>;
}

export function useTcacheStatus(): TcacheStatusState {
  const controllerRef = useRef<AbortController | null>(null);
  const [server, setServer] = useState<CheckState>('checking');
  const [routeCache, setRouteCache] = useState<CheckState>('checking');
  const [aiCache, setAiCache] = useState<CheckState>('checking');
  const [otp, setOtp] = useState<CheckState>('checking');
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [providerDiagnostics, setProviderDiagnostics] =
    useState<RouteProviderDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRefreshing(true);
    setServer('checking');
    setRouteCache('checking');
    setAiCache('checking');
    setOtp('checking');
    setError(null);

    const [
      healthResult,
      statusResult,
      routeResult,
      aiResult,
      diagnosticsResult,
    ] = await Promise.allSettled([
      checkHealth(controller.signal),
      getServiceStatus(controller.signal),
      pingRouteCache(controller.signal),
      pingAiCache(controller.signal),
      getRouteProviderDiagnostics(controller.signal),
    ]);

    if (controller.signal.aborted) return;

    setServer(healthResult.status === 'fulfilled' ? 'online' : 'offline');
    setRouteCache(routeResult.status === 'fulfilled' ? 'online' : 'offline');
    setAiCache(aiResult.status === 'fulfilled' ? 'online' : 'offline');
    const diagnostics =
      diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : null;
    const otpDiagnostics = diagnostics?.providers.find(
      (provider) => provider.provider === 'otp',
    );
    setOtp(
      otpDiagnostics?.configured && otpDiagnostics.reachable
        ? 'online'
        : 'offline',
    );
    setProviderDiagnostics(diagnostics);
    setService(statusResult.status === 'fulfilled' ? statusResult.value : null);
    if (healthResult.status === 'rejected') {
      setError(
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : 'Health check failed',
      );
    } else if (statusResult.status === 'rejected') {
      setError(
        statusResult.reason instanceof Error
          ? `Status endpoint: ${statusResult.reason.message}`
          : 'Status endpoint failed',
      );
    }
    setLastCheckedAt(Date.now());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  return {
    server,
    routeCache,
    aiCache,
    otp,
    service,
    providerDiagnostics,
    error,
    refreshing,
    lastCheckedAt,
    refresh,
  };
}
