import type { FastifyInstance } from 'fastify';

import type { RouteProvider } from '../providers/provider.js';
import { validateRouteRequestForProvider } from '../providers/location-validation.js';
import { GoogleRoutesError } from '../providers/google/errors.js';
import { normalizePublicRouteRequest } from '../types/route.js';

export interface GoogleProviderDebugContext {
  provider: RouteProvider;
  timeoutMs: number;
  exposeRawProviderResponse: boolean;
}

export function registerGoogleProviderDebug(
  app: FastifyInstance,
  context: GoogleProviderDebugContext,
) {
  app.post<{ Body: unknown }>(
    '/provider/google/compute',
    async (request, reply) => {
      let normalizedRequest;
      try {
        normalizedRequest = normalizePublicRouteRequest(request.body);
        validateRouteRequestForProvider(normalizedRequest, 'google');
      } catch (error) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_ROUTE_REQUEST',
            message:
              error instanceof Error ? error.message : 'Invalid route request',
          },
        });
      }

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('Google Routes provider timed out'));
      }, context.timeoutMs);
      const abort = () =>
        controller.abort(new Error('Provider debug request was aborted'));
      request.raw.once('aborted', abort);

      try {
        const providerResult = await context.provider.getRoute(
          normalizedRequest,
          controller.signal,
        );
        return {
          provider: providerResult.provider,
          normalizedRequest,
          result: context.exposeRawProviderResponse
            ? providerResult.result
            : withoutProviderDebug(providerResult.result),
        };
      } catch (error) {
        if (timedOut) {
          return reply.code(504).send({
            error: {
              code: 'ROUTE_PROVIDER_TIMEOUT',
              message: `Google Routes provider exceeded ${context.timeoutMs}ms timeout`,
            },
          });
        }
        if (error instanceof GoogleRoutesError) {
          return reply.code(502).send({
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          });
        }
        return reply.code(502).send({
          error: {
            code: 'ROUTE_PROVIDER_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Google Routes provider failed',
          },
        });
      } finally {
        clearTimeout(timeout);
        request.raw.off('aborted', abort);
      }
    },
  );
}

function withoutProviderDebug(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const result = { ...(value as Record<string, unknown>) };
  delete result.raw;
  delete result.debug;
  return result;
}
