#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command docker

for required in tokyo.osm.pbf toei-train-gtfs.zip toei-bus-gtfs.zip; do
  if [[ ! -f "${DATA_DIR}/${required}" ]]; then
    echo "Missing ${DATA_DIR}/${required}. Run ./scripts/download-tokyo-data.sh first." >&2
    exit 1
  fi
done

mkdir -p "${RESULTS_DIR}"
build_started_epoch="$(date +%s)"
build_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
build_container="tcache-otp-tokyo-build-$$"
memory_samples="${RESULTS_DIR}/latest-build-memory.tsv"
monitor_flag="$(mktemp "${TMPDIR:-/tmp}/tcache-otp-build.XXXXXX")"

printf 'timestamp\tmemory_mib\n' >"${memory_samples}"

monitor_memory() {
  local usage
  local memory_mib
  while [[ -f "${monitor_flag}" ]]; do
    usage="$(docker stats --no-stream --format '{{.MemUsage}}' "${build_container}" 2>/dev/null | awk '{print $1}' || true)"
    if [[ -n "${usage}" ]]; then
      memory_mib="$(awk -v value="${usage}" 'BEGIN {
        if (value ~ /GiB$/) multiplier = 1024
        else if (value ~ /KiB$/) multiplier = 1 / 1024
        else multiplier = 1
        gsub(/[^0-9.]/, "", value)
        printf "%.2f", value * multiplier
      }')"
      printf '%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${memory_mib}" >>"${memory_samples}"
    fi
    sleep 2
  done
}

monitor_memory &
monitor_pid="$!"

echo "Building Tokyo graph with ${OTP_IMAGE:-${OTP_IMAGE_DEFAULT}}"
echo "Build output is also saved to data/tokyo/build.log"

set +e
docker_compose --profile build run --rm --name "${build_container}" otp-build 2>&1 | tee "${DATA_DIR}/build.log"
build_status="${PIPESTATUS[0]}"
set -e

rm -f "${monitor_flag}"
wait "${monitor_pid}" 2>/dev/null || true

build_finished_epoch="$(date +%s)"
build_finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
build_duration="$((build_finished_epoch - build_started_epoch))"

if [[ "${build_status}" -ne 0 ]]; then
  echo "OTP graph build failed with exit code ${build_status}. Inspect data/tokyo/build.log." >&2
  exit "${build_status}"
fi

if [[ ! -f "${DATA_DIR}/graph.obj" ]]; then
  echo "OTP exited successfully but graph.obj was not created." >&2
  exit 1
fi

summary_file="${RESULTS_DIR}/latest-build.json"
peak_memory_mib="$(awk 'NR > 1 && $2 + 0 > max { max = $2 + 0 } END { printf "%.2f", max }' "${memory_samples}")"
jq -n \
  --arg startedAt "${build_started_at}" \
  --arg finishedAt "${build_finished_at}" \
  --argjson durationSeconds "${build_duration}" \
  --argjson graphBytes "$(file_size "${DATA_DIR}/graph.obj")" \
  --argjson approximatePeakMemoryMiB "${peak_memory_mib}" \
  --arg graphSha256 "$(sha256_file "${DATA_DIR}/graph.obj")" \
  --arg image "${OTP_IMAGE:-${OTP_IMAGE_DEFAULT}}" \
  '{
    image: $image,
    startedAt: $startedAt,
    finishedAt: $finishedAt,
    durationSeconds: $durationSeconds,
    approximatePeakMemoryMiB: $approximatePeakMemoryMiB,
    graphBytes: $graphBytes,
    graphSha256: $graphSha256
  }' >"${summary_file}"

echo "Graph build succeeded in ${build_duration}s."
echo "graph.obj: $(file_size "${DATA_DIR}/graph.obj") bytes"
echo "Import report: ${DATA_DIR}/build-report"
