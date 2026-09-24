// This file is generated from troute/tests/fixtures/places/*_10_places.json.
// Do not edit it by hand. Run: node scripts/generate_testbed_place_presets.mjs

export interface GeneratedPlaceFixtureLocation {
  id: string;
  name: string;
  placeId: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface GeneratedPlaceFixtureCity {
  id: string;
  name: string;
  regionCode: string;
  languageCode: string;
  timezone: string;
  defaultStartTime: string;
  verifiedAt: string;
  locations: GeneratedPlaceFixtureLocation[];
}

export const GENERATED_PLACE_FIXTURE_CITIES: GeneratedPlaceFixtureCity[] = [
  {
    id: 'tokyo',
    name: 'Tokyo',
    regionCode: 'JP',
    languageCode: 'ja',
    timezone: 'Asia/Tokyo',
    defaultStartTime: '09:00',
    verifiedAt: '2026-09-22',
    locations: [
      {
        id: 'tokyo-station',
        name: 'Tokyo Station',
        placeId: 'ChIJC3Cf2PuLGGAROO00ukl8JwA',
        address: '1 Chome-9 Marunouchi, Chiyoda City, Tokyo 100-0005, Japan',
        latitude: 35.6812996,
        longitude: 139.7670658,
      },
      {
        id: 'shibuya-station',
        name: 'Shibuya Station',
        placeId: 'ChIJnxAAO1aLGGARJqvi8d4oczM',
        address: '2 Chome-24 Shibuya, Tokyo 150-0002, Japan',
        latitude: 35.6580339,
        longitude: 139.7016358,
      },
      {
        id: 'shinjuku-station',
        name: 'Shinjuku Station',
        placeId: 'ChIJH7qx1tCMGGAR1f2s7PGhMhw',
        address: '3 Chome-38-1 Shinjuku, Shinjuku City, Tokyo 160-0022, Japan',
        latitude: 35.6896067,
        longitude: 139.7005713,
      },
      {
        id: 'senso-ji',
        name: 'Sensō-ji',
        placeId: 'ChIJ8T1GpMGOGGARDYGSgpooDWw',
        address: '2 Chome-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan',
        latitude: 35.7147651,
        longitude: 139.7966553,
      },
      {
        id: 'ueno-station',
        name: 'Ueno Station',
        placeId: 'ChIJCwbTk56OGGARRJJPe22ziWw',
        address: '7 Chome-1 Ueno, Taito City, Tokyo 110-0005, Japan',
        latitude: 35.7141672,
        longitude: 139.7774091,
      },
      {
        id: 'akihabara-station',
        name: 'Akihabara Station',
        placeId: 'ChIJKTP54qeOGGARsZf1fyU2jxU',
        address: '1 Chome Sotokanda, Chiyoda City, Tokyo 101-0028, Japan',
        latitude: 35.698383,
        longitude: 139.7730717,
      },
      {
        id: 'tokyo-skytree',
        name: 'Tokyo Skytree',
        placeId: 'ChIJ35ov0dCOGGARKvdDH7NPHX0',
        address: '1 Chome-1-2 Oshiage, Sumida City, Tokyo 131-0045, Japan',
        latitude: 35.7100627,
        longitude: 139.8107004,
      },
      {
        id: 'roppongi-hills',
        name: 'Roppongi Hills',
        placeId: 'ChIJM9xJEHeLGGARAshMWUgC_ls',
        address: '6 Chome-10-1 Roppongi, Minato City, Tokyo 106-6108, Japan',
        latitude: 35.6607397,
        longitude: 139.7292319,
      },
      {
        id: 'ikebukuro-station',
        name: 'Ikebukuro Station',
        placeId: 'ChIJ3eBDQF2NGGARTQMrXdJ1NyE',
        address:
          '1 Chome-28 Minamiikebukuro, Toshima City, Tokyo 171-0022, Japan',
        latitude: 35.7295028,
        longitude: 139.7109001,
      },
      {
        id: 'odaiba-marine-park',
        name: 'Odaiba Marine Park',
        placeId: 'ChIJ18IK6x2KGGARKTc2yLS-030',
        address: '1 Chome-4-4 Daiba, Minato City, Tokyo 135-0091, Japan',
        latitude: 35.6300488,
        longitude: 139.7756912,
      },
    ],
  },
  {
    id: 'seoul',
    name: 'Seoul',
    regionCode: 'KR',
    languageCode: 'ko',
    timezone: 'Asia/Seoul',
    defaultStartTime: '09:00',
    verifiedAt: '2026-09-22',
    locations: [
      {
        id: 'seoul-station',
        name: 'Seoul Station',
        placeId: 'ChIJQxWNcmaifDURTBfjk-JvH2Y',
        address: 'Seoul, South Korea',
        latitude: 37.551856,
        longitude: 126.9708191,
      },
      {
        id: 'gangnam-station',
        name: 'Gangnam Station',
        placeId: 'ChIJKxs2jFmhfDURPP--kvKavw0',
        address: 'Yeoksam-dong, Seoul, South Korea',
        latitude: 37.497952,
        longitude: 127.027619,
      },
      {
        id: 'hongik-university-station',
        name: 'Hongik University Station',
        placeId: 'ChIJ4d9T2emYfDURGK_RrkTeN0o',
        address: 'Seoul, South Korea',
        latitude: 37.557527,
        longitude: 126.9244669,
      },
      {
        id: 'gyeongbokgung-palace',
        name: 'Gyeongbokgung Palace',
        placeId: 'ChIJod7tSseifDUR9hXHLFNGMIs',
        address: '161 Sajik-ro, Jongno District, Seoul, South Korea',
        latitude: 37.579617,
        longitude: 126.977041,
      },
      {
        id: 'myeongdong-station',
        name: 'Myeongdong Station',
        placeId: 'ChIJ_du5f_qifDURo58Y4M0dDfY',
        address: 'Seoul, South Korea',
        latitude: 37.560918,
        longitude: 126.985865,
      },
      {
        id: 'dongdaemun-design-plaza',
        name: 'Dongdaemun Design Plaza',
        placeId: 'ChIJ8xRYr29FezUR3AtFqx2pIlw',
        address: '281 Eulji-ro, Jung District, Seoul, South Korea',
        latitude: 37.5665256,
        longitude: 127.0092236,
      },
      {
        id: 'jamsil-station',
        name: 'Jamsil Station',
        placeId: 'ChIJsaECEwqlfDURVEJQ6Agz7qc',
        address: 'Jamsil 6-dong, Seoul, South Korea',
        latitude: 37.5132612,
        longitude: 127.1001336,
      },
      {
        id: 'yeouido-station',
        name: 'Yeouido Station',
        placeId: 'ChIJI0pyfD2ffDURS7Skr0U-e_M',
        address: 'Seoul, South Korea',
        latitude: 37.521625,
        longitude: 126.924079,
      },
      {
        id: 'itaewon-station',
        name: 'Itaewon Station',
        placeId: 'ChIJHX2z-UqifDUR6L9ZIciWFzo',
        address:
          '16 Noksapyeong-daero 46-gil, Yongsan District, Seoul, South Korea',
        latitude: 37.534542,
        longitude: 126.994596,
      },
      {
        id: 'starfield-coex-mall',
        name: 'Starfield COEX Mall',
        placeId: 'ChIJIRVdC6pFezUR02aa2I7i57A',
        address: '513 Yeongdong-daero, Gangnam District, Seoul, South Korea',
        latitude: 37.5118346,
        longitude: 127.0597871,
      },
    ],
  },
];
