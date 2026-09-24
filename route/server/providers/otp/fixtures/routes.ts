const walkLeg = {
  mode: 'WALK',
  transitLeg: false,
  duration: 300,
  distance: 320,
  start: { scheduledTime: '2026-09-25T10:00:00+09:00' },
  end: { scheduledTime: '2026-09-25T10:05:00+09:00' },
  from: { name: 'Tokyo Station', lat: 35.681236, lon: 139.767125, stop: null },
  to: {
    name: 'Otemachi',
    lat: 35.684,
    lon: 139.766,
    stop: { gtfsId: 'TOEI:OT', name: 'Otemachi', platformCode: null },
  },
  agency: null,
  route: null,
  headsign: null,
  legGeometry: { length: 3, points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
};

const trainLeg = {
  mode: 'SUBWAY',
  transitLeg: true,
  duration: 600,
  distance: 8_200,
  start: { scheduledTime: '2026-09-25T10:05:00+09:00' },
  end: { scheduledTime: '2026-09-25T10:15:00+09:00' },
  from: {
    name: 'Otemachi',
    lat: 35.684,
    lon: 139.766,
    stop: { gtfsId: 'TOEI:OT', name: 'Otemachi', platformCode: '1' },
  },
  to: {
    name: 'Shibuya',
    lat: 35.658034,
    lon: 139.701636,
    stop: { gtfsId: 'TOEI:SB', name: 'Shibuya', platformCode: '2' },
  },
  agency: { gtfsId: 'TOEI:toei', name: 'Tokyo Metropolitan Bureau' },
  route: { gtfsId: 'TOEI:Z', shortName: 'Z', longName: 'Hanzomon Line' },
  headsign: 'Shibuya',
  legGeometry: null,
};

const itinerary = {
  start: '2026-09-25T10:00:00+09:00',
  end: '2026-09-25T10:15:00+09:00',
  duration: 900,
  walkTime: 300,
  walkDistance: 320,
  numberOfTransfers: 0,
  legs: [walkLeg, trainLeg],
};

export const otpDirectRouteFixture = {
  data: {
    planConnection: {
      searchDateTime: '2026-09-25T10:00:00+09:00',
      routingErrors: [],
      edges: [{ node: itinerary }],
    },
  },
};

export const otpMultipleItinerariesFixture = {
  data: {
    planConnection: {
      searchDateTime: '2026-09-25T10:00:00+09:00',
      routingErrors: [],
      edges: [
        { node: itinerary },
        {
          node: {
            ...itinerary,
            start: '2026-09-25T10:10:00+09:00',
            end: '2026-09-25T10:27:00+09:00',
            duration: 1_020,
            numberOfTransfers: 1,
          },
        },
      ],
    },
  },
};

export const otpNoRouteFixture = {
  data: {
    planConnection: {
      searchDateTime: '2026-09-25T10:00:00+09:00',
      routingErrors: [],
      edges: [],
    },
  },
};

export const otpRoutingErrorFixture = {
  data: {
    planConnection: {
      searchDateTime: '2026-09-25T10:00:00+09:00',
      routingErrors: [
        {
          code: 'OUTSIDE_SERVICE_PERIOD',
          description: 'Date is outside the transit service period',
          inputField: 'dateTime',
        },
      ],
      edges: [],
    },
  },
};

export const otpGraphqlErrorFixture = {
  errors: [
    {
      message: 'Variable origin is invalid',
      extensions: { code: 'BAD_USER_INPUT' },
    },
  ],
};
