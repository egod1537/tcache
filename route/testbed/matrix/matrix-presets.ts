import type { RouteLocationDraft } from '../route/playground-types';
import { GENERATED_PLACE_FIXTURE_CITIES } from './place-fixtures.generated';

export interface MatrixPresetLocation {
  id: string;
  name?: string;
  location: RouteLocationDraft;
}

export interface MatrixPreset {
  id: string;
  label: string;
  locations: MatrixPresetLocation[];
  languageCode: string;
  regionCode: string;
  timezone?: string;
  verifiedAt?: string;
}

const placeId = (value: string): RouteLocationDraft => ({
  type: 'placeId',
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  placeId: value,
  kakaoPlaceId: '',
  navitimeId: '',
  ekispertId: '',
});

const coordinates = (
  latitude: number,
  longitude: number,
): RouteLocationDraft => ({
  type: 'coordinates',
  name: '',
  address: '',
  latitude: String(latitude),
  longitude: String(longitude),
  placeId: '',
  kakaoPlaceId: '',
  navitimeId: '',
  ekispertId: '',
});

const placeFixturePresets: MatrixPreset[] =
  GENERATED_PLACE_FIXTURE_CITIES.flatMap((city) =>
    [3, 5, 10].map((size) => ({
      id: `${city.id}-${size}`,
      label: `${city.name} ${size} Places`,
      languageCode: city.languageCode,
      regionCode: city.regionCode,
      timezone: city.timezone,
      verifiedAt: city.verifiedAt,
      locations: city.locations.slice(0, size).map((location) => ({
        id: location.id,
        name: location.name,
        location: placeId(location.placeId),
      })),
    })),
  );

export const MATRIX_PRESETS: MatrixPreset[] = [
  ...placeFixturePresets,
  {
    id: 'coordinates',
    label: 'Coordinates Example',
    languageCode: 'ja',
    regionCode: 'JP',
    locations: [
      { id: 'A', location: coordinates(35.681236, 139.767125) },
      { id: 'B', location: coordinates(35.658034, 139.701636) },
      { id: 'C', location: coordinates(35.689592, 139.700413) },
    ],
  },
  {
    id: 'empty',
    label: 'Empty',
    languageCode: '',
    regionCode: '',
    locations: [],
  },
];

export function getMatrixPreset(id: string) {
  return (
    MATRIX_PRESETS.find((preset) => preset.id === id) ?? MATRIX_PRESETS[0]!
  );
}
