import {
  NORMALIZED_SCHEMA_VERSION,
  createDatasetMetadata,
  createLineId,
  createStationId,
  createTripId,
  parseServiceDayTime,
  type NormalizedTimetable,
} from '../common/index.js';

export const SOURCE_HASH = 'a'.repeat(64);
export const SOURCE_URL = 'https://example.invalid/jr-east/timetable/123';

export function makeValidDataset(): NormalizedTimetable {
  const operator = 'jr-east';
  const lineId = createLineId(operator, 'yamanote');
  const originStationId = createStationId(operator, 'tokyo');
  const destinationStationId = createStationId(operator, 'kanda');
  const firstDeparture = parseServiceDayTime('23:58');
  const sourceReference = {
    artifactSha256: SOURCE_HASH,
    sourceUrl: SOURCE_URL,
    sourceType: 'station-timetable-html',
    sourceEdition: '2026-09',
    sourceUrlKey: '123',
  };

  return {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    metadata: createDatasetMetadata(
      {
        operator,
        timetableEdition: '2026-09',
        sourceArtifactHashes: [SOURCE_HASH],
        parserVersion: 'jr-east-parser/0.1.0',
      },
      '2026-09-27T12:00:00+09:00',
    ),
    operators: [{ id: operator, nameJa: '東日本旅客鉄道', nameEn: 'JR East' }],
    lines: [
      {
        id: lineId,
        operatorId: operator,
        nameJa: '山手線',
        nameEn: 'Yamanote Line',
      },
    ],
    stations: [
      {
        id: originStationId,
        operatorId: operator,
        nameJa: '東京',
        nameEn: 'Tokyo',
      },
      {
        id: destinationStationId,
        operatorId: operator,
        nameJa: '神田',
        nameEn: 'Kanda',
      },
    ],
    serviceCalendars: [
      {
        id: 'jr-east:weekday',
        startDate: '2026-09-01',
        endDate: '2027-03-31',
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
        exceptions: [],
      },
    ],
    trips: [
      {
        internalTripId: createTripId({
          operator,
          edition: '2026-09',
          line: 'yamanote',
          direction: 'clockwise',
          trainNumber: '2301G',
          origin: 'tokyo',
          firstDeparture,
          variant: '0',
        }),
        operator,
        lineId,
        direction: 'clockwise',
        trainNumber: '2301G',
        trainType: 'local',
        originStationId,
        destinationStationId,
        serviceId: 'jr-east:weekday',
        sourceEdition: '2026-09',
        sourceUrl: SOURCE_URL,
        sourceReference,
        stopTimes: [
          {
            stationId: originStationId,
            sequence: 0,
            departure: firstDeparture,
            passThrough: false,
          },
          {
            stationId: destinationStationId,
            sequence: 1,
            arrival: parseServiceDayTime('24:01'),
            passThrough: false,
          },
        ],
      },
    ],
  };
}
