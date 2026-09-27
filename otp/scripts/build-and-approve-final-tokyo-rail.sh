#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/build-final-tokyo-rail.sh"
"${SCRIPT_DIR}/quality-gate-final-tokyo-rail.sh"
