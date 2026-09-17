import { describe, expect, it, vi } from 'vitest';

import type { DatabaseQueryable } from './client.js';
import { PostgresHealthMonitor } from './health.js';

describe('PostgresHealthMonitor', () => {
  it('runs SELECT 1 on refresh and serves cached status reads', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    } as unknown as DatabaseQueryable;
    const monitor = new PostgresHealthMonitor(database, {
      refreshIntervalMs: 60_000,
    });

    expect(await monitor.start()).toBe('ok');
    expect(monitor.getStatus()).toBe('ok');
    expect(monitor.getStatus()).toBe('ok');
    expect(database.query).toHaveBeenCalledOnce();
    expect(database.query).toHaveBeenCalledWith('SELECT 1');
    monitor.stop();
  });

  it('reports error when PostgreSQL is unavailable or unconfigured', async () => {
    const database = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as DatabaseQueryable;
    const unavailable = new PostgresHealthMonitor(database);
    const unconfigured = new PostgresHealthMonitor(null);

    expect(await unavailable.start()).toBe('error');
    expect(await unconfigured.start()).toBe('error');
    unavailable.stop();
  });
});
