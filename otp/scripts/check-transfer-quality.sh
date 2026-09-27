#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command node

build_root="${OTP_INTEGRATED_BUILD_ROOT:-${OTP_ROOT}/data/japan/tokyo/builds/latest}"
base_url="${OTP_BASE_URL:-http://localhost:${OTP_PORT}}"

node "${OTP_ROOT}/tools/transfers/build-station-complexes.mjs" \
  --build-root "${build_root}" \
  --review-config "${OTP_ROOT}/config/station-complex-review.json"

node "${OTP_ROOT}/tools/transfers/run-transfer-regression.mjs" \
  --build-root "${build_root}" \
  --base-url "${base_url}" \
  --cases "${OTP_ROOT}/config/transfer-regression-suite.json" \
  --query "${OTP_ROOT}/queries/plan-tokyo.graphql"

node "${OTP_ROOT}/tools/transfers/validate-complex-walks.mjs" \
  --build-root "${build_root}" \
  --base-url "${base_url}" \
  --query "${OTP_ROOT}/queries/walk-station-complex.graphql"

node "${OTP_ROOT}/tools/transfers/report-transfer-quality.mjs" \
  --build-root "${build_root}"
