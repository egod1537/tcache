import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createRedisClient, getRedisStatus } from './redis/client.js';

const config = loadConfig();
const redis = createRedisClient(config.redisUrl);

const app = buildApp({
  environment: config.nodeEnv,
  version: config.gitCommitSha,
  getRedisStatus: () => getRedisStatus(redis),
  logger: true,
});

redis.on('error', (error) => {
  app.log.error({ error }, 'Redis connection error');
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  await app.close();

  if (redis.isOpen) {
    await redis.quit();
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await redis.connect();
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
