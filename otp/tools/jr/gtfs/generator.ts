import {
  formatServiceDayTime,
  hashCanonicalJson,
  serviceDaySeconds,
  sha256Text,
  validateNormalizedTimetable,
  validateStationMapping,
  type NormalizedTimetable,
  type ServiceDayTime,
  type StationMappingSet,
} from '../common/index.js';
import { encodeCsv } from './csv.js';
import {
  REQUIRED_GTFS_FILES,
  GtfsGenerationError,
  type GeneratedGtfsFeed,
  type GtfsGenerationIssue,
  type GtfsGeneratorConfig,
  type RequiredGtfsFile,
} from './model.js';

type CsvRow = Readonly<Record<string, string | number | undefined>>;

export function generateGtfsFeed(input: {
  dataset: NormalizedTimetable;
  stationMappingSet: StationMappingSet;
  config: GtfsGeneratorConfig;
}): GeneratedGtfsFeed {
  const { dataset, stationMappingSet, config } = input;
  const issues: GtfsGenerationIssue[] = validateInputs(input);
  if (issues.length > 0) throw new GtfsGenerationError(issues);

  const stationsById = new Map(
    dataset.stations.map((station) => [station.id, station]),
  );
  const mappingsById = new Map(
    stationMappingSet.mappings.map((mapping) => [
      mapping.internalStationId,
      mapping,
    ]),
  );
  const usedStationIds = new Set(
    dataset.trips.flatMap((trip) =>
      trip.stopTimes.map((stopTime) => stopTime.stationId),
    ),
  );
  const usedLineIds = new Set(dataset.trips.map((trip) => trip.lineId));
  const usedOperatorIds = new Set(dataset.trips.map((trip) => trip.operator));

  const agencies: CsvRow[] = [...usedOperatorIds].sort().map((operatorId) => {
    const agency = config.agencies[operatorId]!;
    return {
      agency_id: agency.agencyId,
      agency_name: agency.agencyName,
      agency_url: agency.agencyUrl,
      agency_timezone: agency.agencyTimezone,
      agency_lang: agency.agencyLang,
    };
  });

  const stops: CsvRow[] = [...usedStationIds].sort().map((stationId) => {
    const station = stationsById.get(stationId)!;
    const mapping = mappingsById.get(stationId)!;
    return {
      stop_id: station.id,
      stop_code: mapping.stationNumber ?? station.stationNumber,
      stop_name: station.nameJa,
      stop_lat: coordinate(mapping.latitude!),
      stop_lon: coordinate(mapping.longitude!),
      location_type: 0,
    };
  });

  const routes: CsvRow[] = [...usedLineIds].sort().map((lineId) => {
    const line = dataset.lines.find((candidate) => candidate.id === lineId)!;
    const route = config.routes[lineId]!;
    return {
      route_id: line.id,
      agency_id: config.agencies[line.operatorId]!.agencyId,
      route_short_name: route.routeShortName ?? '',
      route_long_name: route.routeLongName ?? line.nameEn ?? line.nameJa,
      route_type: route.routeType,
      route_color: route.routeColor,
      route_text_color: route.routeTextColor,
    };
  });

  const trips: CsvRow[] = [...dataset.trips]
    .sort((left, right) =>
      left.internalTripId.localeCompare(right.internalTripId),
    )
    .map((trip) => {
      const destination = stationsById.get(trip.destinationStationId)!;
      const directionLabel = config.directionLabels?.[trip.direction];
      const headsign = directionLabel
        ? `${destination.nameJa}（${directionLabel}）`
        : destination.nameJa;
      return {
        route_id: trip.lineId,
        service_id: trip.serviceId,
        trip_id: trip.internalTripId,
        trip_headsign: headsign,
        trip_short_name: trip.trainNumber,
        direction_id: config.directionIds[trip.direction]!,
      };
    });

  const stopTimes: CsvRow[] = [];
  for (const trip of [...dataset.trips].sort((left, right) =>
    left.internalTripId.localeCompare(right.internalTripId),
  )) {
    for (const [index, stop] of trip.stopTimes.entries()) {
      const arrival = stop.arrival ?? stop.departure;
      const departure = stop.departure ?? stop.arrival;
      stopTimes.push({
        trip_id: trip.internalTripId,
        arrival_time: arrival ? formatServiceDayTime(arrival) : '',
        departure_time: departure ? formatServiceDayTime(departure) : '',
        stop_id: stop.stationId,
        stop_sequence: index + 1,
      });
    }
  }

  const calendars: CsvRow[] = [...dataset.serviceCalendars]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((calendar) => ({
      service_id: calendar.id,
      monday: binary(calendar.monday),
      tuesday: binary(calendar.tuesday),
      wednesday: binary(calendar.wednesday),
      thursday: binary(calendar.thursday),
      friday: binary(calendar.friday),
      saturday: binary(calendar.saturday),
      sunday: binary(calendar.sunday),
      start_date: gtfsDate(calendar.startDate),
      end_date: gtfsDate(calendar.endDate),
    }));
  const calendarDates: CsvRow[] = dataset.serviceCalendars
    .flatMap((calendar) =>
      calendar.exceptions.map((exception) => ({
        service_id: calendar.id,
        date: gtfsDate(exception.date),
        exception_type: exception.serviceAdded ? 1 : 2,
      })),
    )
    .sort((left, right) =>
      `${left.service_id}:${left.date}`.localeCompare(
        `${right.service_id}:${right.date}`,
      ),
    );

  const startDate = dataset.serviceCalendars
    .map((calendar) => calendar.startDate)
    .sort()[0]!;
  const endDate = dataset.serviceCalendars
    .map((calendar) => calendar.endDate)
    .sort()
    .at(-1)!;
  const feedVersion = `${dataset.metadata.datasetVersion}+${config.generatorVersion}`;
  const feedInfo: CsvRow[] = [
    {
      feed_publisher_name: config.feed.publisherName,
      feed_publisher_url: config.feed.publisherUrl,
      feed_lang: config.feed.language,
      feed_start_date: gtfsDate(startDate),
      feed_end_date: gtfsDate(endDate),
      feed_version: feedVersion,
    },
  ];

  const files = new Map<RequiredGtfsFile, string>([
    [
      'agency.txt',
      encodeCsv(
        [
          'agency_id',
          'agency_name',
          'agency_url',
          'agency_timezone',
          'agency_lang',
        ],
        agencies,
      ),
    ],
    [
      'stops.txt',
      encodeCsv(
        [
          'stop_id',
          'stop_code',
          'stop_name',
          'stop_lat',
          'stop_lon',
          'location_type',
        ],
        stops,
      ),
    ],
    [
      'routes.txt',
      encodeCsv(
        [
          'route_id',
          'agency_id',
          'route_short_name',
          'route_long_name',
          'route_type',
          'route_color',
          'route_text_color',
        ],
        routes,
      ),
    ],
    [
      'trips.txt',
      encodeCsv(
        [
          'route_id',
          'service_id',
          'trip_id',
          'trip_headsign',
          'trip_short_name',
          'direction_id',
        ],
        trips,
      ),
    ],
    [
      'stop_times.txt',
      encodeCsv(
        [
          'trip_id',
          'arrival_time',
          'departure_time',
          'stop_id',
          'stop_sequence',
        ],
        stopTimes,
      ),
    ],
    [
      'calendar.txt',
      encodeCsv(
        [
          'service_id',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
          'start_date',
          'end_date',
        ],
        calendars,
      ),
    ],
    [
      'calendar_dates.txt',
      encodeCsv(['service_id', 'date', 'exception_type'], calendarDates),
    ],
    [
      'feed_info.txt',
      encodeCsv(
        [
          'feed_publisher_name',
          'feed_publisher_url',
          'feed_lang',
          'feed_start_date',
          'feed_end_date',
          'feed_version',
        ],
        feedInfo,
      ),
    ],
  ]);

  const postIssues = validateGeneratedStopTimes(dataset);
  if (postIssues.length > 0) throw new GtfsGenerationError(postIssues);
  const fileIdentities = REQUIRED_GTFS_FILES.map((name) => ({
    name,
    sha256: sha256Text(files.get(name)!),
  }));

  return {
    files,
    canonicalContentHash: hashCanonicalJson(fileIdentities),
    feedVersion,
    counts: {
      agencies: agencies.length,
      stops: stops.length,
      routes: routes.length,
      trips: trips.length,
      stopTimes: stopTimes.length,
      calendars: calendars.length,
      calendarDates: calendarDates.length,
    },
    unresolvedCalendarConditions: [
      ...new Set(
        dataset.serviceCalendars.flatMap(
          (calendar) => calendar.unresolvedCalendarConditions ?? [],
        ),
      ),
    ].sort(),
  };
}

function validateInputs(input: {
  dataset: NormalizedTimetable;
  stationMappingSet: StationMappingSet;
  config: GtfsGeneratorConfig;
}): GtfsGenerationIssue[] {
  const { dataset, stationMappingSet, config } = input;
  const issues: GtfsGenerationIssue[] = validateNormalizedTimetable(
    dataset,
  ).map((issue) => ({
    code: 'NORMALIZED_INVALID',
    path: issue.path,
    message: `${issue.code}: ${issue.message}`,
  }));
  const stationById = new Map(
    dataset.stations.map((station) => [station.id, station]),
  );
  const mappingsById = new Map<
    string,
    (typeof stationMappingSet.mappings)[number]
  >();
  stationMappingSet.mappings.forEach((mapping, index) => {
    if (mappingsById.has(mapping.internalStationId)) {
      issues.push({
        code: 'MAPPING_DUPLICATE',
        path: `mappings[${index}].internalStationId`,
        message: `Duplicate mapping for ${mapping.internalStationId}`,
      });
    }
    mappingsById.set(mapping.internalStationId, mapping);
    for (const issue of validateStationMapping(mapping)) {
      issues.push({
        code: 'MAPPING_INVALID',
        path: `mappings[${index}].${issue.path}`,
        message: issue.message,
      });
    }
  });

  const usedStationIds = new Set(
    dataset.trips.flatMap((trip) =>
      trip.stopTimes.map((stopTime) => stopTime.stationId),
    ),
  );
  for (const stationId of [...usedStationIds].sort()) {
    const mapping = mappingsById.get(stationId);
    const station = stationById.get(stationId)!;
    if (!mapping || mapping.mappingStatus !== 'confirmed') {
      issues.push({
        code: 'MAPPING_UNCONFIRMED',
        path: `stationMappings.${stationId}`,
        message: `Station ${stationId} requires a confirmed mapping`,
      });
      continue;
    }
    if (mapping.latitude === undefined || mapping.longitude === undefined) {
      issues.push({
        code: 'MAPPING_COORDINATES_MISSING',
        path: `stationMappings.${stationId}`,
        message: `Station ${stationId} has no confirmed coordinate pair`,
      });
    }
    if (
      mapping.operator !== station.operatorId ||
      mapping.officialNameJa !== station.nameJa
    ) {
      issues.push({
        code: 'MAPPING_STATION_MISMATCH',
        path: `stationMappings.${stationId}`,
        message: `Mapping identity does not match normalized station ${stationId}`,
      });
    }
  }
  for (const operatorId of new Set(
    dataset.trips.map((trip) => trip.operator),
  )) {
    if (!config.agencies[operatorId]) {
      issues.push({
        code: 'AGENCY_CONFIG_MISSING',
        path: `config.agencies.${operatorId}`,
        message: `No GTFS agency configuration for ${operatorId}`,
      });
    }
  }
  for (const lineId of new Set(dataset.trips.map((trip) => trip.lineId))) {
    if (!config.routes[lineId]) {
      issues.push({
        code: 'ROUTE_CONFIG_MISSING',
        path: `config.routes.${lineId}`,
        message: `No GTFS route configuration for ${lineId}`,
      });
    }
  }
  for (const direction of new Set(
    dataset.trips.map((trip) => trip.direction),
  )) {
    if (config.directionIds[direction] === undefined) {
      issues.push({
        code: 'DIRECTION_POLICY_MISSING',
        path: `config.directionIds.${direction}`,
        message: `No direction_id policy for ${direction}`,
      });
    }
  }
  dataset.trips.forEach((trip, tripIndex) => {
    trip.stopTimes.forEach((stop, stopIndex) => {
      if (!stop.arrival && !stop.departure) {
        issues.push({
          code: 'STOP_TIME_MISSING',
          path: `trips[${tripIndex}].stopTimes[${stopIndex}]`,
          message: `${trip.internalTripId} has no arrival or departure time`,
        });
      }
    });
  });
  return issues;
}

function validateGeneratedStopTimes(
  dataset: NormalizedTimetable,
): GtfsGenerationIssue[] {
  const issues: GtfsGenerationIssue[] = [];
  dataset.trips.forEach((trip, tripIndex) => {
    let previous: ServiceDayTime | undefined;
    trip.stopTimes.forEach((stop, stopIndex) => {
      const arrival = stop.arrival ?? stop.departure;
      const departure = stop.departure ?? stop.arrival;
      for (const event of [arrival, departure]) {
        if (
          event &&
          previous &&
          serviceDaySeconds(event) < serviceDaySeconds(previous)
        ) {
          issues.push({
            code: 'GTFS_TIME_REGRESSION',
            path: `trips[${tripIndex}].stopTimes[${stopIndex}]`,
            message: `GTFS time regresses in ${trip.internalTripId}`,
          });
        }
        if (event) previous = event;
      }
    });
  });
  return issues;
}

function binary(value: boolean): number {
  return value ? 1 : 0;
}

function gtfsDate(value: string): string {
  return value.replaceAll('-', '');
}

function coordinate(value: number): string {
  return value.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}
