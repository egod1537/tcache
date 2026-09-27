#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command jq

builds_root="${OTP_ROOT}/data/japan/tokyo/builds"
candidate_root="${OTP_INTEGRATED_BUILD_ROOT:-${builds_root}/candidate}"
candidate_root="$(cd "${candidate_root}" && pwd -P)"
manifest="${candidate_root}/manifests/build-manifest.json"
gate_result="${candidate_root}/quality/gate-result.json"

if [[ ! -f "${manifest}" || ! -f "${gate_result}" ]]; then
  echo "Candidate has no build manifest or quality gate result: ${candidate_root}" >&2
  exit 1
fi

if [[ "$(jq -r '.status' "${gate_result}")" != "PASS" ]] || \
  [[ "$(jq -r '.candidateApprovalAllowed' "${gate_result}")" != "true" ]]; then
  echo "Candidate quality gate is not PASS; latest graph is unchanged." >&2
  exit 1
fi

build_id="$(jq -r '.buildId' "${manifest}")"
if [[ "${candidate_root}" != "${builds_root}/${build_id}" ]]; then
  echo "Candidate path/build ID mismatch: ${candidate_root} vs ${build_id}" >&2
  exit 1
fi

previous_build_id=""
if [[ -e "${builds_root}/latest" ]]; then
  previous_build_id="$(basename "$(cd "${builds_root}/latest" && pwd -P)")"
fi

approved_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
temporary_manifest="${manifest}.tmp.$$"
jq \
  --arg approvedAt "${approved_at}" \
  --arg previousBuildId "${previous_build_id}" \
  '.candidate = {
    status:"APPROVED",
    approvedAt:$approvedAt,
    previousApprovedBuildId:(if $previousBuildId == "" then null else $previousBuildId end)
  }' \
  "${manifest}" >"${temporary_manifest}"
mv "${temporary_manifest}" "${manifest}"

quality="${candidate_root}/quality/linking-quality.json"
transfer="${candidate_root}/quality/transfer-quality.json"
gate="${candidate_root}/quality/gate-result.json"
coverage="${candidate_root}/quality/coverage.json"
identity_env="${candidate_root}/manifests/tcache.env"
temporary_env="${identity_env}.tmp.$$"
awk '!/^OTP_QUALITY_GATE_STATUS=|^OTP_TOTAL_STOP_COUNT=|^OTP_LINKED_STOP_COUNT=|^OTP_ISOLATED_STOP_COUNT=|^OTP_ISOLATED_STOP_RATIO=|^OTP_UNLINKED_TRANSFER_COUNT=|^OTP_UNLINKED_TRANSFER_RATIO=|^OTP_PRUNED_STOP_ISLAND_COUNT=|^OTP_SNAPPING_DISTANCE_P50_METERS=|^OTP_SNAPPING_DISTANCE_P95_METERS=|^OTP_SNAPPING_DISTANCE_MAX_METERS=|^OTP_CROSS_FEED_STATION_COMPLEX_COUNT=|^OTP_SMOKE_PASS_RATE=|^OTP_TRANSFER_REGRESSION_PASS_RATE=|^OTP_BASELINE_UNLINKED_DELTA=|^OTP_BASELINE_PRUNED_DELTA=|^OTP_FEED_STATUS_JSON=/' \
  "${identity_env}" >"${temporary_env}"
printf '%s\n' \
  "OTP_QUALITY_GATE_STATUS=PASS" \
  "OTP_TOTAL_STOP_COUNT=$(jq -r '.totalStops' "${quality}")" \
  "OTP_LINKED_STOP_COUNT=$(jq -r '.linkedStops' "${quality}")" \
  "OTP_ISOLATED_STOP_COUNT=$(jq -r '.isolatedStops' "${quality}")" \
  "OTP_ISOLATED_STOP_RATIO=$(jq -r '.isolatedStopRatio' "${quality}")" \
  "OTP_UNLINKED_TRANSFER_COUNT=$(jq -r '.unlinkedTransferStops' "${quality}")" \
  "OTP_UNLINKED_TRANSFER_RATIO=$(jq -r '.unlinkedTransferRatio' "${quality}")" \
  "OTP_PRUNED_STOP_ISLAND_COUNT=$(jq -r '.prunedStopIslands' "${quality}")" \
  "OTP_SNAPPING_DISTANCE_P50_METERS=$(jq -r '.osmSnappingDistanceMeters.all.p50' "${quality}")" \
  "OTP_SNAPPING_DISTANCE_P95_METERS=$(jq -r '.osmSnappingDistanceMeters.all.p95' "${quality}")" \
  "OTP_SNAPPING_DISTANCE_MAX_METERS=$(jq -r '.osmSnappingDistanceMeters.all.max' "${quality}")" \
  "OTP_CROSS_FEED_STATION_COMPLEX_COUNT=$(jq -r '.crossFeedTransferStationCount' "${transfer}")" \
  "OTP_SMOKE_PASS_RATE=$(jq -r '.smokeTests.passRate' "${transfer}")" \
  "OTP_TRANSFER_REGRESSION_PASS_RATE=$(jq -r '.transferRegression.passRate' "${transfer}")" \
  >>"${temporary_env}"
baseline_unlinked_delta="$(jq -r '.deltas.unlinkedTransferStops.delta // empty' "${gate}")"
baseline_pruned_delta="$(jq -r '.deltas.prunedStopIslands.delta // empty' "${gate}")"
if [[ -n "${baseline_unlinked_delta}" ]]; then
  printf 'OTP_BASELINE_UNLINKED_DELTA=%s\n' "${baseline_unlinked_delta}" >>"${temporary_env}"
fi
if [[ -n "${baseline_pruned_delta}" ]]; then
  printf 'OTP_BASELINE_PRUNED_DELTA=%s\n' "${baseline_pruned_delta}" >>"${temporary_env}"
fi
if [[ -f "${coverage}" ]]; then
  printf "OTP_FEED_STATUS_JSON='%s'\n" "$(jq -c '.feedStatuses' "${coverage}")" >>"${temporary_env}"
fi
mv "${temporary_env}" "${identity_env}"

ln -sfn "${build_id}" "${builds_root}/latest"

echo "Approved candidate ${build_id}."
echo "Previous approved build: ${previous_build_id:-none}"
echo "Latest graph: ${builds_root}/latest"
