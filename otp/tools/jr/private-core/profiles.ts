import type { PrivateOperatorConfig } from './model.js';

export const TOKYU_PRIVATE_CONFIG: PrivateOperatorConfig = {
  operatorId: 'tokyu',
  sourceOperator: 'odpt.Operator:Tokyu',
  nameJa: '東急電鉄',
  nameEn: 'Tokyu Railways',
  website: 'https://www.tokyu.co.jp/railway/',
  lines: [
    { sourceKey: 'Toyoko', nameJa: '東横線', routeShortName: 'TY' },
    { sourceKey: 'DenEnToshi', nameJa: '田園都市線', routeShortName: 'DT' },
    { sourceKey: 'Meguro', nameJa: '目黒線', routeShortName: 'MG' },
    { sourceKey: 'Oimachi', nameJa: '大井町線', routeShortName: 'OM' },
    { sourceKey: 'Ikegami', nameJa: '池上線', routeShortName: 'IK' },
    {
      sourceKey: 'TokyuTamagawa',
      nameJa: '東急多摩川線',
      routeShortName: 'TM',
    },
    { sourceKey: 'Setagaya', nameJa: '世田谷線', routeShortName: 'SG' },
  ],
};

export const ODAKYU_PRIVATE_CONFIG: PrivateOperatorConfig = {
  operatorId: 'odakyu',
  sourceOperator: 'odpt.Operator:Odakyu',
  nameJa: '小田急電鉄',
  nameEn: 'Odakyu Electric Railway',
  website: 'https://www.odakyu.jp/',
  lines: [
    { sourceKey: 'Odawara', nameJa: '小田原線', routeShortName: 'OH' },
    { sourceKey: 'Enoshima', nameJa: '江ノ島線', routeShortName: 'OE' },
    { sourceKey: 'Tama', nameJa: '多摩線', routeShortName: 'OT' },
  ],
};

export const KEIKYU_PRIVATE_CONFIG: PrivateOperatorConfig = {
  operatorId: 'keikyu',
  sourceOperator: 'odpt.Operator:Keikyu',
  nameJa: '京急電鉄',
  nameEn: 'Keikyu Corporation',
  website: 'https://www.keikyu.co.jp/',
  lines: [
    { sourceKey: 'Main', nameJa: '本線', routeShortName: 'KK' },
    { sourceKey: 'Airport', nameJa: '空港線', routeShortName: 'KK' },
  ],
};

export const SEIBU_PRIVATE_CONFIG: PrivateOperatorConfig = {
  operatorId: 'seibu',
  sourceOperator: 'odpt.Operator:Seibu',
  nameJa: '西武鉄道',
  nameEn: 'Seibu Railway',
  website: 'https://www.seiburailway.jp/',
  lines: [
    { sourceKey: 'Ikebukuro', nameJa: '池袋線', routeShortName: 'SI' },
    { sourceKey: 'Shinjuku', nameJa: '新宿線', routeShortName: 'SS' },
  ],
};

export const PRIVATE_OPERATOR_CONFIGS = {
  tokyu: TOKYU_PRIVATE_CONFIG,
  odakyu: ODAKYU_PRIVATE_CONFIG,
  keikyu: KEIKYU_PRIVATE_CONFIG,
  seibu: SEIBU_PRIVATE_CONFIG,
} as const;
