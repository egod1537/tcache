import type { FastifyInstance } from 'fastify';

import type { RouteProviderRegistry } from '../resolver/provider-resolver.js';

export interface RouteProviderCatalogContext {
  registry: RouteProviderRegistry;
  overrideEnabled: boolean;
  rawProviderResponseEnabled: boolean;
}

export function registerRouteProviderCatalog(
  app: FastifyInstance,
  context: RouteProviderCatalogContext,
) {
  app.get('/providers', async () => ({
    providers: context.registry.list(),
    providerOverrideEnabled: context.overrideEnabled,
    rawProviderResponseEnabled: context.rawProviderResponseEnabled,
    fallbackPolicy: 'disabled',
  }));
  app.get('/providers/diagnostics', async () => ({
    providers: await context.registry.diagnostics(),
    coreHealthAffected: false,
  }));
}
