#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command jq
require_command node

builds_root="${OTP_ROOT}/data/japan/tokyo/builds"
candidate_root="${OTP_INTEGRATED_BUILD_ROOT:-${builds_root}/candidate}"
candidate_root="$(cd "${candidate_root}" && pwd -P)"
base_url="${OTP_URL}"

if [[ ! -f "${candidate_root}/graph/graph.obj" ]]; then
  echo "Missing candidate graph: ${candidate_root}" >&2
  exit 1
fi

previous_root=""
if [[ -e "${builds_root}/latest" ]]; then
  previous_root="$(cd "${builds_root}/latest" && pwd -P)"
fi

rollback_runtime() {
  local status=$?
  if [[ "${status}" -ne 0 ]]; then
    echo "Quality gate failed; approved latest symlink was not changed." >&2
    if [[ -n "${previous_root}" && "${previous_root}" != "${candidate_root}" ]]; then
      echo "Restoring previously approved runtime: ${previous_root}" >&2
      OTP_INTEGRATED_BUILD_ROOT="${previous_root}" OTP_PORT="${OTP_PORT}" \
        "${SCRIPT_DIR}/run-integrated-tokyo.sh" || true
    fi
  fi
  return "${status}"
}
trap rollback_runtime EXIT

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" OTP_PORT="${OTP_PORT}" \
  "${SCRIPT_DIR}/run-integrated-tokyo.sh"

node "${OTP_ROOT}/tools/linking/diagnose.mjs" \
  --build-root "${candidate_root}"

combined_smoke_config="${candidate_root}/manifests/integrated-smoke-with-metro.json"
jq -s \
  '{schemaVersion:"1.0",departureTime:.[0].departureTime,itineraryCount:([.[].itineraryCount]|max),routes:([.[].routes[]])}' \
  "${OTP_ROOT}/config/integrated-smoke-tests.json" \
  "${OTP_ROOT}/config/tokyo-metro-smoke-tests.json" \
  >"${combined_smoke_config}"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" OTP_PORT="${OTP_PORT}" \
OTP_INTEGRATED_SMOKE_CONFIG="${combined_smoke_config}" \
  "${SCRIPT_DIR}/smoke-integrated-tokyo.sh"

node "${OTP_ROOT}/tools/quality/collect-performance.mjs" \
  --build-root "${candidate_root}"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" OTP_BASE_URL="${base_url}" \
  "${SCRIPT_DIR}/check-transfer-quality.sh"

node "${OTP_ROOT}/tools/quality/collect-quality.mjs" \
  --build-root "${candidate_root}" \
  --config "${OTP_ROOT}/config/linking-transfer-quality-gate.json"

node "${OTP_ROOT}/tools/quality/evaluate-quality-gate.mjs" \
  --build-root "${candidate_root}" \
  --config "${OTP_ROOT}/config/linking-transfer-quality-gate.json"

OTP_INTEGRATED_BUILD_ROOT="${candidate_root}" \
  "${SCRIPT_DIR}/approve-integrated-candidate.sh"
trap - EXIT

echo "Candidate passed the production quality gate and is approved."
