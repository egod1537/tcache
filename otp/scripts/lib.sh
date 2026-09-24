#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OTP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${OTP_ROOT}/data/tokyo"
RESULTS_DIR="${OTP_ROOT}/results"
COMPOSE_FILE="${OTP_ROOT}/docker-compose.yml"
OTP_PORT="${OTP_PORT:-8080}"
OTP_URL="${OTP_URL:-http://localhost:${OTP_PORT}}"
GRAPHQL_URL="${OTP_URL}/otp/gtfs/v1"
OTP_IMAGE_DEFAULT="docker.io/opentripplanner/opentripplanner:2.10.0@sha256:8d54e5c589186707ee365417f2202dc878c451fa3001b8edff07019531100933"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

file_size() {
  wc -c <"$1" | tr -d ' '
}

docker_compose() {
  docker compose --file "${COMPOSE_FILE}" "$@"
}

wait_for_otp() {
  local attempts="${1:-120}"
  local delay_seconds="${2:-2}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --max-time 2 "${OTP_URL}/otp/actuators/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  echo "OTP did not become healthy at ${OTP_URL} after $((attempts * delay_seconds)) seconds." >&2
  return 1
}
