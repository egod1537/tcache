#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command curl
require_command jq

wait_for_otp 5 1

departure_time="${OTP_DEPARTURE_TIME:-$(TZ=Asia/Tokyo date '+%Y-%m-%dT10:00:00+09:00')}"
itinerary_count="${OTP_ITINERARY_COUNT:-3}"
run_id="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
run_dir="${RESULTS_DIR}/${run_id}"
mkdir -p "${run_dir}"

query="$(<"${OTP_ROOT}/queries/plan-tokyo.graphql")"

routes=(
  "tokyo-station-to-shibuya|Tokyo Station|35.6812362|139.7671248|Shibuya|35.6580339|139.7016358"
  "tokyo-station-to-shinjuku|Tokyo Station|35.6812362|139.7671248|Shinjuku|35.6909210|139.7002580"
  "shinjuku-to-asakusa|Shinjuku|35.6909210|139.7002580|Asakusa|35.7100630|139.8107000"
  "ueno-to-shibuya|Ueno|35.7137680|139.7772540|Shibuya|35.6580339|139.7016358"
  "tokyo-station-to-tokyo-tower|Tokyo Station|35.6812362|139.7671248|Tokyo Tower|35.6585810|139.7454330"
)

printf 'route\tlatency_ms\titineraries\tduration_seconds\twalk_seconds\ttransfers\toperators\n' >"${run_dir}/summary.tsv"

for route in "${routes[@]}"; do
  IFS='|' read -r slug origin_name origin_lat origin_lon destination_name destination_lat destination_lon <<<"${route}"
  request_file="${run_dir}/${slug}.request.json"
  response_file="${run_dir}/${slug}.response.json"
  curl_metrics_file="${run_dir}/${slug}.curl-metrics.txt"

  jq -n \
    --arg query "${query}" \
    --arg originName "${origin_name}" \
    --argjson originLat "${origin_lat}" \
    --argjson originLon "${origin_lon}" \
    --arg destinationName "${destination_name}" \
    --argjson destinationLat "${destination_lat}" \
    --argjson destinationLon "${destination_lon}" \
    --arg departureTime "${departure_time}" \
    --argjson first "${itinerary_count}" \
    '{
      operationName: "PlanTokyo",
      query: $query,
      variables: {
        origin: {
          label: $originName,
          location: {coordinate: {latitude: $originLat, longitude: $originLon}}
        },
        destination: {
          label: $destinationName,
          location: {coordinate: {latitude: $destinationLat, longitude: $destinationLon}}
        },
        dateTime: {earliestDeparture: $departureTime},
        first: $first
      }
    }' >"${request_file}"

  echo "Querying ${origin_name} -> ${destination_name} at ${departure_time}"
  curl --fail-with-body --silent --show-error \
    --header 'Content-Type: application/json' \
    --header 'Accept-Language: en' \
    --header 'OTPTimeout: 180000' \
    --data-binary "@${request_file}" \
    --output "${response_file}.tmp" \
    --write-out '%{time_total}' \
    "${GRAPHQL_URL}" >"${curl_metrics_file}"

  jq . "${response_file}.tmp" >"${response_file}"
  rm "${response_file}.tmp"

  if jq -e '.errors | length > 0' "${response_file}" >/dev/null 2>&1; then
    jq '.errors' "${response_file}" >&2
    exit 1
  fi

  latency_ms="$(awk '{printf "%d", $1 * 1000}' "${curl_metrics_file}")"
  itinerary_total="$(jq '.data.planConnection.edges | length' "${response_file}")"
  duration="$(jq -r '.data.planConnection.edges[0].node.duration // ""' "${response_file}")"
  walk_time="$(jq -r '.data.planConnection.edges[0].node.walkTime // ""' "${response_file}")"
  transfers="$(jq -r '.data.planConnection.edges[0].node.numberOfTransfers // ""' "${response_file}")"
  operators="$(jq -r '[.data.planConnection.edges[0].node.legs[]?.agency.name] | map(select(. != null)) | unique | join(", ")' "${response_file}")"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${slug}" "${latency_ms}" "${itinerary_total}" "${duration}" "${walk_time}" "${transfers}" "${operators}" \
    >>"${run_dir}/summary.tsv"
done

jq -Rn \
  '[inputs | split("\t")] as $rows |
   ($rows[0]) as $headers |
   [$rows[1:][] | [[$headers, .] | transpose[] | {(.[0]): .[1]}] | add]' \
  <"${run_dir}/summary.tsv" >"${run_dir}/summary.json"

ln -sfn "${run_id}" "${RESULTS_DIR}/latest"

echo
if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "${run_dir}/summary.tsv"
else
  cat "${run_dir}/summary.tsv"
fi
echo
echo "Requests, responses, and summary saved to ${run_dir}"
