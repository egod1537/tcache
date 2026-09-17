import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';

import type { DatabasePool } from './client.js';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const DESTRUCTIVE_SQL = /\b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE)\b/i;
const MIGRATION_LOCK_ID = 1_927_226_459;

export interface AppliedMigration {
  version: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export interface RunMigrationsOptions {
  directory?: URL;
}

interface MigrationFile {
  version: string;
  checksum: string;
  sql: string;
}

export async function runMigrations(
  pool: DatabasePool,
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> {
  const directory =
    options.directory ?? new URL('./migrations/', import.meta.url);
  const migrations = await loadMigrationFiles(directory);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureMigrationTable(client);
    const applied = await readAppliedMigrations(client);
    const result: MigrationResult = { applied: [], alreadyApplied: [] };

    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.version);
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Applied migration checksum mismatch: ${migration.version}`,
          );
        }
        result.alreadyApplied.push(migration.version);
        continue;
      }

      rejectDestructiveSql(migration);
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations (version, checksum)
         VALUES ($1, $2)`,
        [migration.version, migration.checksum],
      );
      result.applied.push(migration.version);
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function loadMigrationFiles(directory: URL): Promise<MigrationFile[]> {
  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const versions = new Set<string>();
  return Promise.all(
    filenames.map(async (filename) => {
      const version = filename.slice(0, 4);
      if (versions.has(version)) {
        throw new Error(`Duplicate migration version: ${version}`);
      }
      versions.add(version);
      const sql = await readFile(new URL(filename, directory), 'utf8');
      return {
        version,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

async function ensureMigrationTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readAppliedMigrations(client: PoolClient) {
  const result = await client.query<AppliedMigration>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function rejectDestructiveSql(migration: MigrationFile) {
  if (DESTRUCTIVE_SQL.test(stripSqlComments(migration.sql))) {
    throw new Error(
      `Destructive SQL is not allowed in migration ${migration.version}`,
    );
  }
}

function stripSqlComments(sql: string) {
  return sql.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/--.*$/gm, '');
}

async function rollback(client: PoolClient) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original migration error.
  }
}
