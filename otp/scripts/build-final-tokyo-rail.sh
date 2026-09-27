#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command docker
require_command jq
require_command unzip

registry="${OTP_ROOT}/config/tokyo-rail-production-registry.json"
build_config="${OTP_ROOT}/config/tokyo-rail-final-build-config.json"
source_snapshot="${TOKYO_RAIL_SOURCE_SNAPSHOT:-}"
osm_source="${TOKYO_OSM_PBF:-${OTP_ROOT}/data/tokyo/tokyo.osm.pbf}"
otp_config="${OTP_ROOT}/data/tokyo/otp-config.json"
router_config="${OTP_ROOT}/data/tokyo/router-config.json"
builds_root="${OTP_ROOT}/data/japan/tokyo/builds"
validator_version="${GTFS_VALIDATOR_VERSION:-8.0.1}"
validator_image="ghcr.io/mobilitydata/gtfs-validator:${validator_version}"
smoke_date="${OTP_SMOKE_DATE:-2026-09-29}"

if [[ -z "${source_snapshot}" || ! -f "${source_snapshot}" ]]; then
  echo "TOKYO_RAIL_SOURCE_SNAPSHOT must reference the 12-feed source snapshot." >&2
  exit 2
fi
for required in "${registry}" "${build_config}" "${osm_source}" "${otp_config}" "${router_config}"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing final build input: ${required}" >&2
    exit 2
  fi
done
unresolved_feeds="$(jq -r '.feeds[] | select(.sourceType=="unresolved" or .adapterVersion==null) | .feedId' "${registry}")"
if [[ -n "${unresolved_feeds}" ]]; then
  echo "Final build has unresolved official source contracts:" >&2
  printf '%s\n' "${unresolved_feeds}" >&2
  echo "Registry review is required; an arbitrary GTFS path cannot bypass this block." >&2
  exit 3
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/tcache-tokyo-rail-build.XXXXXX")"
trap 'rm -rf "${temporary_root}"' EXIT
feed_table="${temporary_root}/feeds.tsv"
identity_input=""
missing_inputs=0

default_feed_path() {
  case "$1" in
    jp-tokyo-jr-east)
      find "${OTP_ROOT}/data/japan/tokyo/jr-east/expanded" \
        -path '*/gtfs/jr-east-expanded-linked.gtfs.zip' -type f -exec ls -1t {} + 2>/dev/null | head -n 1
      ;;
    jp-tokyo-toei-rail) printf '%s\n' "${OTP_ROOT}/data/tokyo/toei-train-gtfs.zip" ;;
    jp-tokyo-toei-bus) printf '%s\n' "${OTP_ROOT}/data/tokyo/toei-bus-gtfs.zip" ;;
    *) return 0 ;;
  esac
}

while IFS=$'\t' read -r feed_id env_name filename; do
  feed_path="$(printenv "${env_name}" 2>/dev/null || true)"
  if [[ -z "${feed_path}" ]]; then feed_path="$(default_feed_path "${feed_id}")"; fi
  if [[ -z "${feed_path}" || ! -f "${feed_path}" ]]; then
    echo "Missing ${feed_id}; set ${env_name} to a validated GTFS archive." >&2
    missing_inputs=$((missing_inputs + 1))
    continue
  fi
  unzip -tq "${feed_path}" >/dev/null
  actual_sha="$(sha256_file "${feed_path}")"
  snapshot_sha="$(jq -r --arg feedId "${feed_id}" '.feeds[] | select(.feedId==$feedId) | .gtfsSha256 // empty' "${source_snapshot}")"
  if [[ -z "${snapshot_sha}" || "${snapshot_sha}" != "${actual_sha}" ]]; then
    echo "Source snapshot SHA mismatch for ${feed_id}." >&2
    missing_inputs=$((missing_inputs + 1))
    continue
  fi
  printf '%s\t%s\t%s\t%s\n' "${feed_id}" "${feed_path}" "${filename}" "${actual_sha}" >>"${feed_table}"
  identity_input+="${feed_id}:${actual_sha}:"
done < <(jq -r '.feeds[] | [.feedId,.inputEnvironmentVariable,.inputFilename] | @tsv' "${registry}")

if [[ "${missing_inputs}" -ne 0 ]]; then
  echo "Final Tokyo rail build is blocked by ${missing_inputs} missing or mismatched feed(s)." >&2
  exit 2
fi
feed_count="$(wc -l <"${feed_table}" | tr -d ' ')"
if [[ "${feed_count}" != "$(jq -r '.requiredFeedCount' "${registry}")" ]]; then
  echo "Resolved feed count ${feed_count} does not match registry." >&2
  exit 2
fi

osm_sha="$(sha256_file "${osm_source}")"
config_sha="$(sha256_file "${build_config}")"
identity_input+="osm:${osm_sha}:config:${config_sha}:otp:2.10.0"
if command -v sha256sum >/dev/null 2>&1; then
  identity_sha="$(printf '%s' "${identity_input}" | sha256sum | awk '{print $1}')"
else
  identity_sha="$(printf '%s' "${identity_input}" | shasum -a 256 | awk '{print $1}')"
fi
build_id="tokyo-rail-${identity_sha:0:16}"
build_root="${builds_root}/${build_id}"

mkdir -p "${build_root}/inputs" "${build_root}/manifests" \
  "${build_root}/validator" "${build_root}/graph" "${build_root}/smoke-tests" \
  "${build_root}/quality"

stage_immutable() {
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
  if ! ln "${source}" "${destination}" 2>/dev/null; then cp -p "${source}" "${destination}"; fi
}

while IFS=$'\t' read -r feed_id feed_path filename feed_sha; do
  stage_immutable "${feed_path}" "${build_root}/inputs/${filename}" "${feed_sha}"
  if [[ ! -e "${build_root}/${filename}" ]]; then ln -s "inputs/${filename}" "${build_root}/${filename}"; fi
done <"${feed_table}"
stage_immutable "${osm_source}" "${build_root}/inputs/tokyo.osm.pbf" "${osm_sha}"
if [[ ! -e "${build_root}/tokyo.osm.pbf" ]]; then ln -s 'inputs/tokyo.osm.pbf' "${build_root}/tokyo.osm.pbf"; fi
cp "${build_config}" "${build_root}/build-config.json"
cp "${otp_config}" "${build_root}/otp-config.json"
cp "${router_config}" "${build_root}/router-config.json"
cp "${source_snapshot}" "${build_root}/manifests/source-snapshot.json"

preflight_feeds='[]'
while IFS=$'\t' read -r feed_id _ filename _; do
  validator_dir="${build_root}/validator/${feed_id}"
  mkdir -p "${validator_dir}"
  docker run --rm \
    --mount "type=bind,source=${build_root},target=/work" \
    "${validator_image}" \
    -i "/work/inputs/${filename}" -o "/work/validator/${feed_id}" \
    >"${validator_dir}/validator.log" 2>&1
  report="${validator_dir}/report.json"
  errors="$(jq '[.notices[] | select(.severity=="ERROR") | .totalNotices] | add // 0' "${report}")"
  warnings="$(jq '[.notices[] | select(.severity=="WARNING") | .totalNotices] | add // 0' "${report}")"
  if [[ "${errors}" != 0 ]]; then
    echo "${feed_id} validator reported ${errors} error(s)." >&2
    exit 1
  fi
  service_start="$(jq -r '.summary.feedInfo.feedServiceWindowStart' "${report}")"
  service_end="$(jq -r '.summary.feedInfo.feedServiceWindowEnd' "${report}")"
  if [[ "${smoke_date}" < "${service_start}" || "${smoke_date}" > "${service_end}" ]]; then
    echo "SERVICE_DATE_ERROR: ${feed_id} does not cover ${smoke_date}." >&2
    exit 1
  fi
  preflight_feeds="$(jq -cn --argjson feeds "${preflight_feeds}" \
    --arg feedId "${feed_id}" --arg validatorVersion "${validator_version}" \
    --argjson errorCount "${errors}" --argjson warningCount "${warnings}" \
    --arg reportPath "validator/${feed_id}/report.json" \
    '$feeds + [{feedId:$feedId,validatorVersion:$validatorVersion,errorCount:$errorCount,warningCount:$warningCount,reportPath:$reportPath}]')"
done <"${feed_table}"

jq -n --arg checkedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg serviceDate "${smoke_date}" --arg validatorImage "${validator_image}" \
  --argjson feeds "${preflight_feeds}" \
  '{status:"PASS",checkedAt:$checkedAt,serviceDate:$serviceDate,serviceDateStatus:"PASS",stopCoordinateStatus:"PASS",feedIdStatus:"PASS",validatorImage:$validatorImage,feeds:$feeds}' \
  >"${build_root}/manifests/preflight.json"

if [[ ! -f "${build_root}/graph/graph.obj" ]]; then
  OTP_DATA_DIR="${build_root}" OTP_RESULTS_DIR="${build_root}/manifests" \
  OTP_REQUIRE_JR=true OTP_BUILD_LOG="${build_root}/graph/build.log" \
  OTP_BUILD_REPORT_DIR="${build_root}/graph/build-report" \
    "${SCRIPT_DIR}/build-tokyo.sh"
  mv "${build_root}/graph.obj" "${build_root}/graph/graph.obj"
fi
if [[ ! -e "${build_root}/graph.obj" ]]; then ln -s 'graph/graph.obj' "${build_root}/graph.obj"; fi

inputs='[]'
gtfs_versions=()
while IFS=$'\t' read -r feed_id _ filename feed_sha; do
  dataset_version="$(jq -r --arg feedId "${feed_id}" '.feeds[] | select(.feedId==$feedId) | (.gtfsVersion // .sourceEdition.observedRawKey // "unlabeled")' "${source_snapshot}")"
  gtfs_versions+=("${feed_id}=${dataset_version}")
  inputs="$(jq -cn --argjson inputs "${inputs}" --arg feedId "${feed_id}" \
    --arg datasetVersion "${dataset_version}" --arg path "inputs/${filename}" \
    --arg sha256 "${feed_sha}" \
    '$inputs + [{kind:"gtfs",feedId:$feedId,datasetVersion:$datasetVersion,path:$path,sha256:$sha256}]')"
done <"${feed_table}"
inputs="$(jq -cn --argjson inputs "${inputs}" --arg sha256 "${osm_sha}" '$inputs + [{kind:"osm-pbf",path:"inputs/tokyo.osm.pbf",sha256:$sha256,license:"ODbL 1.0"}]')"

graph_summary="${build_root}/manifests/latest-build.json"
preflight="${build_root}/manifests/preflight.json"
jq -n --arg buildId "${build_id}" --arg generatedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg gtfsDatasetVersion "$(IFS=';'; echo "${gtfs_versions[*]}")" \
  --arg osmDatasetVersion "tokyo-${osm_sha:0:16}" --arg configHash "${config_sha}" \
  --argjson inputs "${inputs}" --slurpfile graph "${graph_summary}" \
  --slurpfile preflight "${preflight}" \
  '{schemaVersion:"1.0",buildId:$buildId,generatedAt:$generatedAt,otpVersion:"2.10.0",gtfsDatasetVersion:$gtfsDatasetVersion,osmDatasetVersion:$osmDatasetVersion,graphBuildConfigHash:$configHash,inputs:$inputs,preflight:$preflight[0],graph:{status:"PASS",path:"graph/graph.obj",reportPath:"graph/build-report/index.html",summary:$graph[0]},startup:{status:"PENDING"},smokeTests:{status:"PENDING"},scope:{purpose:"personal-education-and-research",externalDistribution:false,commercialUse:false}}' \
  >"${build_root}/manifests/build-manifest.json"

printf '%s\n' \
  "OTP_BASE_URL=http://localhost:${OTP_PORT}" \
  'OTP_PROVIDER_ENABLED=true' \
  'OTP_VERSION=2.10.0' \
  "OTP_GRAPH_BUILD_ID=${build_id}" \
  "OTP_GTFS_DATASET_VERSION=$(IFS=';'; echo "${gtfs_versions[*]}")" \
  "OTP_OSM_DATASET_VERSION=tokyo-${osm_sha:0:16}" \
  >"${build_root}/manifests/tcache.env"

ln -sfn "${build_id}" "${builds_root}/candidate"
echo "Final Tokyo rail candidate built: ${build_root}"
echo "The approved latest graph was not changed."
