import type { FastifyInstance } from 'fastify';

import type { RouteProviderRegistry } from '../resolver/provider-resolver.js';
import type {
  RouteProviderPolicy,
  RouteProviderPolicySource,
} from '../resolver/provider-policy.js';
import type { RouteProviderName } from '../providers/provider.js';

export interface RouteProviderCatalogContext {
  registry: RouteProviderRegistry;
  routeProviderMode: 'auto' | RouteProviderName;
  policy: RouteProviderPolicy;
  policySource: RouteProviderPolicySource;
  legacyCountryModes: string[];
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
  app.get('/providers/policy', async () => ({
    routeProviderMode: context.routeProviderMode,
    policy: context.policy,
    policySource: context.policySource,
    legacyCompatibilityApplied: context.legacyCountryModes.length > 0,
    providerOverrideEnabled: context.overrideEnabled,
    assignments: buildPolicyAssignments(context),
  }));
}

function buildPolicyAssignments(context: RouteProviderCatalogContext) {
  if (context.routeProviderMode !== 'auto') {
    return [
      assignment(context, {
        countryCode: null,
        mode: null,
        provider: context.routeProviderMode,
        source: 'global-force',
      }),
    ];
  }
  const assignments: Array<{
    countryCode: string | null;
    mode: string | null;
    provider: RouteProviderName;
    source: string;
  }> = [];
  for (const [countryCode, country] of Object.entries(
    context.policy.countries,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    for (const [mode, provider] of Object.entries(country.modes ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      if (!provider) continue;
      assignments.push({
        countryCode,
        mode,
        provider,
        source: context.legacyCountryModes.includes(`${countryCode}:${mode}`)
          ? 'legacy'
          : 'country-mode',
      });
    }
    if (country.defaultProvider) {
      assignments.push({
        countryCode,
        mode: null,
        provider: country.defaultProvider,
        source: 'country-default',
      });
    }
  }
  for (const [mode, provider] of Object.entries(
    context.policy.modeDefaults ?? {},
  ).sort(([left], [right]) => left.localeCompare(right))) {
    if (provider) {
      assignments.push({
        countryCode: null,
        mode,
        provider,
        source: 'mode-default',
      });
    }
  }
  if (context.policy.defaultProvider) {
    assignments.push({
      countryCode: null,
      mode: null,
      provider: context.policy.defaultProvider,
      source: 'global-default',
    });
  }
  return assignments.map((value) => assignment(context, value));
}

function assignment(
  context: RouteProviderCatalogContext,
  value: {
    countryCode: string | null;
    mode: string | null;
    provider: RouteProviderName;
    source: string;
  },
) {
  const provider = context.registry.get(value.provider);
  return {
    ...value,
    available: Boolean(provider && provider.available !== false),
    ...(!provider
      ? { unavailableReason: 'Provider is not registered' }
      : provider.unavailableReason
        ? { unavailableReason: provider.unavailableReason }
        : {}),
  };
}
