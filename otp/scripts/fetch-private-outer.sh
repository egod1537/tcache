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
  echo "ODPT_CHALLENGE_KEY is required for the Challenge 2026 private-outer sources." >&2
  exit 2
fi

requested_operator="${PRIVATE_OUTER_OPERATOR:-available}"
case "${requested_operator}" in
  available|keikyu|seibu|tobu|sotetsu) ;;
  keisei|all)
    echo "Keisei is TYPE_D: no verified official train-level machine source is registered." >&2
    echo "Use PRIVATE_OUTER_OPERATOR=available to collect the four supported official sources." >&2
    exit 3
    ;;
  *) echo "PRIVATE_OUTER_OPERATOR must be available, keikyu, seibu, tobu, sotetsu, keisei, or all." >&2; exit 2 ;;
esac

data_root="${OTP_ROOT}/data/japan/tokyo/private-outer"
requested_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/tcache-private-outer.XXXXXX")"
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

fetch_gtfs() {
  local operator_id="$1"
  local source_url="$2"
  local filename="$3"
  local operator_tmp="${temporary_root}/${operator_id}"
  mkdir -p "${operator_tmp}"
  curl --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-delay 2 \
    --connect-timeout 15 --max-time 300 \
    --user-agent 'tcache-tokyo-otp-private-research/1.0' \
    --get --data-urlencode "acl:consumerKey=${challenge_key}" \
    --output "${operator_tmp}/${filename}" "${source_url}"
  unzip -tq "${operator_tmp}/${filename}" >/dev/null
  node "${OTP_ROOT}/tools/transfers/inspect-private-gtfs.mjs" \
    --profile "${operator_id}" --feed "${operator_tmp}/${filename}" \
    --output "${temporary_root}/${operator_id}-inspection.json" >/dev/null
}

fetch_odpt_operator() {
  local operator_id="$1"
  local source_operator="$2"
  local operator_tmp="${temporary_root}/${operator_id}"
  local base_url='https://api-challenge.odpt.org/api/v4'
  mkdir -p "${operator_tmp}"
  fetch_json "${operator_tmp}/railways.json" "${base_url}/odpt:Railway?odpt:operator=${source_operator}"
  fetch_json "${operator_tmp}/stations.json" "${base_url}/odpt:Station?odpt:operator=${source_operator}"
  fetch_json "${operator_tmp}/station-timetables.json" "${base_url}/odpt:StationTimetable?odpt:operator=${source_operator}"
}

if [[ "${requested_operator}" == available || "${requested_operator}" == keikyu ]]; then
  fetch_odpt_operator keikyu 'odpt.Operator:Keikyu'
fi
if [[ "${requested_operator}" == available || "${requested_operator}" == seibu ]]; then
  fetch_odpt_operator seibu 'odpt.Operator:Seibu'
fi
if [[ "${requested_operator}" == available || "${requested_operator}" == tobu ]]; then
  fetch_gtfs tobu 'https://api-challenge.odpt.org/api/v4/files/Tobu/data/Tobu-Train-GTFS.zip' 'Tobu-Train-GTFS.zip'
fi
if [[ "${requested_operator}" == available || "${requested_operator}" == sotetsu ]]; then
  fetch_gtfs sotetsu 'https://api-challenge.odpt.org/api/v4/files/Sotetsu/data/Sotetsu-Train-GTFS.zip' 'Sotetsu-Train-GTFS.zip'
fi

promote_operator() {
  local operator_id="$1"
  local source_type="$2"
  local source_operator="$3"
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
  if [[ "${source_type}" == official-gtfs ]]; then
    edition_key="$(unzip -p "${operator_tmp}"/*.zip feed_info.txt 2>/dev/null | tr -d '\r' | awk -F, 'NR == 2 {print $6}')"
  else
    edition_key="$(jq -rs '[.[][]["dc:date"]? | select(type == "string")] | max // empty' "${operator_tmp}"/*.json)"
  fi
  edition_key="${edition_key:-challenge-2026-unlabeled}"
  if [[ -d "${destination}" ]]; then
    ln -sfn "${collection_id}" "${data_root}/${operator_id}/latest"
    echo "Reusing immutable ${operator_id} collection: ${destination}"
    return
  fi
  mkdir -p "${destination}/raw"
  cp -p "${operator_tmp}"/* "${destination}/raw/"
  local artifacts='[]'
  local artifact_file
  while IFS= read -r artifact_file; do
    local filename sha bytes source_url content_type artifact_type
    filename="$(basename "${artifact_file}")"
    sha="$(sha256_file "${artifact_file}")"
    bytes="$(file_size "${artifact_file}")"
    case "${filename}" in
      railways.json)
        source_url="https://api-challenge.odpt.org/api/v4/odpt:Railway?odpt:operator=${source_operator}"
        content_type='application/json'; artifact_type='odpt:Railway' ;;
      stations.json)
        source_url="https://api-challenge.odpt.org/api/v4/odpt:Station?odpt:operator=${source_operator}"
        content_type='application/json'; artifact_type='odpt:Station' ;;
      station-timetables.json)
        source_url="https://api-challenge.odpt.org/api/v4/odpt:StationTimetable?odpt:operator=${source_operator}"
        content_type='application/json'; artifact_type='odpt:StationTimetable' ;;
      Tobu-Train-GTFS.zip)
        source_url='https://api-challenge.odpt.org/api/v4/files/Tobu/data/Tobu-Train-GTFS.zip'
        content_type='application/zip'; artifact_type='official-gtfs' ;;
      Sotetsu-Train-GTFS.zip)
        source_url='https://api-challenge.odpt.org/api/v4/files/Sotetsu/data/Sotetsu-Train-GTFS.zip'
        content_type='application/zip'; artifact_type='official-gtfs' ;;
      *) echo "Unexpected artifact ${filename}" >&2; exit 1 ;;
    esac
    artifacts="$(jq -cn --argjson current "${artifacts}" \
      --arg filename "${filename}" --arg sourceUrl "${source_url}" \
      --arg requestedAt "${requested_at}" --arg contentType "${content_type}" \
      --arg sha256 "${sha}" --argjson bytes "${bytes}" \
      --arg sourceEdition "${edition_key}" --arg sourceType "${artifact_type}" \
      --arg operator "${operator_id}" \
      '$current + [{filename:$filename,sourceUrl:$sourceUrl,requestedAt:$requestedAt,httpStatus:200,contentType:$contentType,sha256:$sha256,bytes:$bytes,sourceEdition:$sourceEdition,sourceType:$sourceType,operator:$operator,collectorVersion:"private-outer-collector/1.0.0"}]')"
  done < <(find "${destination}/raw" -type f | sort)
  jq -n --arg operator "${operator_id}" --arg collectionId "${collection_id}" \
    --arg requestedAt "${requested_at}" --arg sourceEdition "${edition_key}" \
    --arg sourceType "${source_type}" --argjson artifacts "${artifacts}" \
    '{schemaVersion:"1.0",operator:$operator,collectionId:$collectionId,requestedAt:$requestedAt,sourceEdition:{observedRawKey:$sourceEdition,humanReadableLabel:null},sourceType:$sourceType,collectorVersion:"private-outer-collector/1.0.0",credentialStored:false,artifacts:$artifacts,scope:{purpose:"personal-education-and-research",externalDistribution:false,commercialUse:false}}' \
    >"${destination}/manifest.json"
  if [[ -f "${temporary_root}/${operator_id}-inspection.json" ]]; then
    cp -p "${temporary_root}/${operator_id}-inspection.json" "${destination}/source-contract.json"
  fi
  ln -sfn "${collection_id}" "${data_root}/${operator_id}/latest"
  echo "Stored immutable ${operator_id} collection: ${destination}"
}

if [[ -d "${temporary_root}/keikyu" ]]; then promote_operator keikyu official-api-json 'odpt.Operator:Keikyu'; fi
if [[ -d "${temporary_root}/seibu" ]]; then promote_operator seibu official-api-json 'odpt.Operator:Seibu'; fi
if [[ -d "${temporary_root}/tobu" ]]; then promote_operator tobu official-gtfs ''; fi
if [[ -d "${temporary_root}/sotetsu" ]]; then promote_operator sotetsu official-gtfs ''; fi

echo "Keisei remains TYPE_D and was not replaced with an unofficial feed."
