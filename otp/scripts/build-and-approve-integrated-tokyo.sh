#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/build-integrated-tokyo.sh"
"${SCRIPT_DIR}/quality-gate-integrated-tokyo.sh"
