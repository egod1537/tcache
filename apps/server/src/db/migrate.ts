import { loadConfig } from '../config.js';
import { closeDatabasePool, createDatabasePool } from './client.js';
import { runMigrations } from './migrations.js';

const config = loadConfig();
const database = createDatabasePool(config.databaseUrl);

if (!database) {
  throw new Error('DATABASE_URL is required to run migrations');
}

try {
  const result = await runMigrations(database);
  process.stdout.write(
    `Migrations complete: ${result.applied.length} applied, ${result.alreadyApplied.length} already applied\n`,
  );
} finally {
  await closeDatabasePool(database);
}
