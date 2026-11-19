import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AiApiContext } from './context.js';

const cookieName = 'tcache_ai_session';

function ownerFor(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readSessionOwner(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie?.match(
    /(?:^|;\s*)tcache_ai_session=([A-Za-z0-9_-]{43})(?:;|$)/,
  );
  const token = cookie?.[1];
  return token ? ownerFor(token) : undefined;
}

export function getOrCreateSessionOwner(
  request: FastifyRequest,
  reply: FastifyReply,
): string {
  const owner = readSessionOwner(request);
  if (owner) return owner;

  const token = randomBytes(32).toString('base64url');
  const secure = request.protocol === 'https' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${cookieName}=${token}; Path=/api/ai/jobs; HttpOnly; SameSite=Strict${secure}`,
  );
  return ownerFor(token);
}

export async function getOwnedJob(
  context: AiApiContext,
  request: FastifyRequest,
  jobId: string,
) {
  const owner = readSessionOwner(request);
  if (!owner) return null;
  const job = await context.jobs.get(jobId);
  return job?.sessionOwner === owner ? job : null;
}
