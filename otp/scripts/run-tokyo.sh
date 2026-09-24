#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command docker
require_command curl

if [[ ! -f "${DATA_DIR}/graph.obj" ]]; then
  echo "Missing ${DATA_DIR}/graph.obj. Run ./scripts/build-tokyo.sh first." >&2
  exit 1
fi

echo "Starting OTP at ${OTP_URL}"
startup_started_epoch="$(date +%s)"
startup_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
docker_compose up --detach otp

if ! wait_for_otp 120 2; then
  docker_compose logs --tail 200 otp >&2
  exit 1
fi

startup_finished_epoch="$(date +%s)"
startup_finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
startup_duration="$((startup_finished_epoch - startup_started_epoch))"
container_id="$(docker_compose ps --quiet otp)"
memory_usage="$(docker stats --no-stream --format '{{.MemUsage}}' "${container_id}" | awk '{print $1}')"

mkdir -p "${RESULTS_DIR}"
jq -n \
  --arg startedAt "${startup_started_at}" \
  --arg readyAt "${startup_finished_at}" \
  --argjson startupDurationSeconds "${startup_duration}" \
  --arg idleMemoryObserved "${memory_usage}" \
  --arg otpUrl "${OTP_URL}" \
  --arg image "${OTP_IMAGE:-${OTP_IMAGE_DEFAULT}}" \
  '{
    image: $image,
    otpUrl: $otpUrl,
    startedAt: $startedAt,
    readyAt: $readyAt,
    startupDurationSeconds: $startupDurationSeconds,
    idleMemoryObserved: $idleMemoryObserved
  }' >"${RESULTS_DIR}/latest-runtime.json"

echo "OTP is ready."
echo "Startup: ${startup_duration}s; observed memory: ${memory_usage}"
echo "GraphiQL: ${OTP_URL}/graphiql"
echo "GraphQL: ${GRAPHQL_URL}"
