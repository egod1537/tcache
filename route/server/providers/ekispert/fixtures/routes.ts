const points = [
  point('22828', '東京', 35.681236, 139.767125),
  point('22735', '新宿', 35.690921, 139.700258),
  point('22492', '浅草', 35.714765, 139.796655),
  point('22715', '渋谷', 35.658034, 139.701636),
];

export const directRouteFixture = response(
  [points[0], points[3]],
  [line('ＪＲ山手線', 'train', 25, 87, '10:00', '10:25')],
  0,
);

export const oneTransferFixture = response(
  [points[0], points[1], points[3]],
  [
    line('ＪＲ中央線快速', 'train', 14, 103, '10:00', '10:14'),
    line('ＪＲ山手線', 'train', 8, 38, '10:18', '10:26'),
  ],
  1,
);

export const multipleTransferFixture = response(
  points,
  [
    line('ＪＲ中央線快速', 'train', 14, 103, '10:00', '10:14'),
    line('都営地下鉄大江戸線', 'train', 18, 94, '10:18', '10:36'),
    line('東京メトロ銀座線', 'train', 30, 152, '10:41', '11:11'),
  ],
  2,
);

export const walkingAndTrainFixture = response(
  [points[0], points[1], points[3]],
  [
    line('徒歩', 'walk', 7, 5, '10:00', '10:07'),
    line('ＪＲ山手線', 'train', 9, 41, '10:10', '10:19'),
  ],
  0,
  7,
);

export const noRouteFixture = {
  ResultSet: { apiVersion: '1.27.0.0', engineVersion: 'fixture', Course: [] },
};

export const malformedResponseFixture = {
  ResultSet: {
    apiVersion: '1.27.0.0',
    Course: { Route: { Point: [points[0]], Line: [] } },
  },
};

export const providerErrorFixture = {
  ResultSet: {
    apiVersion: '1.27.0.0',
    Error: { code: 'W403', Message: '認証エラー' },
  },
};

function response(
  routePoints: unknown[],
  lines: unknown[],
  transferCount: number,
  timeWalk = 0,
) {
  const timeOnBoard = lines.reduce<number>((total, value) => {
    const item = value as { Type: string; timeOnBoard: string };
    return total + (item.Type === 'walk' ? 0 : Number(item.timeOnBoard));
  }, 0);
  const distance = lines.reduce<number>(
    (total, value) => total + Number((value as { distance: string }).distance),
    0,
  );
  return {
    ResultSet: {
      apiVersion: '1.27.0.0',
      engineVersion: 'fixture',
      Course: [
        {
          searchType: 'departure',
          dataType: 'onTimetable',
          Price: [{ kind: 'FareSummary', Oneway: '210', Round: '420' }],
          Route: {
            timeOther: '3',
            timeOnBoard: String(timeOnBoard),
            timeWalk: String(timeWalk),
            transferCount: String(transferCount),
            distance: String(distance),
            Point: routePoints,
            Line: lines,
          },
        },
      ],
    },
  };
}

function point(
  code: string,
  name: string,
  latitude: number,
  longitude: number,
) {
  return {
    Station: { code, Name: name, Type: 'train' },
    GeoPoint: {
      lati_d: String(latitude),
      longi_d: String(longitude),
      gcs: 'wgs84',
    },
  };
}

function line(
  name: string,
  type: string,
  minutes: number,
  distanceHundredMeters: number,
  departure: string,
  arrival: string,
) {
  return {
    Name: name,
    Type: type,
    timeOnBoard: String(minutes),
    distance: String(distanceHundredMeters),
    stopStationCount: '3',
    DepartureState: {
      no: '3',
      Datetime: { text: `2026-10-02T${departure}:00+09:00` },
    },
    ArrivalState: {
      no: '2',
      Datetime: { text: `2026-10-02T${arrival}:00+09:00` },
    },
    Stop: [
      {
        Point: {
          Station: { code: 'fixture-stop', Name: '途中駅', Type: 'train' },
        },
        ArrivalState: {
          Datetime: { text: '2026-10-02T10:12:00+09:00' },
        },
        DepartureState: {
          Datetime: { text: '2026-10-02T10:13:00+09:00' },
        },
      },
    ],
    Corporation: { Name: 'Fixture Transit' },
  };
}
