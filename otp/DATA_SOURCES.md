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

| Feed       | Producer                                                | Coverage                                             | Verified feed version | Download used by PoC                                     | Producer source                                                          | License   | Static | GTFS-Realtime                                                 | OTP import               |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------- | --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ | --------- | ------ | ------------------------------------------------------------- | ------------------------ |
| Toei Train | Bureau of Transportation, Tokyo Metropolitan Government | Toei Subway, Tokyo Sakura Tram, Nippori-Toneri Liner | `20260921`            | `https://files.mobilitydatabase.org/mdb-3176/latest.zip` | `https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip` | CC BY 4.0 | Yes    | Not listed with this static dataset; not included in this PoC | Successful on 2026-09-24 |
| Toei Bus   | Bureau of Transportation, Tokyo Metropolitan Government | Toei bus network in the Tokyo metropolitan area      | `20260924_030759`     | `https://files.mobilitydatabase.org/mdb-3175/latest.zip` | `https://api-public.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip`    | CC BY 4.0 | Yes    | Not listed with this static dataset; not included in this PoC | Successful on 2026-09-24 |

The public Mobility Database snapshots are used because they are directly downloadable and redistribution is permitted by the feed license. The producer catalog remains the authority for licensing and attribution. Attribution: Bureau of Transportation, Tokyo Metropolitan Government / Association for Open Data of Public Transportation.

`scripts/inspect-feeds.sh` prints publisher/version fields, calendar bounds, row counts, sizes, and checksums from the actual downloaded files. This is the source of truth for a particular build, rather than the mutable `latest.zip` URLs in this table.

## Current coverage

Supported in this PoC:

- Toei Subway
- Tokyo Sakura Tram
- Nippori-Toneri Liner
- Toei Bus
- Walking access and transfers from OpenStreetMap

Not included:

- JR East
- Tokyo Metro
- Private railways such as Tokyu, Keio, Odakyu, Seibu, and Tobu
- Airport rail operators
- GTFS-Realtime

The tested stations are not all directly served by Toei rail. Some trips depend on a walking access leg or Toei Bus. Results can therefore be slower, contain longer walks, or have fewer choices than Ekispert/NAVITIME. This limitation is the main data-maintenance finding of the PoC, not an OTP routing defect.

## Source references

- Toei train dataset catalog and license: <https://ckan.odpt.org/dataset/train-toei>
- Toei bus dataset catalog and license: <https://ckan.odpt.org/dataset/b_bus_gtfs_jp-toei>
- Mobility Database catalog: <https://github.com/MobilityData/mobility-database-catalogs>
- Tokyo OSM extract: <https://download.bbbike.org/osm/bbbike/Tokyo/>
- OpenStreetMap copyright and ODbL attribution: <https://www.openstreetmap.org/copyright>
