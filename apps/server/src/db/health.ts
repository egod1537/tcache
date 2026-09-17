import type { DatabaseQueryable } from './client.js';

export type PostgresStatus = 'ok' | 'error';

export interface PostgresHealthMonitorOptions {
  refreshIntervalMs?: number;
}

export class PostgresHealthMonitor {
  private readonly refreshIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private status: PostgresStatus = 'error';
  private refreshing = false;

  constructor(
    private readonly database: DatabaseQueryable | null,
    options: PostgresHealthMonitorOptions = {},
  ) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? 30_000;
    this.database?.on?.('error', () => {
      this.status = 'error';
    });
  }

  async start(): Promise<PostgresStatus> {
    await this.refresh();
    if (this.database && !this.timer) {
      this.timer = setInterval(
        () => void this.refresh(),
        this.refreshIntervalMs,
      );
      this.timer.unref();
    }
    return this.status;
  }

  getStatus(): PostgresStatus {
    return this.status;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    if (!this.database || this.refreshing) return;
    this.refreshing = true;
    try {
      await this.database.query('SELECT 1');
      this.status = 'ok';
    } catch {
      this.status = 'error';
    } finally {
      this.refreshing = false;
    }
  }
}
