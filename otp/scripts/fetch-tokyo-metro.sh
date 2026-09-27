#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command curl
require_command jq
require_command unzip

source_config="${OTP_ROOT}/config/tokyo-metro-source.json"
source_url="$(jq -r '.sourceUrl' "${source_config}")"
consumer_key="${TOKYO_METRO_ODPT_KEY:-${ODPT_CONSUMER_KEY:-}}"
output_root="${TOKYO_METRO_DATA_ROOT:-${OTP_ROOT}/data/japan/tokyo/tokyo-metro}"

if [[ -z "${consumer_key}" ]]; then
  echo "TOKYO_METRO_ODPT_KEY is required. Register at https://developer.odpt.org/." >&2
  exit 1
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/tcache-tokyo-metro.XXXXXX")"
trap 'rm -rf "${temporary_dir}"' EXIT
download="${temporary_dir}/TokyoMetro-Train-GTFS.zip"
headers="${temporary_dir}/headers.txt"
requested_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

http_status="$(curl --fail-with-body --silent --show-error --location \
  --connect-timeout 15 --max-time 180 \
  --retry 3 --retry-all-errors --retry-delay 2 \
  --dump-header "${headers}" \
  --output "${download}" \
  --write-out '%{http_code}' \
  --get --data-urlencode "acl:consumerKey=${consumer_key}" \
  "${source_url}")"

unzip -tq "${download}" >/dev/null
for required_file in agency.txt stops.txt routes.txt trips.txt stop_times.txt feed_info.txt; do
  if ! unzip -Z1 "${download}" | grep -Fxq "${required_file}"; then
    echo "Official Tokyo Metro GTFS is missing ${required_file}." >&2
    exit 1
  fi
done

route_names="$(unzip -p "${download}" routes.txt | tr -d '\r' | awk -F, 'NR > 1 {gsub(/^\"|\"$/, "", $3); print $3}' | sort -u | jq -Rsc 'split("\n") | map(select(length > 0))')"
expected_routes="$(jq -cS '.expectedRouteShortNames | sort' "${source_config}")"
actual_routes="$(printf '%s' "${route_names}" | jq -cS 'sort')"
if [[ "${actual_routes}" != "${expected_routes}" ]]; then
  echo "Tokyo Metro route contract changed: expected ${expected_routes}, got ${actual_routes}." >&2
  exit 1
fi

feed_version="$(unzip -p "${download}" feed_info.txt | tr -d '\r' | awk -F, 'NR == 2 {gsub(/^\"|\"$/, "", $6); print $6}')"
if [[ -z "${feed_version}" ]]; then
  echo "Tokyo Metro feed_info.txt has no feed_version." >&2
  exit 1
fi

sha256="$(sha256_file "${download}")"
sha1="$(shasum -a 1 "${download}" | awk '{print $1}')"
artifact_root="${output_root}/${feed_version}/${sha256}"
artifact="${artifact_root}/raw/TokyoMetro-Train-GTFS.zip"
metadata="${artifact_root}/tokyo-metro-feed-metadata.json"
mkdir -p "${artifact_root}/raw"

if [[ -e "${artifact}" ]]; then
  if [[ "$(sha256_file "${artifact}")" != "${sha256}" ]]; then
    echo "Immutable Tokyo Metro artifact differs: ${artifact}" >&2
    exit 1
  fi
else
  mv "${download}" "${artifact}"
fi

content_type="$(awk 'BEGIN {IGNORECASE=1} /^content-type:/ {sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); value=$0} END {print value}' "${headers}")"
jq -n \
  --arg requestedAt "${requested_at}" \
  --arg sourceUrl "${source_url}" \
  --arg httpStatus "${http_status}" \
  --arg contentType "${content_type}" \
  --arg sha256 "${sha256}" \
  --arg sha1 "${sha1}" \
  --arg feedVersion "${feed_version}" \
  --argjson routes "${actual_routes}" \
  --argjson bytes "$(file_size "${artifact}")" \
  '{
    schemaVersion:"1.0",
    feedId:"jp-tokyo-metro",
    operator:"Tokyo Metro Co., Ltd.",
    sourceType:"official-gtfs",
    sourceUrl:$sourceUrl,
    requestedAt:$requestedAt,
    httpStatus:($httpStatus|tonumber),
    contentType:$contentType,
    sha256:$sha256,
    sha1:$sha1,
    bytes:$bytes,
    feedVersion:$feedVersion,
    routes:$routes,
    credentialStored:false,
    artifactPath:"raw/TokyoMetro-Train-GTFS.zip",
    scope:{purpose:"personal-education-and-research",externalDistribution:false,commercialUse:false}
  }' >"${metadata}"

ln -sfn "${feedVersion}/${sha256}" "${output_root}/latest"
echo "Tokyo Metro official GTFS stored immutably: ${artifact}"
echo "Metadata: ${metadata}"
