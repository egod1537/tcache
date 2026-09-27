#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command jq
require_command node

builds_root="${OTP_ROOT}/data/japan/tokyo/builds"
candidate_root="${TOKYO_RAIL_CANDIDATE_ROOT:-${builds_root}/candidate}"
candidate_root="$(cd "${candidate_root}" && pwd -P)"
manifest="${candidate_root}/manifests/build-manifest.json"
source_snapshot="${TOKYO_RAIL_SOURCE_SNAPSHOT:-${candidate_root}/manifests/source-snapshot.json}"
source_baseline="${TOKYO_RAIL_SOURCE_BASELINE:-${OTP_ROOT}/baselines/tokyo-rail-sources.json}"
production_baseline="${TOKYO_RAIL_PRODUCTION_BASELINE:-${OTP_ROOT}/baselines/tokyo-rail-production.json}"

if [[ ! -f "${candidate_root}/graph/graph.obj" || ! -f "${manifest}" ]]; then
  echo "Missing final Tokyo rail candidate graph or manifest: ${candidate_root}" >&2
  exit 1
fi
if [[ ! -f "${source_snapshot}" || ! -f "${source_baseline}" ]]; then
  echo "Final promotion requires a source snapshot and explicitly approved source baseline." >&2
  echo "Candidate remains unapproved; latest is unchanged." >&2
  exit 1
fi

previous_root=""
if [[ -e "${builds_root}/latest" ]]; then
  previous_root="$(cd "${builds_root}/latest" && pwd -P)"
fi

rollback_runtime() {
  local status=$?
  if [[ "${status}" -ne 0 ]]; then
    echo "Final Tokyo rail gate failed; latest symlink was not changed." >&2
    if [[ -n "${previous_root}" && "${previous_root}" != "${candidate_root}" ]]; then
      TOKYO_RAIL_CANDIDATE_ROOT="${previous_root}" OTP_INTEGRATED_BUILD_ROOT="${previous_root}" \
        OTP_PORT="${OTP_PORT}" "${SCRIPT_DIR}/run-integrated-tokyo.sh" || true
    fi
  fi
  return "${status}"
}
trap rollback_runtime EXIT

final_regression="${candidate_root}/manifests/tokyo-rail-regression-suite.json"
collector_config="${candidate_root}/manifests/production-linking-collector.json"

node "${OTP_ROOT}/tools/quality/assemble-regression-suite.mjs" \
  --config "${OTP_ROOT}/config/tokyo-rail-regression-sources.json" \
  --output "${final_regression}"

node "${OTP_ROOT}/tools/quality/check-source-changes.mjs" \
  --registry "${OTP_ROOT}/config/tokyo-rail-production-registry.json" \
  --policy "${OTP_ROOT}/config/tokyo-rail-source-change-policy.json" \
  --snapshot "${source_snapshot}" \
  --baseline "${source_baseline}" \
  --output "${candidate_root}/quality/source-change.json"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" OTP_PORT="${OTP_PORT}" \
  "${SCRIPT_DIR}/run-integrated-tokyo.sh"

node "${OTP_ROOT}/tools/linking/diagnose.mjs" \
  --build-root "${candidate_root}"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" OTP_PORT="${OTP_PORT}" \
OTP_INTEGRATED_SMOKE_CONFIG="${final_regression}" \
  "${SCRIPT_DIR}/smoke-integrated-tokyo.sh"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" OTP_BASE_URL="${OTP_URL}" \
  "${SCRIPT_DIR}/check-transfer-quality.sh"

node "${OTP_ROOT}/tools/quality/collect-performance.mjs" \
  --build-root "${candidate_root}"

node "${OTP_ROOT}/tools/quality/build-production-collector-config.mjs" \
  --registry "${OTP_ROOT}/config/tokyo-rail-production-registry.json" \
  --station-review "${OTP_ROOT}/config/station-complex-review.json" \
  --output "${collector_config}"

node "${OTP_ROOT}/tools/quality/collect-quality.mjs" \
  --build-root "${candidate_root}" \
  --config "${collector_config}"

node "${OTP_ROOT}/tools/quality/generate-coverage-report.mjs" \
  --build-root "${candidate_root}" \
  --registry "${OTP_ROOT}/config/tokyo-rail-production-registry.json"

if [[ ! -f "${production_baseline}" ]]; then
  echo "All candidate metrics were generated, but no approved production baseline exists." >&2
  echo "Review the candidate, then run capture-production-baseline with reviewer identity and reference." >&2
  echo "latest was not changed." >&2
  exit 4
fi

node "${OTP_ROOT}/tools/quality/evaluate-production-readiness.mjs" \
  --build-root "${candidate_root}" \
  --config "${OTP_ROOT}/config/tokyo-rail-production-gate.json" \
  --baseline "${production_baseline}"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" \
  "${SCRIPT_DIR}/approve-integrated-candidate.sh"

trap - EXIT
echo "Final 12-feed Tokyo rail candidate passed and was promoted to latest."
