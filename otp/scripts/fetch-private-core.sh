#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command curl
require_command jq
require_command node
require_command unzip

challenge_key="${ODPT_CHALLENGE_KEY:-}"
if [[ -z "${challenge_key}" ]]; then
  echo "ODPT_CHALLENGE_KEY is required for the Challenge 2026 Tokyu, Keio, and Odakyu sources." >&2
  echo "Register at https://developer.odpt.org/ and export the key locally; do not commit it." >&2
  exit 2
fi

requested_operator="${PRIVATE_CORE_OPERATOR:-all}"
case "${requested_operator}" in
  all|tokyu|keio|odakyu) ;;
  *) echo "PRIVATE_CORE_OPERATOR must be all, tokyu, keio, or odakyu." >&2; exit 2 ;;
esac

data_root="${OTP_ROOT}/data/japan/tokyo/private-core"
request_timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/tcache-private-core.XXXXXX")"
trap 'rm -rf "${temporary_root}"' EXIT

fetch_json() {
  local output_file="$1"
  local source_url="$2"
  curl --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-delay 2 \
    --connect-timeout 15 --max-time 180 \
    --user-agent 'tcache-tokyo-otp-private-research/1.0' \
    --get --data-urlencode "acl:consumerKey=${challenge_key}" \
    --output "${output_file}" "${source_url}"
  jq -e 'type == "array" and length > 0' "${output_file}" >/dev/null
}

fetch_zip() {
  local output_file="$1"
  local source_url="$2"
  curl --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-delay 2 \
    --connect-timeout 15 --max-time 300 \
    --user-agent 'tcache-tokyo-otp-private-research/1.0' \
    --get --data-urlencode "acl:consumerKey=${challenge_key}" \
    --output "${output_file}" "${source_url}"
  unzip -tq "${output_file}" >/dev/null
  for required_file in agency.txt stops.txt routes.txt trips.txt stop_times.txt calendar.txt; do
    if ! unzip -Z1 "${output_file}" | tr -d '\r' | grep -Fxq "${required_file}"; then
      echo "Official Keio GTFS is missing ${required_file}." >&2
      exit 1
    fi
  done
}

collect_json_operator() {
  local operator_id="$1"
  local source_operator="$2"
  local operator_tmp="${temporary_root}/${operator_id}"
  mkdir -p "${operator_tmp}"
  local base_url='https://api-challenge.odpt.org/api/v4'
  fetch_json "${operator_tmp}/railways.json" "${base_url}/odpt:Railway?odpt:operator=${source_operator}"
  fetch_json "${operator_tmp}/stations.json" "${base_url}/odpt:Station?odpt:operator=${source_operator}"
  fetch_json "${operator_tmp}/station-timetables.json" "${base_url}/odpt:StationTimetable?odpt:operator=${source_operator}"
}

if [[ "${requested_operator}" == all || "${requested_operator}" == tokyu ]]; then
  collect_json_operator tokyu 'odpt.Operator:Tokyu'
fi
if [[ "${requested_operator}" == all || "${requested_operator}" == odakyu ]]; then
  collect_json_operator odakyu 'odpt.Operator:Odakyu'
fi
if [[ "${requested_operator}" == all || "${requested_operator}" == keio ]]; then
  mkdir -p "${temporary_root}/keio"
  fetch_zip "${temporary_root}/keio/Keio-Train-GTFS.zip" \
    'https://api-challenge.odpt.org/api/v4/files/Keio/data/Keio-Train-GTFS.zip'
  node "${OTP_ROOT}/tools/transfers/inspect-private-gtfs.mjs" \
    --profile keio \
    --feed "${temporary_root}/keio/Keio-Train-GTFS.zip" \
    --output "${temporary_root}/keio-inspection.json" \
    >/dev/null
fi

promote_operator() {
  local operator_id="$1"
  local source_type="$2"
  local operator_tmp="${temporary_root}/${operator_id}"
  local identity_input=''
  local identity_file
  while IFS= read -r identity_file; do
    identity_input+="$(sha256_file "${identity_file}"):"
  done < <(find "${operator_tmp}" -type f | sort)
  local collection_hash
  if command -v sha256sum >/dev/null 2>&1; then
    collection_hash="$(printf '%s' "${identity_input}" | sha256sum | awk '{print $1}')"
  else
    collection_hash="$(printf '%s' "${identity_input}" | shasum -a 256 | awk '{print $1}')"
  fi
  local collection_id="challenge-2026-${collection_hash:0:16}"
  local destination="${data_root}/${operator_id}/${collection_id}"
  local edition_key
  if [[ "${source_type}" == 'official-gtfs' ]]; then
    edition_key="$(unzip -p "${operator_tmp}/Keio-Train-GTFS.zip" feed_info.txt 2>/dev/null | tr -d '\r' | awk -F, 'NR == 2 {print $6}')"
  else
    edition_key="$(jq -rs '[.[][]["dc:date"]? | select(type == "string")] | max // empty' "${operator_tmp}"/*.json)"
  fi
  edition_key="${edition_key:-challenge-2026-unlabeled}"

  if [[ -d "${destination}" ]]; then
    echo "Reusing immutable ${operator_id} collection: ${destination}"
    ln -sfn "${collection_id}" "${data_root}/${operator_id}/latest"
    return
  fi
  mkdir -p "${destination}/raw"
  cp -p "${operator_tmp}"/* "${destination}/raw/"
  local artifacts_json='[]'
  local artifact_file
  local source_operator
  case "${operator_id}" in
    tokyu) source_operator='odpt.Operator:Tokyu' ;;
    odakyu) source_operator='odpt.Operator:Odakyu' ;;
    keio) source_operator='' ;;
  esac
  while IFS= read -r artifact_file; do
    local filename sha bytes source_url content_type artifact_source_type
    filename="$(basename "${artifact_file}")"
    sha="$(sha256_file "${artifact_file}")"
    bytes="$(file_size "${artifact_file}")"
    case "${filename}" in
      railways.json)
        source_url="https://api-challenge.odpt.org/api/v4/odpt:Railway?odpt:operator=${source_operator}"
        content_type='application/json'
        artifact_source_type='odpt:Railway'
        ;;
      stations.json)
        source_url="https://api-challenge.odpt.org/api/v4/odpt:Station?odpt:operator=${source_operator}"
        content_type='application/json'
        artifact_source_type='odpt:Station'
        ;;
      station-timetables.json)
        source_url="https://api-challenge.odpt.org/api/v4/odpt:StationTimetable?odpt:operator=${source_operator}"
        content_type='application/json'
        artifact_source_type='odpt:StationTimetable'
        ;;
      Keio-Train-GTFS.zip)
        source_url="https://api-challenge.odpt.org/api/v4/files/Keio/data/Keio-Train-GTFS.zip"
        content_type='application/zip'
        artifact_source_type='official-gtfs'
        ;;
      *) echo "Unexpected artifact ${filename}" >&2; exit 1 ;;
    esac
    artifacts_json="$(jq -cn \
      --argjson current "${artifacts_json}" \
      --arg filename "${filename}" --arg sourceUrl "${source_url}" \
      --arg requestedAt "${request_timestamp}" \
      --arg contentType "${content_type}" \
      --arg sourceEdition "${edition_key}" \
      --arg sourceType "${artifact_source_type}" \
      --arg operator "${operator_id}" \
      --arg sha256 "${sha}" --argjson bytes "${bytes}" \
      '$current + [{filename:$filename,sourceUrl:$sourceUrl,requestedAt:$requestedAt,httpStatus:200,contentType:$contentType,sha256:$sha256,bytes:$bytes,sourceEdition:$sourceEdition,sourceType:$sourceType,operator:$operator,collectorVersion:"private-core-collector/1.0.0"}]')"
  done < <(find "${destination}/raw" -type f | sort)

  jq -n \
    --arg operator "${operator_id}" \
    --arg collectionId "${collection_id}" \
    --arg requestedAt "${request_timestamp}" \
    --arg sourceEdition "${edition_key}" \
    --arg sourceType "${source_type}" \
    --argjson artifacts "${artifacts_json}" \
    '{schemaVersion:"1.0",operator:$operator,collectionId:$collectionId,requestedAt:$requestedAt,sourceEdition:{observedRawKey:$sourceEdition,humanReadableLabel:null},sourceType:$sourceType,collectorVersion:"private-core-collector/1.0.0",credentialStored:false,artifacts:$artifacts,scope:{purpose:"personal-education-and-research",externalDistribution:false,commercialUse:false}}' \
    >"${destination}/manifest.json"
  if [[ "${operator_id}" == keio ]]; then
    cp -p "${temporary_root}/keio-inspection.json" \
      "${destination}/source-contract.json"
  fi
  ln -sfn "${collection_id}" "${data_root}/${operator_id}/latest"
  echo "Stored immutable ${operator_id} collection: ${destination}"
}

if [[ -d "${temporary_root}/tokyu" ]]; then promote_operator tokyu 'official-api-json'; fi
if [[ -d "${temporary_root}/keio" ]]; then promote_operator keio 'official-gtfs'; fi
if [[ -d "${temporary_root}/odakyu" ]]; then promote_operator odakyu 'official-api-json'; fi
