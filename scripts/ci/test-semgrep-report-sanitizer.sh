#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
sanitizer="${script_dir}/sanitize-semgrep-report.py"
tmp_parent="${TMPDIR:-/tmp}"
fixture_root="$(mktemp -d "${tmp_parent%/}/authowl-semgrep-sanitizer.XXXXXX")"
redaction_marker='AUTHOWL_REDACTION_''PROOF_DO_NOT_PRINT'

cleanup() {
  if [[ -n "${fixture_root}" &&
        -d "${fixture_root}" &&
        "$(basename "${fixture_root}")" == authowl-semgrep-sanitizer.* ]]; then
    rm -rf -- "${fixture_root}"
  fi
}
trap cleanup EXIT

python3 -I - "${fixture_root}/report.json" "${redaction_marker}" <<'PY'
import json
import sys

report_path, marker = sys.argv[1:]
report = {
    "results": [
        {
            "check_id": "proof.secret-rule",
            "path": "src/proof.ts",
            "start": {"line": 7, "col": 3},
            "extra": {
                "severity": "ERROR",
                "lines": f'const secret = "{marker}";',
                "message": f"detected {marker}",
                "metavars": {"$SECRET": {"abstract_content": marker}},
            },
        }
    ],
    "errors": [
        {
            "type": "ParseError",
            "code": 3,
            "level": "error",
            "path": "src/proof.ts",
            "message": f"failed near {marker}",
        }
    ],
    "paths": {"scanned": ["src/proof.ts"]},
}
with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle)

skipped_report = {
    "results": [],
    "errors": [],
    "paths": {
        "scanned": ["src/proof.ts"],
        "skipped": [{"path": "src/skipped.ts", "reason": "semgrepignore_patterns_match"}],
    },
}
with open(f"{report_path}.skipped", "w", encoding="utf-8") as handle:
    json.dump(skipped_report, handle)

malformed_report = {
    "results": [],
    "errors": [],
    "paths": {"scanned": ["src/proof.ts"], "skipped": {"path": marker}},
}
with open(f"{report_path}.malformed", "w", encoding="utf-8") as handle:
    json.dump(malformed_report, handle)

clean_report = {
    "results": [],
    "errors": [],
    "paths": {"scanned": ["src/proof.ts"]},
}
with open(f"{report_path}.clean", "w", encoding="utf-8") as handle:
    json.dump(clean_report, handle)
PY

set +e
output="$(
  python3 -I "${sanitizer}" "${fixture_root}/report.json" 1 2>&1
)"
finding_status=$?
set -e
if [[ "${finding_status}" -ne 1 ]]; then
  echo 'semgrep-sanitizer-test: finding status was not preserved.' >&2
  exit 1
fi
if grep -Fq "${redaction_marker}" <<<"${output}"; then
  echo 'semgrep-sanitizer-test: matched source escaped into output.' >&2
  exit 1
fi
for expected in \
  'rule="proof.secret-rule"' \
  'path="src/proof.ts"' \
  'line=7' \
  'column=3' \
  'severity="ERROR"'; do
  if ! grep -Fq "${expected}" <<<"${output}"; then
    printf 'semgrep-sanitizer-test: missing safe field %s\n' "${expected}" >&2
    exit 1
  fi
done

set +e
skipped_output="$(
  python3 -I "${sanitizer}" "${fixture_root}/report.json.skipped" 0 2>&1
)"
skipped_status=$?
malformed_output="$(
  python3 -I "${sanitizer}" "${fixture_root}/report.json.malformed" 0 2>&1
)"
malformed_status=$?
failure_output="$(
  python3 -I "${sanitizer}" "${fixture_root}/report.json.clean" 3 2>&1
)"
failure_status=$?
set -e

if [[ "${skipped_status}" -ne 1 ]] ||
   ! grep -Fq 'supported target(s) were skipped' <<<"${skipped_output}"; then
  echo 'semgrep-sanitizer-test: skipped target did not fail closed.' >&2
  exit 1
fi
if [[ "${malformed_status}" -ne 2 ]] ||
   ! grep -Fq 'scanner skip report is malformed' <<<"${malformed_output}"; then
  echo 'semgrep-sanitizer-test: malformed skip report did not fail closed.' >&2
  exit 1
fi
if grep -Fq "${redaction_marker}" <<<"${malformed_output}"; then
  echo 'semgrep-sanitizer-test: malformed report leaked private content.' >&2
  exit 1
fi
if [[ "${failure_status}" -ne 3 ]] ||
   ! grep -Fq '0 findings, 0 errors, 0 skipped' <<<"${failure_output}"; then
  echo 'semgrep-sanitizer-test: scanner failure status was not preserved.' >&2
  exit 1
fi

for shadowed_module in json typing; do
  shadow_root="${fixture_root}/shadow-${shadowed_module}"
  mkdir -p "${shadow_root}"
  cp "${sanitizer}" "${shadow_root}/sanitize-semgrep-report.py"
  printf 'print("%s")\nraise RuntimeError("shadow imported")\n' \
    "${redaction_marker}" > "${shadow_root}/${shadowed_module}.py"

  set +e
  shadow_output="$(
    python3 -I \
      "${shadow_root}/sanitize-semgrep-report.py" \
      "${fixture_root}/report.json" \
      1 2>&1
  )"
  shadow_status=$?
  set -e

  if [[ "${shadow_status}" -ne 1 ]] ||
     grep -Fq "${redaction_marker}" <<<"${shadow_output}"; then
    printf 'semgrep-sanitizer-test: isolated import failed for %s.\n' \
      "${shadowed_module}" >&2
    exit 1
  fi
done

echo 'semgrep-sanitizer-test: matched source stayed private.'
