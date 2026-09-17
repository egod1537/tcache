import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

export interface DatabaseQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  on?(event: 'error', listener: () => void): unknown;
}

export type DatabasePool = Pool;

export interface CreateDatabasePoolOptions {
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export function createDatabasePool(
  databaseUrl: string,
  options: CreateDatabasePoolOptions = {},
): DatabasePool | null {
  if (!databaseUrl) return null;
  const config: PoolConfig = {
    connectionString: databaseUrl,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
  };
  return new Pool(config);
}

export async function closeDatabasePool(
  pool: DatabasePool | null,
): Promise<void> {
  await pool?.end();
}
