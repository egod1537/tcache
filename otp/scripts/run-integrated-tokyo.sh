#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

build_root="${OTP_INTEGRATED_BUILD_ROOT:-${OTP_ROOT}/data/japan/tokyo/builds/latest}"
build_root="$(cd "${build_root}" && pwd)"
manifest="${build_root}/manifests/build-manifest.json"

if [[ ! -f "${manifest}" || ! -f "${build_root}/graph/graph.obj" ]]; then
  echo "Missing integrated build. Run ./scripts/build-integrated-tokyo.sh first." >&2
  exit 1
fi

OTP_DATA_DIR="${build_root}" \
OTP_RESULTS_DIR="${build_root}/manifests" \
  "${SCRIPT_DIR}/run-tokyo.sh"

runtime_summary="${build_root}/manifests/latest-runtime.json"
temporary_manifest="${manifest}.tmp.$$"
jq \
  --slurpfile runtime "${runtime_summary}" \
  '.startup = {status:"PASS",healthEndpoint:"/otp/actuators/health",graphLoadStatus:"PASS",summary:$runtime[0]}' \
  "${manifest}" >"${temporary_manifest}"
mv "${temporary_manifest}" "${manifest}"

echo "Integrated OTP startup and graph load succeeded."
echo "Build identity environment: ${build_root}/manifests/tcache.env"
