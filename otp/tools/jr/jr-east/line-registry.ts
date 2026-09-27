export type JrEastService = 'weekday' | 'holiday';

export interface JrEastDirectionDefinition {
  id: string;
  sourceLabelIncludes: string;
  matrixHeadingIncludes: string;
  labelJa: string;
  gtfsDirectionId: 0 | 1;
}

export interface JrEastLineDefinition {
  lineKey: string;
  nameJa: string;
  nameEn: string;
  sourceIndexUrl: string;
  sourceLineName: string;
  routeShortName: string;
  directions: readonly JrEastDirectionDefinition[];
}

export const JR_EAST_LINE_REGISTRY = {
  yamanote: {
    lineKey: 'yamanote',
    nameJa: '山手線',
    nameEn: 'Yamanote Line',
    sourceIndexUrl: 'https://timetables.jreast.co.jp/timetable/list1039.html',
    sourceLineName: '山手線',
    routeShortName: 'JY',
    directions: [
      {
        id: 'outer',
        sourceLabelIncludes: '外回り',
        matrixHeadingIncludes: '外回り',
        labelJa: '外回り',
        gtfsDirectionId: 0,
      },
      {
        id: 'inner',
        sourceLabelIncludes: '内回り',
        matrixHeadingIncludes: '内回り',
        labelJa: '内回り',
        gtfsDirectionId: 1,
      },
    ],
  },
  'chuo-rapid': {
    lineKey: 'chuo-rapid',
    nameJa: '中央線快速',
    nameEn: 'Chuo Line (Rapid)',
    sourceIndexUrl: 'https://timetables.jreast.co.jp/timetable/list0866.html',
    sourceLineName: '中央線快速',
    routeShortName: 'JC',
    directions: [
      {
        id: 'westbound',
        sourceLabelIncludes: '下り',
        matrixHeadingIncludes: '下り',
        labelJa: '下り・西行',
        gtfsDirectionId: 0,
      },
      {
        id: 'eastbound',
        sourceLabelIncludes: '上り',
        matrixHeadingIncludes: '上り',
        labelJa: '上り・東行',
        gtfsDirectionId: 1,
      },
    ],
  },
  'chuo-sobu-local': {
    lineKey: 'chuo-sobu-local',
    nameJa: '中央・総武線各駅停車',
    nameEn: 'Chuo-Sobu Line (Local)',
    sourceIndexUrl: 'https://timetables.jreast.co.jp/timetable/list0866.html',
    sourceLineName: '中央・総武線各駅停車',
    routeShortName: 'JB',
    directions: [
      {
        id: 'eastbound',
        sourceLabelIncludes: '東行',
        matrixHeadingIncludes: '上り',
        labelJa: '東行',
        gtfsDirectionId: 0,
      },
      {
        id: 'westbound',
        sourceLabelIncludes: '西行',
        matrixHeadingIncludes: '下り',
        labelJa: '西行',
        gtfsDirectionId: 1,
      },
    ],
  },
  'keihin-tohoku': {
    lineKey: 'keihin-tohoku',
    nameJa: '京浜東北線・根岸線',
    nameEn: 'Keihin-Tohoku-Negishi Line',
    sourceIndexUrl: 'https://timetables.jreast.co.jp/timetable/list1039.html',
    sourceLineName: '京浜東北線・根岸線',
    routeShortName: 'JK',
    directions: [
      {
        id: 'southbound',
        sourceLabelIncludes: '南行',
        matrixHeadingIncludes: '南行',
        labelJa: '南行',
        gtfsDirectionId: 0,
      },
      {
        id: 'northbound',
        sourceLabelIncludes: '北行',
        matrixHeadingIncludes: '北行',
        labelJa: '北行',
        gtfsDirectionId: 1,
      },
    ],
  },
} as const satisfies Record<string, JrEastLineDefinition>;

export type ActiveJrEastLineKey = keyof typeof JR_EAST_LINE_REGISTRY;

export function getJrEastLineDefinition(lineKey: string): JrEastLineDefinition {
  const definition = (
    JR_EAST_LINE_REGISTRY as Record<string, JrEastLineDefinition>
  )[lineKey];
  if (!definition) throw new Error(`Unsupported JR East line: ${lineKey}`);
  return definition;
}
