import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export function createRedisClient(url: string): RedisClient {
  return createClient({
    url,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 2_000),
    },
  });
}

export async function getRedisStatus(
  client: RedisClient,
): Promise<'ok' | 'error'> {
  if (!client.isReady) {
    return 'error';
  }

  try {
    return (await client.ping()) === 'PONG' ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
