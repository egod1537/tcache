#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command curl
require_command jq
require_command unzip

TOKYO_OSM_URL="${TOKYO_OSM_URL:-https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf}"
TOEI_TRAIN_GTFS_URL="${TOEI_TRAIN_GTFS_URL:-https://files.mobilitydatabase.org/mdb-3176/latest.zip}"
TOEI_BUS_GTFS_URL="${TOEI_BUS_GTFS_URL:-https://files.mobilitydatabase.org/mdb-3175/latest.zip}"
FORCE_DOWNLOAD="${FORCE_DOWNLOAD:-false}"

mkdir -p "${DATA_DIR}"

download() {
  local label="$1"
  local url="$2"
  local destination="$3"
  local temporary="${destination}.part"

  if [[ -f "${destination}" && "${FORCE_DOWNLOAD}" != "true" ]]; then
    echo "Reusing ${label}: ${destination}"
    return
  fi

  echo "Downloading ${label}..."
  curl --fail --location --retry 3 --retry-all-errors --show-error \
    --output "${temporary}" "${url}"
  mv "${temporary}" "${destination}"
}

download "Tokyo OSM extract" "${TOKYO_OSM_URL}" "${DATA_DIR}/tokyo.osm.pbf"
download "Toei train GTFS" "${TOEI_TRAIN_GTFS_URL}" "${DATA_DIR}/toei-train-gtfs.zip"
download "Toei bus GTFS" "${TOEI_BUS_GTFS_URL}" "${DATA_DIR}/toei-bus-gtfs.zip"

for feed in "${DATA_DIR}"/*-gtfs.zip; do
  unzip -tq "${feed}" >/dev/null
done

downloaded_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

jq -n \
  --arg downloadedAt "${downloaded_at}" \
  --arg osmUrl "${TOKYO_OSM_URL}" \
  --arg osmSha "$(sha256_file "${DATA_DIR}/tokyo.osm.pbf")" \
  --argjson osmBytes "$(file_size "${DATA_DIR}/tokyo.osm.pbf")" \
  --arg trainUrl "${TOEI_TRAIN_GTFS_URL}" \
  --arg trainSha "$(sha256_file "${DATA_DIR}/toei-train-gtfs.zip")" \
  --argjson trainBytes "$(file_size "${DATA_DIR}/toei-train-gtfs.zip")" \
  --arg busUrl "${TOEI_BUS_GTFS_URL}" \
  --arg busSha "$(sha256_file "${DATA_DIR}/toei-bus-gtfs.zip")" \
  --argjson busBytes "$(file_size "${DATA_DIR}/toei-bus-gtfs.zip")" \
  '{
    downloadedAt: $downloadedAt,
    osm: {source: $osmUrl, sha256: $osmSha, bytes: $osmBytes},
    gtfs: [
      {provider: "Toei Train", source: $trainUrl, sha256: $trainSha, bytes: $trainBytes},
      {provider: "Toei Bus", source: $busUrl, sha256: $busSha, bytes: $busBytes}
    ]
  }' >"${DATA_DIR}/data-metadata.json"

echo "Data prepared in ${DATA_DIR}"
echo "Run ./scripts/inspect-feeds.sh before building the graph."
