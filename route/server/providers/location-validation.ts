import type { NormalizedRouteRequest, RouteLocation } from '../types/route.js';

export class RouteLocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteLocationValidationError';
  }
}

/** Validates only provider-specific routing requirements at the adapter boundary. */
export function validateRouteRequestForProvider(
  request: NormalizedRouteRequest,
  providerName: string,
): void {
  const provider = providerName.trim().toLowerCase();
  if (
    ![
      'google',
      'kakao',
      'kakao-mobility',
      'kakao-maps',
      'navitime',
      'ekispert',
      'otp',
    ].includes(provider)
  )
    return;

  const locations = [
    ['origin', request.origin],
    ...request.intermediates.map(
      (location, index) => [`intermediates[${index}]`, location] as const,
    ),
    ['destination', request.destination],
  ] as const;
  for (const [field, location] of locations) {
    validateLocationForProvider(location, provider, field);
  }
}

function validateLocationForProvider(
  location: RouteLocation,
  provider: string,
  field: string,
) {
  if (provider === 'google') {
    if (
      location.externalIds?.googlePlaceId ||
      location.coordinates ||
      location.address
    ) {
      return;
    }
    throw unsupported(
      field,
      provider,
      'googlePlaceId, coordinates, or address',
    );
  }
  if (provider === 'kakao' || provider === 'kakao-maps') {
    if (location.coordinates) return;
    throw unsupported(field, provider, 'coordinates');
  }
  if (provider === 'kakao-mobility') {
    if (location.coordinates) return;
    throw unsupported(field, provider, 'coordinates');
  }
  if (provider === 'otp') {
    if (location.coordinates) return;
    throw unsupported(field, provider, 'coordinates');
  }
  if (provider === 'ekispert') {
    if (
      location.externalIds?.ekispertId ||
      location.coordinates ||
      location.address ||
      location.name
    ) {
      return;
    }
    throw unsupported(
      field,
      provider,
      'ekispertId, coordinates, address, or name',
    );
  }
  if (location.coordinates || location.externalIds?.navitimeId) return;
  throw unsupported(field, provider, 'coordinates or navitimeId');
}

function unsupported(field: string, provider: string, accepted: string) {
  const verb = accepted === 'coordinates' ? 'are' : 'is';
  return new RouteLocationValidationError(
    `${field} cannot be used with ${provider}: ${accepted} ${verb} required`,
  );
}
