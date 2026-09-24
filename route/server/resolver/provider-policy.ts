import {
  ROUTE_PROVIDER_NAMES,
  type RouteProviderName,
} from '../providers/provider.js';
import { ROUTE_TRAVEL_MODES, type RouteTravelMode } from '../types/route.js';

export interface RouteCountryProviderPolicy {
  modes?: Partial<Record<RouteTravelMode, RouteProviderName>>;
  defaultProvider?: RouteProviderName;
}

export interface RouteProviderPolicy {
  countries: Record<string, RouteCountryProviderPolicy>;
  modeDefaults?: Partial<Record<RouteTravelMode, RouteProviderName>>;
  defaultProvider?: RouteProviderName;
}

export type RouteProviderPolicySource = 'built-in' | 'env-json';

export interface LoadedRouteProviderPolicy {
  policy: RouteProviderPolicy;
  source: RouteProviderPolicySource;
  legacyCountryModes: string[];
}

export const BUILT_IN_ROUTE_PROVIDER_POLICY: RouteProviderPolicy = {
  countries: {
    JP: {
      modes: {
        DRIVING: 'google',
        WALKING: 'google',
        BICYCLING: 'google',
        TRANSIT: 'ekispert',
      },
    },
    KR: {
      modes: {
        DRIVING: 'kakao-mobility',
        WALKING: 'kakao-maps',
        BICYCLING: 'kakao-maps',
        TRANSIT: 'kakao-maps',
      },
    },
  },
  modeDefaults: {
    DRIVING: 'google',
    WALKING: 'google',
    BICYCLING: 'google',
    TRANSIT: 'google',
  },
  defaultProvider: 'google',
};

export function loadRouteProviderPolicy(
  json: string | undefined,
  legacyJapanTransitProvider: RouteProviderName,
  legacyWasExplicitlyConfigured: boolean,
): LoadedRouteProviderPolicy {
  const serialized = json?.trim();
  if (!serialized) {
    const policy = clonePolicy(BUILT_IN_ROUTE_PROVIDER_POLICY);
    const legacyCountryModes: string[] = [];
    if (legacyWasExplicitlyConfigured) {
      policy.countries.JP!.modes!.TRANSIT = legacyJapanTransitProvider;
      legacyCountryModes.push(countryModeKey('JP', 'TRANSIT'));
    }
    return { policy, source: 'built-in', legacyCountryModes };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('Invalid ROUTE_PROVIDER_POLICY_JSON: malformed JSON');
  }
  const policy = parsePolicy(parsed);
  const legacyCountryModes: string[] = [];
  if (!policy.countries.JP?.modes?.TRANSIT) {
    policy.countries.JP ??= {};
    policy.countries.JP.modes ??= {};
    policy.countries.JP.modes.TRANSIT = legacyJapanTransitProvider;
    legacyCountryModes.push(countryModeKey('JP', 'TRANSIT'));
  }
  return { policy, source: 'env-json', legacyCountryModes };
}

export function countryModeKey(countryCode: string, mode: RouteTravelMode) {
  return `${countryCode}:${mode}`;
}

function parsePolicy(value: unknown): RouteProviderPolicy {
  const input = expectObject(value, 'ROUTE_PROVIDER_POLICY_JSON');
  rejectUnknownKeys(input, ['countries', 'modeDefaults', 'defaultProvider']);
  const countriesInput = expectObject(
    input.countries,
    'ROUTE_PROVIDER_POLICY_JSON.countries',
  );
  const countries: Record<string, RouteCountryProviderPolicy> = {};
  for (const [rawCountryCode, rawCountryPolicy] of Object.entries(
    countriesInput,
  )) {
    const countryCode = normalizeCountryCode(rawCountryCode);
    if (countries[countryCode]) {
      throw new Error(
        `Invalid ROUTE_PROVIDER_POLICY_JSON: duplicate country ${countryCode}`,
      );
    }
    const countryPolicy = expectObject(
      rawCountryPolicy,
      `ROUTE_PROVIDER_POLICY_JSON.countries.${rawCountryCode}`,
    );
    rejectUnknownKeys(countryPolicy, ['modes', 'defaultProvider']);
    const modes =
      countryPolicy.modes === undefined
        ? undefined
        : parseModeMap(
            countryPolicy.modes,
            `ROUTE_PROVIDER_POLICY_JSON.countries.${countryCode}.modes`,
          );
    const defaultProvider =
      countryPolicy.defaultProvider === undefined
        ? undefined
        : normalizeProvider(
            countryPolicy.defaultProvider,
            `ROUTE_PROVIDER_POLICY_JSON.countries.${countryCode}.defaultProvider`,
          );
    countries[countryCode] = {
      ...(modes ? { modes } : {}),
      ...(defaultProvider ? { defaultProvider } : {}),
    };
  }

  const modeDefaults =
    input.modeDefaults === undefined
      ? undefined
      : parseModeMap(
          input.modeDefaults,
          'ROUTE_PROVIDER_POLICY_JSON.modeDefaults',
        );
  const defaultProvider =
    input.defaultProvider === undefined
      ? undefined
      : normalizeProvider(
          input.defaultProvider,
          'ROUTE_PROVIDER_POLICY_JSON.defaultProvider',
        );
  return {
    countries,
    ...(modeDefaults ? { modeDefaults } : {}),
    ...(defaultProvider ? { defaultProvider } : {}),
  };
}

function parseModeMap(
  value: unknown,
  field: string,
): Partial<Record<RouteTravelMode, RouteProviderName>> {
  const input = expectObject(value, field);
  const result: Partial<Record<RouteTravelMode, RouteProviderName>> = {};
  for (const [rawMode, provider] of Object.entries(input)) {
    const mode = rawMode.trim().toUpperCase();
    if (!ROUTE_TRAVEL_MODES.includes(mode as RouteTravelMode)) {
      throw new Error(`Invalid ${field} mode: ${rawMode || '(empty)'}`);
    }
    if (result[mode as RouteTravelMode]) {
      throw new Error(`Invalid ${field}: duplicate mode ${mode}`);
    }
    result[mode as RouteTravelMode] = normalizeProvider(
      provider,
      `${field}.${rawMode}`,
    );
  }
  return result;
}

function normalizeCountryCode(value: string) {
  const countryCode = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode) || !isRecognizedRegion(countryCode)) {
    throw new Error(
      `Invalid ROUTE_PROVIDER_POLICY_JSON country: ${value || '(empty)'}`,
    );
  }
  return countryCode;
}

function isRecognizedRegion(countryCode: string) {
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(
    countryCode,
  );
  return Boolean(name && name !== countryCode && name !== 'Unknown Region');
}

function normalizeProvider(value: unknown, field: string): RouteProviderName {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${field}: provider must be a non-empty string`);
  }
  const provider = value.trim().toLowerCase();
  if (!ROUTE_PROVIDER_NAMES.includes(provider as RouteProviderName)) {
    throw new Error(`Invalid ${field} provider: ${provider}`);
  }
  return provider as RouteProviderName;
}

function expectObject(value: unknown, field: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new Error(
      `Invalid ROUTE_PROVIDER_POLICY_JSON: unknown key ${unknown}`,
    );
  }
}

function clonePolicy(policy: RouteProviderPolicy): RouteProviderPolicy {
  return structuredClone(policy);
}
