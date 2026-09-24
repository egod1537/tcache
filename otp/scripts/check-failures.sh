#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command curl
require_command jq

wait_for_otp 5 1
query="$(<"${OTP_ROOT}/queries/plan-tokyo.graphql")"
output_dir="${RESULTS_DIR}/failure-checks"
mkdir -p "${output_dir}"

make_request() {
  local origin_lat="$1"
  local origin_lon="$2"
  local destination_lat="$3"
  local destination_lon="$4"
  local departure="$5"

  jq -n \
    --arg query "${query}" \
    --argjson originLat "${origin_lat}" \
    --argjson originLon "${origin_lon}" \
    --argjson destinationLat "${destination_lat}" \
    --argjson destinationLon "${destination_lon}" \
    --arg departureTime "${departure}" \
    '{
      operationName: "PlanTokyo",
      query: $query,
      variables: {
        origin: {label: "origin", location: {coordinate: {latitude: $originLat, longitude: $originLon}}},
        destination: {label: "destination", location: {coordinate: {latitude: $destinationLat, longitude: $destinationLon}}},
        dateTime: {earliestDeparture: $departureTime},
        first: 1
      }
    }'
}

run_case() {
  local name="$1"
  local request="$2"
  printf '%s' "${request}" >"${output_dir}/${name}.request.json"
  curl --silent --show-error \
    --header 'Content-Type: application/json' \
    --data-binary "@${output_dir}/${name}.request.json" \
    "${GRAPHQL_URL}" | jq . >"${output_dir}/${name}.response.json"
  echo "${name}: $(jq -c '{errors: .errors, routingErrors: .data.planConnection.routingErrors, itineraries: (.data.planConnection.edges | length)}' "${output_dir}/${name}.response.json")"
}

run_case "outside-graph" "$(make_request 34.6937 135.5023 34.7025 135.4959 '2026-09-25T10:00:00+09:00')"
run_case "outside-service-period" "$(make_request 35.6812362 139.7671248 35.7100630 139.8107000 '2035-01-01T10:00:00+09:00')"
run_case "no-route-window" "$(make_request 35.6812362 139.7671248 35.6580339 139.7016358 '2026-09-25T02:00:00+09:00')"

echo "Missing-feed behavior is verified by moving one GTFS file aside and rebuilding; the build script refuses a missing required feed before invoking OTP."
echo "Server-exit behavior: docker compose -f docker-compose.yml stop otp, then confirm the GraphQL request fails."
