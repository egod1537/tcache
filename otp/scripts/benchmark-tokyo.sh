#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_command awk
require_command jq

rounds="${OTP_BENCHMARK_ROUNDS:-5}"
if ! [[ "${rounds}" =~ ^[1-9][0-9]*$ ]]; then
  echo "OTP_BENCHMARK_ROUNDS must be a positive integer." >&2
  exit 1
fi

benchmark_id="benchmark-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
benchmark_dir="${RESULTS_DIR}/${benchmark_id}"
all_samples="${benchmark_dir}/samples.tsv"
mkdir -p "${benchmark_dir}"
printf 'route\tlatency_ms\n' >"${all_samples}"

for ((round = 1; round <= rounds; round++)); do
  echo "Benchmark round ${round}/${rounds}"
  "${SCRIPT_DIR}/query-tokyo.sh" >/dev/null
  run_dir="${RESULTS_DIR}/$(readlink "${RESULTS_DIR}/latest")"
  awk -F '\t' 'NR > 1 { print $1 "\t" $2 }' "${run_dir}/summary.tsv" >>"${all_samples}"
done

{
  printf 'route\tp50_latency_ms\tsamples\n'
  tail -n +2 "${all_samples}" |
    sort -t $'\t' -k1,1 -k2,2n |
    awk -F '\t' '
      { count[$1]++; value[$1, count[$1]] = $2 }
      END {
        for (route in count) {
          n = count[route]
          if (n % 2) median = value[route, (n + 1) / 2]
          else median = (value[route, n / 2] + value[route, n / 2 + 1]) / 2
          print route "\t" median "\t" n
        }
      }
    ' | sort
} >"${benchmark_dir}/p50.tsv"

tail -n +2 "${all_samples}" | cut -f2 | sort -n | awk '
  { value[NR] = $1 }
  END {
    if (NR % 2) median = value[(NR + 1) / 2]
    else median = (value[NR / 2] + value[NR / 2 + 1]) / 2
    print median
  }
' >"${benchmark_dir}/overall-p50-ms.txt"

if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "${benchmark_dir}/p50.tsv"
else
  cat "${benchmark_dir}/p50.tsv"
fi
echo "Overall p50: $(cat "${benchmark_dir}/overall-p50-ms.txt")ms"
echo "Benchmark artifacts: ${benchmark_dir}"
