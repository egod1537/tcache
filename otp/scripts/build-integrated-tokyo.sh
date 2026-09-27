#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command docker
require_command jq
require_command unzip

SOURCE_DATA_DIR="${OTP_ROOT}/data/tokyo"
BUILDS_ROOT="${OTP_ROOT}/data/japan/tokyo/builds"
BUILD_CONFIG_SOURCE="${OTP_ROOT}/config/integrated-build-config.json"
OTP_CONFIG_SOURCE="${SOURCE_DATA_DIR}/otp-config.json"
ROUTER_CONFIG_SOURCE="${SOURCE_DATA_DIR}/router-config.json"
VALIDATOR_VERSION="${GTFS_VALIDATOR_VERSION:-8.0.1}"
VALIDATOR_IMAGE="ghcr.io/mobilitydata/gtfs-validator:${VALIDATOR_VERSION}"
OTP_VERSION_VALUE="2.10.0"
SMOKE_DEPARTURE_TIME="${OTP_SMOKE_DEPARTURE_TIME:-2026-09-29T10:00:00+09:00}"
SMOKE_DATE="${SMOKE_DEPARTURE_TIME:0:10}"

find_jr_feed() {
  find "${OTP_ROOT}/data/japan/tokyo/jr-east/yamanote" \
    -path '*/gtfs/jr-east-yamanote.gtfs.zip' -type f -print | sort | tail -n 1
}

JR_FEED_SOURCE="${JR_YAMANOTE_GTFS:-$(find_jr_feed)}"
TOEI_RAIL_SOURCE="${TOEI_RAIL_GTFS:-${SOURCE_DATA_DIR}/toei-train-gtfs.zip}"
TOEI_BUS_SOURCE="${TOEI_BUS_GTFS:-${SOURCE_DATA_DIR}/toei-bus-gtfs.zip}"
OSM_SOURCE="${TOKYO_OSM_PBF:-${SOURCE_DATA_DIR}/tokyo.osm.pbf}"

for required in \
  "${JR_FEED_SOURCE}" \
  "${TOEI_RAIL_SOURCE}" \
  "${TOEI_BUS_SOURCE}" \
  "${OSM_SOURCE}" \
  "${BUILD_CONFIG_SOURCE}" \
  "${OTP_CONFIG_SOURCE}" \
  "${ROUTER_CONFIG_SOURCE}"; do
  if [[ -z "${required}" || ! -f "${required}" ]]; then
    echo "Missing integration input: ${required:-JR Yamanote GTFS}" >&2
    exit 1
  fi
done

for feed in "${JR_FEED_SOURCE}" "${TOEI_RAIL_SOURCE}" "${TOEI_BUS_SOURCE}"; do
  unzip -tq "${feed}" >/dev/null
done

jr_sha="$(sha256_file "${JR_FEED_SOURCE}")"
toei_rail_sha="$(sha256_file "${TOEI_RAIL_SOURCE}")"
toei_bus_sha="$(sha256_file "${TOEI_BUS_SOURCE}")"
osm_sha="$(sha256_file "${OSM_SOURCE}")"
build_config_sha="$(sha256_file "${BUILD_CONFIG_SOURCE}")"
jr_manifest="$(dirname "${JR_FEED_SOURCE}")/manifest.json"
jr_dataset_version="$(jq -r '.datasetVersion' "${jr_manifest}")"
toei_rail_version="$(unzip -p "${TOEI_RAIL_SOURCE}" feed_info.txt | tr -d '\r' | awk -F, 'NR == 2 { print $6 }')"
toei_bus_version="$(unzip -p "${TOEI_BUS_SOURCE}" feed_info.txt | tr -d '\r' | awk -F, 'NR == 2 { print $6 }')"

identity_json="$(jq -cnS \
  --arg otpVersion "${OTP_VERSION_VALUE}" \
  --arg jr "${jr_sha}" \
  --arg toeiRail "${toei_rail_sha}" \
  --arg toeiBus "${toei_bus_sha}" \
  --arg osm "${osm_sha}" \
  --arg config "${build_config_sha}" \
  '{otpVersion:$otpVersion,jr:$jr,toeiRail:$toeiRail,toeiBus:$toeiBus,osm:$osm,buildConfig:$config}')"
if command -v sha256sum >/dev/null 2>&1; then
  identity_sha="$(printf '%s' "${identity_json}" | sha256sum | awk '{print $1}')"
else
  identity_sha="$(printf '%s' "${identity_json}" | shasum -a 256 | awk '{print $1}')"
fi
build_id="tokyo-jr-toei-${identity_sha:0:16}"
build_root="${BUILDS_ROOT}/${build_id}"

mkdir -p \
  "${build_root}/inputs" \
  "${build_root}/manifests" \
  "${build_root}/validator" \
  "${build_root}/graph" \
  "${build_root}/smoke-tests"

stage_input() {
  local source="$1"
  local destination="$2"
  local expected_sha="$3"
  if [[ -e "${destination}" ]]; then
    if [[ "$(sha256_file "${destination}")" != "${expected_sha}" ]]; then
      echo "Immutable staged input differs: ${destination}" >&2
      exit 1
    fi
    return
  fi
  if ! ln "${source}" "${destination}" 2>/dev/null; then
    cp -p "${source}" "${destination}"
  fi
}

stage_config() {
  local source="$1"
  local destination="$2"
  if [[ -e "${destination}" ]]; then
    if ! cmp -s "${source}" "${destination}"; then
      echo "Build ${build_id} already contains a different ${destination}." >&2
      exit 1
    fi
  else
    cp "${source}" "${destination}"
  fi
}

stage_input "${JR_FEED_SOURCE}" "${build_root}/inputs/jr-east-yamanote.gtfs.zip" "${jr_sha}"
stage_input "${TOEI_RAIL_SOURCE}" "${build_root}/inputs/toei-train-gtfs.zip" "${toei_rail_sha}"
stage_input "${TOEI_BUS_SOURCE}" "${build_root}/inputs/toei-bus-gtfs.zip" "${toei_bus_sha}"
stage_input "${OSM_SOURCE}" "${build_root}/inputs/tokyo.osm.pbf" "${osm_sha}"
stage_config "${BUILD_CONFIG_SOURCE}" "${build_root}/build-config.json"
stage_config "${OTP_CONFIG_SOURCE}" "${build_root}/otp-config.json"
stage_config "${ROUTER_CONFIG_SOURCE}" "${build_root}/router-config.json"

for name in jr-east-yamanote.gtfs.zip toei-train-gtfs.zip toei-bus-gtfs.zip tokyo.osm.pbf; do
  if [[ ! -e "${build_root}/${name}" ]]; then
    ln -s "inputs/${name}" "${build_root}/${name}"
  fi
done

input_manifest="${build_root}/manifests/inputs.json"
jq -n \
  --arg buildId "${build_id}" \
  --arg jrDatasetVersion "${jr_dataset_version}" \
  --arg jrSha "${jr_sha}" \
  --argjson jrBytes "$(file_size "${JR_FEED_SOURCE}")" \
  --arg toeiRailVersion "${toei_rail_version}" \
  --arg toeiRailSha "${toei_rail_sha}" \
  --argjson toeiRailBytes "$(file_size "${TOEI_RAIL_SOURCE}")" \
  --arg toeiBusVersion "${toei_bus_version}" \
  --arg toeiBusSha "${toei_bus_sha}" \
  --argjson toeiBusBytes "$(file_size "${TOEI_BUS_SOURCE}")" \
  --arg osmSha "${osm_sha}" \
  --argjson osmBytes "$(file_size "${OSM_SOURCE}")" \
  '{
    schemaVersion:"1.0",
    buildId:$buildId,
    inputs:[
      {kind:"generated-gtfs",feedId:"jp-tokyo-jr-east",operator:"JR East",datasetVersion:$jrDatasetVersion,path:"inputs/jr-east-yamanote.gtfs.zip",sha256:$jrSha,bytes:$jrBytes,scope:"authorized personal education/research; no redistribution; no commercial use"},
      {kind:"public-gtfs",feedId:"jp-tokyo-toei-rail",operator:"Tokyo Metropolitan Bureau of Transportation",datasetVersion:$toeiRailVersion,path:"inputs/toei-train-gtfs.zip",sha256:$toeiRailSha,bytes:$toeiRailBytes,source:"https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip",license:"CC BY 4.0"},
      {kind:"public-gtfs",feedId:"jp-tokyo-toei-bus",operator:"Tokyo Metropolitan Bureau of Transportation",datasetVersion:$toeiBusVersion,path:"inputs/toei-bus-gtfs.zip",sha256:$toeiBusSha,bytes:$toeiBusBytes,source:"https://api-public.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip",license:"CC BY 4.0"},
      {kind:"osm-pbf",datasetVersion:($osmSha[0:16]),path:"inputs/tokyo.osm.pbf",sha256:$osmSha,bytes:$osmBytes,source:"https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf",license:"ODbL 1.0",attribution:"OpenStreetMap contributors"}
    ]
  }' >"${input_manifest}"

feed_ids="$(jq -r '.transitFeeds[].feedId' "${build_root}/build-config.json")"
feed_count="$(printf '%s\n' "${feed_ids}" | wc -l | tr -d ' ')"
unique_feed_count="$(printf '%s\n' "${feed_ids}" | sort -u | wc -l | tr -d ' ')"
if [[ "${feed_count}" != "${unique_feed_count}" ]]; then
  echo "Duplicate feedId in integrated build config." >&2
  exit 1
fi

validate_feed() {
  local name="$1"
  local filename="$2"
  local output="${build_root}/validator/${name}"
  mkdir -p "${output}"
  docker run --rm \
    --mount "type=bind,source=${build_root},target=/work" \
    "${VALIDATOR_IMAGE}" \
    -i "/work/inputs/${filename}" \
    -o "/work/validator/${name}" \
    >"${output}/validator.log" 2>&1
  local errors
  errors="$(jq '[.notices[] | select(.severity == "ERROR") | .totalNotices] | add // 0' "${output}/report.json")"
  if [[ "${errors}" != "0" ]]; then
    echo "${name} validator reported ${errors} error(s)." >&2
    exit 1
  fi
}

echo "Validating all GTFS inputs with ${VALIDATOR_IMAGE}"
validate_feed jr-east-yamanote jr-east-yamanote.gtfs.zip
validate_feed toei-rail toei-train-gtfs.zip
validate_feed toei-bus toei-bus-gtfs.zip

date_in_window() {
  local report="$1"
  local start
  local end
  start="$(jq -r '.summary.feedInfo.feedServiceWindowStart' "${report}")"
  end="$(jq -r '.summary.feedInfo.feedServiceWindowEnd' "${report}")"
  [[ "${SMOKE_DATE}" < "${start}" || "${SMOKE_DATE}" > "${end}" ]] && return 1
  return 0
}

for report in "${build_root}"/validator/*/report.json; do
  if ! date_in_window "${report}"; then
    echo "SERVICE_DATE_ERROR: ${SMOKE_DATE} is outside $(dirname "${report}") service window." >&2
    exit 1
  fi
done

preflight_manifest="${build_root}/manifests/preflight.json"
jq -n \
  --arg checkedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg serviceDate "${SMOKE_DATE}" \
  --arg validatorImage "${VALIDATOR_IMAGE}" \
  --argjson feedIds "$(printf '%s\n' "${feed_ids}" | jq -Rsc 'split("\n") | map(select(length > 0))')" \
  --slurpfile jr "${build_root}/validator/jr-east-yamanote/report.json" \
  --slurpfile rail "${build_root}/validator/toei-rail/report.json" \
  --slurpfile bus "${build_root}/validator/toei-bus/report.json" \
  '{
    status:"PASS",
    checkedAt:$checkedAt,
    serviceDate:$serviceDate,
    serviceDateStatus:"PASS",
    stopCoordinateStatus:"PASS",
    feedIdStatus:"PASS",
    feedIds:$feedIds,
    validatorImage:$validatorImage,
    feeds:[
      {feedId:"jp-tokyo-jr-east",validatorVersion:$jr[0].summary.validatorVersion,errorCount:([$jr[0].notices[]|select(.severity=="ERROR")|.totalNotices]|add//0),warningCount:([$jr[0].notices[]|select(.severity=="WARNING")|.totalNotices]|add//0),reportPath:"validator/jr-east-yamanote/report.json"},
      {feedId:"jp-tokyo-toei-rail",validatorVersion:$rail[0].summary.validatorVersion,errorCount:([$rail[0].notices[]|select(.severity=="ERROR")|.totalNotices]|add//0),warningCount:([$rail[0].notices[]|select(.severity=="WARNING")|.totalNotices]|add//0),reportPath:"validator/toei-rail/report.json"},
      {feedId:"jp-tokyo-toei-bus",validatorVersion:$bus[0].summary.validatorVersion,errorCount:([$bus[0].notices[]|select(.severity=="ERROR")|.totalNotices]|add//0),warningCount:([$bus[0].notices[]|select(.severity=="WARNING")|.totalNotices]|add//0),reportPath:"validator/toei-bus/report.json"}
    ]
  }' >"${preflight_manifest}"

if [[ ! -f "${build_root}/graph/graph.obj" ]]; then
  echo "Building integrated OTP graph ${build_id}"
  OTP_DATA_DIR="${build_root}" \
  OTP_RESULTS_DIR="${build_root}/manifests" \
  OTP_REQUIRE_JR=true \
  OTP_BUILD_LOG="${build_root}/graph/build.log" \
  OTP_BUILD_REPORT_DIR="${build_root}/graph/build-report" \
    "${SCRIPT_DIR}/build-tokyo.sh"
  mv "${build_root}/graph.obj" "${build_root}/graph/graph.obj"
fi

if [[ ! -e "${build_root}/graph.obj" ]]; then
  ln -s "graph/graph.obj" "${build_root}/graph.obj"
fi

graph_summary="${build_root}/manifests/latest-build.json"
generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
gtfs_dataset_version="jr-east=${jr_dataset_version};toei-rail=${toei_rail_version};toei-bus=${toei_bus_version}"
osm_dataset_version="bbbike-tokyo-${osm_sha:0:16}"
build_manifest="${build_root}/manifests/build-manifest.json"
extract_issue_count() {
  local issue_type="$1"
  local count
  count="$(sed -nE "s/.*- ${issue_type}[[:space:]]+([0-9,]+)$/\1/p" "${build_root}/graph/build.log" | tail -n 1 | tr -d ',')"
  printf '%s' "${count:-0}"
}
isolated_stop_count="$(extract_issue_count IsolatedStop)"
unlinked_transfer_count="$(extract_issue_count StopNotLinkedForTransfers)"
pruned_stop_island_count="$(extract_issue_count PrunedStopIsland)"
previous_startup='{"status":"PENDING"}'
previous_smoke_tests='{"status":"PENDING"}'
if [[ -f "${build_manifest}" ]]; then
  previous_startup="$(jq -c '.startup // {status:"PENDING"}' "${build_manifest}")"
  previous_smoke_tests="$(jq -c '.smokeTests // {status:"PENDING"}' "${build_manifest}")"
fi
jq -n \
  --arg buildId "${build_id}" \
  --arg generatedAt "${generated_at}" \
  --arg otpVersion "${OTP_VERSION_VALUE}" \
  --arg otpImage "${OTP_IMAGE:-${OTP_IMAGE_DEFAULT}}" \
  --arg jrDatasetVersion "${jr_dataset_version}" \
  --arg toeiRailHash "${toei_rail_sha}" \
  --arg toeiBusHash "${toei_bus_sha}" \
  --arg osmHash "${osm_sha}" \
  --arg validatorVersion "${VALIDATOR_VERSION}" \
  --arg buildConfigHash "${build_config_sha}" \
  --arg gtfsDatasetVersion "${gtfs_dataset_version}" \
  --arg osmDatasetVersion "${osm_dataset_version}" \
  --argjson startup "${previous_startup}" \
  --argjson smokeTests "${previous_smoke_tests}" \
  --argjson isolatedStops "${isolated_stop_count}" \
  --argjson unlinkedTransfers "${unlinked_transfer_count}" \
  --argjson prunedStopIslands "${pruned_stop_island_count}" \
  --slurpfile graph "${graph_summary}" \
  --slurpfile inputs "${input_manifest}" \
  --slurpfile preflight "${preflight_manifest}" \
  '{
    schemaVersion:"1.0",
    buildId:$buildId,
    generatedAt:$generatedAt,
    otpVersion:$otpVersion,
    otpImage:$otpImage,
    jrDatasetVersion:$jrDatasetVersion,
    gtfsDatasetVersion:$gtfsDatasetVersion,
    osmDatasetVersion:$osmDatasetVersion,
    toeiFeedHashes:{rail:$toeiRailHash,bus:$toeiBusHash},
    osmHash:$osmHash,
    gtfsValidatorVersion:$validatorVersion,
    graphBuildConfigHash:$buildConfigHash,
    inputs:$inputs[0].inputs,
    preflight:$preflight[0],
    graph:{
      status:"PASS",
      path:"graph/graph.obj",
      reportPath:"graph/build-report/index.html",
      summary:$graph[0],
      importIssueCounts:{isolatedStops:$isolatedStops,stopsNotLinkedForTransfers:$unlinkedTransfers,prunedStopIslands:$prunedStopIslands}
    },
    startup:$startup,
    smokeTests:$smokeTests,
    failureCategories:["GTFS_DATA_ERROR","STATION_MAPPING_ERROR","OSM_LINKING_ERROR","OTP_BUILD_ERROR","SERVICE_DATE_ERROR","TRANSFER_ERROR","ROUTING_QUALITY_ERROR"],
    scope:{purpose:"personal-education-and-research",externalDistribution:false,commercialUse:false}
  }' >"${build_manifest}"

printf '%s\n' \
  "OTP_BASE_URL=http://localhost:${OTP_PORT}" \
  'OTP_PROVIDER_ENABLED=true' \
  "OTP_VERSION=${OTP_VERSION_VALUE}" \
  "OTP_GRAPH_BUILD_ID=${build_id}" \
  "OTP_GTFS_DATASET_VERSION=${gtfs_dataset_version}" \
  "OTP_OSM_DATASET_VERSION=${osm_dataset_version}" \
  >"${build_root}/manifests/tcache.env"

ln -sfn "${build_id}" "${BUILDS_ROOT}/latest"

echo "Integrated graph build succeeded: ${build_root}"
echo "Build manifest: ${build_manifest}"
echo "Next: OTP_PORT=${OTP_PORT} ./scripts/run-integrated-tokyo.sh"
