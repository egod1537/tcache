#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command curl
require_command jq
require_command node

build_root="${OTP_INTEGRATED_BUILD_ROOT:-${OTP_ROOT}/data/japan/tokyo/builds/latest}"
build_root="$(cd "${build_root}" && pwd)"
manifest="${build_root}/manifests/build-manifest.json"
test_config="${OTP_INTEGRATED_SMOKE_CONFIG:-${OTP_ROOT}/config/integrated-smoke-tests.json}"

if [[ ! -f "${manifest}" || ! -f "${test_config}" ]]; then
  echo "Missing integrated build manifest or smoke configuration." >&2
  exit 1
fi

wait_for_otp 10 1

departure_time="${OTP_SMOKE_DEPARTURE_TIME:-$(jq -r '.departureTime' "${test_config}")}"
itinerary_count="$(jq -r '.itineraryCount' "${test_config}")"
query="$(<"${OTP_ROOT}/queries/plan-tokyo.graphql")"
run_id="$(date -u '+%Y%m%dT%H%M%SZ')"
run_dir="${build_root}/smoke-tests/${run_id}"
mkdir -p "${run_dir}/results"

route_count="$(jq '.routes | length' "${test_config}")"
for ((index = 0; index < route_count; index++)); do
  route_file="${run_dir}/route-${index}.json"
  request_file="${run_dir}/route-${index}.request.json"
  response_file="${run_dir}/route-${index}.response.json"
  result_file="${run_dir}/results/route-${index}.json"
  jq ".routes[${index}]" "${test_config}" >"${route_file}"
  route_id="$(jq -r '.id' "${route_file}")"

  jq -n \
    --arg query "${query}" \
    --arg originName "$(jq -r '.origin.name' "${route_file}")" \
    --argjson originLat "$(jq '.origin.latitude' "${route_file}")" \
    --argjson originLon "$(jq '.origin.longitude' "${route_file}")" \
    --arg destinationName "$(jq -r '.destination.name' "${route_file}")" \
    --argjson destinationLat "$(jq '.destination.latitude' "${route_file}")" \
    --argjson destinationLon "$(jq '.destination.longitude' "${route_file}")" \
    --arg departureTime "${departure_time}" \
    --argjson first "${itinerary_count}" \
    '{
      operationName:"PlanTokyo",
      query:$query,
      variables:{
        origin:{label:$originName,location:{coordinate:{latitude:$originLat,longitude:$originLon}}},
        destination:{label:$destinationName,location:{coordinate:{latitude:$destinationLat,longitude:$destinationLon}}},
        dateTime:{earliestDeparture:$departureTime},
        first:$first
      }
    }' >"${request_file}"

  echo "Smoke ${route_id}"
  curl --fail-with-body --silent --show-error \
    --header 'Content-Type: application/json' \
    --header 'Accept-Language: en' \
    --header 'OTPTimeout: 180000' \
    --data-binary "@${request_file}" \
    --output "${response_file}" \
    "${GRAPHQL_URL}"

  node "${SCRIPT_DIR}/evaluate-integrated-smoke.mjs" \
    "${route_file}" "${response_file}" "${result_file}"
done

summary="${run_dir}/summary.json"
jq -s \
  --arg generatedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg departureTime "${departure_time}" \
  '{
    generatedAt:$generatedAt,
    departureTime:$departureTime,
    status:(if all(.[]; .status=="PASS") then "PASS" else "FAIL" end),
    passed:([.[]|select(.status=="PASS")]|length),
    failed:([.[]|select(.status=="FAIL")]|length),
    results:.
  }' "${run_dir}"/results/*.json >"${summary}"

report="${run_dir}/report.md"
{
  printf '# Tokyo JR East + Toei OTP smoke test\n\n'
  printf -- '- Departure: `%s`\n' "${departure_time}"
  printf -- '- Status: **%s**\n' "$(jq -r '.status' "${summary}")"
  printf -- '- Passed: %s; failed: %s\n\n' "$(jq '.passed' "${summary}")" "$(jq '.failed' "${summary}")"
  printf '| Test | Category | Status | Duration | Transfers | Feeds | Failure |\n'
  printf '| --- | --- | --- | ---: | ---: | --- | --- |\n'
  jq -r '.results[] | "| \(.id) | \(.category) | \(.status) | \(.durationSeconds // "—") | \(.transfers // "—") | \((.feeds // []) | join(" + ")) | \(.failureCategory // "") |"' "${summary}"
  printf '\nEach passing itinerary has positive duration, ordered legs, transit stops, identifiable agency/feed IDs, and the category-specific feed composition.\n'
} >"${report}"

latest_link="${build_root}/smoke-tests/latest"
ln -sfn "${run_id}" "${latest_link}"

temporary_manifest="${manifest}.tmp.$$"
jq \
  --arg reportPath "smoke-tests/${run_id}/report.md" \
  --arg summaryPath "smoke-tests/${run_id}/summary.json" \
  --slurpfile smoke "${summary}" \
  '.smokeTests = {status:$smoke[0].status,passed:$smoke[0].passed,failed:$smoke[0].failed,departureTime:$smoke[0].departureTime,reportPath:$reportPath,summaryPath:$summaryPath}' \
  "${manifest}" >"${temporary_manifest}"
mv "${temporary_manifest}" "${manifest}"

cat "${report}"
if [[ "$(jq -r '.status' "${summary}")" != "PASS" ]]; then
  exit 1
fi
