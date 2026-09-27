# Tokyo PoC data sources

This PoC intentionally starts with a small, licensed subset of Tokyo transit. It does not claim full Tokyo coverage.

## OpenStreetMap

| Field        | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Coverage     | BBBike Tokyo extract; central Tokyo and surrounding urban area                   |
| Download     | `https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf`                     |
| Upstream     | OpenStreetMap contributors                                                       |
| License      | Open Data Commons Open Database License (ODbL) 1.0                               |
| Update model | BBBike rolling extract; inspect the HTTP `Last-Modified` header when downloading |
| PoC use      | Street graph, station access, transfers, and walking legs                        |

Attribution: © OpenStreetMap contributors. BBBike only packages the regional extract. The generated `data-metadata.json` records the exact download time, size, and SHA-256 checksum.

## Static GTFS

| Feed        | Producer                                                | Coverage                                                                            | Verified feed version            | Download used by PoC                                     | Producer source                                                               | License                                       | Static | GTFS-Realtime                                                 | OTP import                      |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | ------ | ------------------------------------------------------------- | ------------------------------- |
| Toei Train  | Bureau of Transportation, Tokyo Metropolitan Government | Toei Subway, Tokyo Sakura Tram, Nippori-Toneri Liner                                | `20260921`                       | `https://files.mobilitydatabase.org/mdb-3176/latest.zip` | `https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip`      | CC BY 4.0                                     | Yes    | Not listed with this static dataset; not included in this PoC | Successful on 2026-09-24        |
| Toei Bus    | Bureau of Transportation, Tokyo Metropolitan Government | Toei bus network in the Tokyo metropolitan area                                     | `20260924_030759`                | `https://files.mobilitydatabase.org/mdb-3175/latest.zip` | `https://api-public.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip`         | CC BY 4.0                                     | Yes    | Not listed with this static dataset; not included in this PoC | Successful on 2026-09-24        |
| Tokyo Metro | Tokyo Metro Co., Ltd.                                   | Ginza, Marunouchi, Hibiya, Tozai, Chiyoda, Yurakucho, Hanzomon, Namboku, Fukutoshin | Collected per immutable artifact | Local authorized download                                | `https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip` | Public Transportation Open Data Basic License | Yes    | Not included                                                  | Requires `TOKYO_METRO_ODPT_KEY` |

The public Mobility Database snapshots are used because they are directly downloadable and redistribution is permitted by the feed license. The producer catalog remains the authority for licensing and attribution. Attribution: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation.

`scripts/inspect-feeds.sh` prints publisher/version fields, calendar bounds, row counts, sizes, and checksums from the actual downloaded files. This is the source of truth for a particular build, rather than the mutable `latest.zip` URLs in this table.

## Current coverage

Supported in the original public-data baseline:

- Toei Subway
- Tokyo Sakura Tram
- Nippori-Toneri Liner
- Toei Bus
- Walking access and transfers from OpenStreetMap

Not included in that distributable baseline:

- JR East
- Tokyo Metro official GTFS (credentialed local artifact only)
- Private railways such as Tokyu, Keio, Odakyu, Seibu, and Tobu
- Airport rail operators
- GTFS-Realtime

The local integrated build additionally stages the authorized generated JR
GTFS and credentialed official Tokyo Metro GTFS next to the two public Toei
feeds. Its manifest keeps `generated-gtfs`, `official-gtfs`, `public-gtfs`, and
`osm-pbf` lineage and license/scope metadata distinct. JR and Tokyo Metro local
artifacts are never promoted into the distributable public-data baseline.

The tested stations are not all directly served by the included networks. Some trips depend on walking access or Toei Bus, and Tokyo Metro/private-rail gaps remain. Results can therefore be slower or have fewer choices than a full commercial journey planner; this is a coverage limitation, not by itself an OTP routing defect.

## Local JR East research artifacts

The optional `tools/jr/` workflow uses only the public official timetable pages at <https://timetables.jreast.co.jp/>. It discovers Yamanote matrix and linked train-detail pages from the current Tokyo Station timetable rather than calling or reverse-engineering a private API. The observed opaque edition key and the human-readable edition label printed by JR East are stored separately.

These collected and normalized JR East artifacts are for the authorized personal education/research PoC only. They remain Git-ignored and local, are not part of the distributable Toei GTFS inputs above, and must not be redistributed or used commercially.

The optional Yamanote GTFS generator uses a reviewed mapping of all 30 stations to `stop_position` nodes in OpenStreetMap Yamanote route relation 1972920. The artifact records node IDs, JY station codes, coordinates, retrieval/review time, ODbL 1.0, and OpenStreetMap contributor attribution. Exact Japanese names and station codes are required; fuzzy candidates are never automatically confirmed.

Generated GTFS is checked with the official MobilityData GTFS Validator image pinned by version. The local manifest records the validator version, error/warning counts, report paths, canonical content hash, ZIP SHA-256, normalized dataset lineage, and OSM mapping hash. Unresolved public-holiday weekday exceptions and temporary suspensions remain explicit and are not synthesized.

## Source references

- Toei train dataset catalog and license: <https://ckan.odpt.org/dataset/train-toei>
- Toei bus dataset catalog and license: <https://ckan.odpt.org/dataset/b_bus_gtfs_jp-toei>
- Mobility Database catalog: <https://github.com/MobilityData/mobility-database-catalogs>
- Tokyo OSM extract: <https://download.bbbike.org/osm/bbbike/Tokyo/>
- OpenStreetMap copyright and ODbL attribution: <https://www.openstreetmap.org/copyright>
- Reviewed Yamanote route relation: <https://www.openstreetmap.org/relation/1972920>
- MobilityData GTFS Validator: <https://github.com/MobilityData/gtfs-validator>
- Tokyo Metro official GTFS registry: `config/tokyo-metro-source.json`
- Tokyu/Keio/Odakyu Challenge 2026 registry:
  `config/private-core-source-registry.json`
- Keikyu/Keisei/Seibu/Tobu/Sotetsu source registry:
  `config/private-outer-source-registry.json`
- Final 12-feed production registry and source-change contract:
  `config/tokyo-rail-production-registry.json` and
  `schemas/tokyo-rail-source-snapshot.schema.json`

## Tokyu, Keio, and Odakyu — Challenge 2026

The first private-railway expansion uses only official Public Transportation
Open Data Center Challenge 2026 sources:

- Tokyu: official `Railway`, `Station`, and `StationTimetable` JSON APIs
  (`TYPE_B`).
- Keio: official `Keio-Train-GTFS.zip` (`TYPE_A`); the archive is preserved
  unchanged.
- Odakyu: official `Railway`, `Station`, and `StationTimetable` JSON APIs
  (`TYPE_B`).

All endpoints require a Challenge 2026 access token supplied locally as
`ODPT_CHALLENGE_KEY` and are governed by the Public Transport Open Data
Challenge Limited License. Raw bytes are immutable and content-addressed.
They are restricted to this personal education/research PoC and must not be
redistributed or used commercially.

- Public Transportation Open Data Center developer registration and terms: <https://developer.odpt.org/>

## Keikyu, Keisei, Seibu, Tobu, and Sotetsu

The second private-railway expansion also prefers official Challenge 2026
sources. Keikyu and Seibu provide official `Railway`, `Station`, and
`StationTimetable` JSON (`TYPE_B`). Tobu and Sotetsu provide official static
GTFS archives (`TYPE_A`). These four source families require a locally
supplied `ODPT_CHALLENGE_KEY`; raw content is immutable and restricted to this
personal education/research PoC.

Keisei is `TYPE_D`. As of the registry review on 2026-09-27, no current
official GTFS or ODPT train-level dataset was found for the required Main Line
and general Narita Sky Access scope. Official route/station and Skyliner pages
are recorded as evidence, but are not silently converted into a complete
general-service feed. No unofficial dataset is used as a fallback, and paid
limited express trips remain excluded until explicitly modeled.

- Keikyu official catalog: <https://ckan.odpt.org/dataset/?organization=keikyu>
- Seibu official catalog: <https://ckan.odpt.org/dataset/?organization=seibu>
- Tobu official GTFS: <https://ckan.odpt.org/dataset/tobu_train>
- Sotetsu official GTFS: <https://ckan.odpt.org/dataset/sotetsu_train>
- Keisei official route information: <https://www.keisei.co.jp/keisei/tetudou/accessj/>
