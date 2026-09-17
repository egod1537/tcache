export interface AppConfig {
  nodeEnv: string;
  port: number;
  redisUrl: string;
  gitCommitSha: string;
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? '3200');

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TCACHE_PORT: ${value ?? ''}`);
  }

  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: readPort(env.TCACHE_PORT),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    gitCommitSha: env.GIT_COMMIT_SHA ?? 'dev',
  };
}
