#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command unzip

required_files=(agency.txt stops.txt routes.txt trips.txt stop_times.txt)

inspect_feed() {
  local feed="$1"
  local name
  local entry
  name="$(basename "${feed}")"

  echo
  echo "${name}"
  echo "  bytes: $(file_size "${feed}")"
  echo "  sha256: $(sha256_file "${feed}")"

  for entry in "${required_files[@]}"; do
    if ! unzip -Z1 "${feed}" | sed 's#^\./##' | grep -qx "${entry}"; then
      echo "  ERROR: missing ${entry}" >&2
      return 1
    fi
  done

  echo "  agencies:"
  unzip -p "${feed}" agency.txt | tr -d '\r' | sed -n '1,6p' | sed 's/^/    /'

  if unzip -Z1 "${feed}" | sed 's#^\./##' | grep -qx 'feed_info.txt'; then
    echo "  feed_info:"
    unzip -p "${feed}" feed_info.txt | tr -d '\r' | sed -n '1,6p' | sed 's/^/    /'
  fi

  if unzip -Z1 "${feed}" | sed 's#^\./##' | grep -qx 'calendar.txt'; then
    echo "  calendar date bounds:"
    unzip -p "${feed}" calendar.txt | tr -d '\r' | awk -F, '
      NR == 1 {
        for (i = 1; i <= NF; i++) {
          if ($i == "start_date") start = i
          if ($i == "end_date") end = i
        }
        next
      }
      start && end {
        if (min == "" || $start < min) min = $start
        if ($end > max) max = $end
      }
      END { print "    " min " .. " max }
    '
  fi

  echo "  rows:"
  for entry in stops.txt routes.txt trips.txt stop_times.txt; do
    rows="$(unzip -p "${feed}" "${entry}" | awk 'END { print (NR > 0 ? NR - 1 : 0) }')"
    echo "    ${entry}: ${rows}"
  done
}

if [[ -f "${DATA_DIR}/tokyo.osm.pbf" ]]; then
  echo "tokyo.osm.pbf"
  echo "  bytes: $(file_size "${DATA_DIR}/tokyo.osm.pbf")"
  echo "  sha256: $(sha256_file "${DATA_DIR}/tokyo.osm.pbf")"
else
  echo "Missing ${DATA_DIR}/tokyo.osm.pbf" >&2
  exit 1
fi

feeds=("${DATA_DIR}"/*-gtfs.zip)
if [[ ! -e "${feeds[0]}" ]]; then
  echo "No GTFS feeds found in ${DATA_DIR}" >&2
  exit 1
fi

for feed in "${feeds[@]}"; do
  inspect_feed "${feed}"
done
