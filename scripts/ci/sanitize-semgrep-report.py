import json
import sys
from typing import Any


def quoted(value: Any) -> str:
    if not isinstance(value, (int, str)):
        value = "<malformed>"
    return json.dumps(value, ensure_ascii=True)


def fail(message: str) -> int:
    print(f"semgrep-check: {message}", file=sys.stderr)
    return 2


def main() -> int:
    if len(sys.argv) != 3:
        return fail("report sanitizer received invalid arguments.")

    try:
        scanner_status = int(sys.argv[2])
    except ValueError:
        return fail("scanner exit status is malformed.")
    if scanner_status < 0 or scanner_status > 255:
        return fail("scanner exit status is out of range.")

    try:
        with open(sys.argv[1], encoding="utf-8") as handle:
            report = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return fail("scanner report is missing or malformed.")

    if not isinstance(report, dict):
        return fail("scanner report root is malformed.")

    results = report.get("results")
    errors = report.get("errors")
    paths = report.get("paths")
    if (
        not isinstance(results, list)
        or not isinstance(errors, list)
        or not isinstance(paths, dict)
        or not isinstance(paths.get("scanned"), list)
    ):
        return fail("scanner report schema is malformed.")

    skipped = paths.get("skipped", [])
    if not isinstance(skipped, list):
        return fail("scanner skip report is malformed.")

    malformed = False
    if results:
        print(f"semgrep-check: {len(results)} blocking finding(s):", file=sys.stderr)
    for result in results:
        if not isinstance(result, dict):
            malformed = True
            continue
        start = result.get("start")
        extra = result.get("extra")
        if not isinstance(start, dict) or not isinstance(extra, dict):
            malformed = True
            continue
        print(
            "  "
            f"rule={quoted(result.get('check_id'))} "
            f"path={quoted(result.get('path'))} "
            f"line={quoted(start.get('line'))} "
            f"column={quoted(start.get('col'))} "
            f"severity={quoted(extra.get('severity'))}",
            file=sys.stderr,
        )

    if errors:
        print(f"semgrep-check: {len(errors)} scanner error(s):", file=sys.stderr)
    for error in errors:
        if not isinstance(error, dict):
            malformed = True
            continue
        error_line: Any = None
        error_column: Any = None
        spans = error.get("spans")
        if isinstance(spans, list) and spans and isinstance(spans[0], dict):
            start = spans[0].get("start")
            if isinstance(start, dict):
                error_line = start.get("line")
                error_column = start.get("col")
        print(
            "  "
            f"type={quoted(error.get('type'))} "
            f"code={quoted(error.get('code'))} "
            f"level={quoted(error.get('level'))} "
            f"path={quoted(error.get('path'))} "
            f"line={quoted(error_line)} "
            f"column={quoted(error_column)}",
            file=sys.stderr,
        )

    if skipped:
        print(
            f"semgrep-check: {len(skipped)} supported target(s) were skipped:",
            file=sys.stderr,
        )
    for entry in skipped:
        if not isinstance(entry, dict):
            malformed = True
            continue
        print(
            "  "
            f"path={quoted(entry.get('path'))} "
            f"reason={quoted(entry.get('reason'))}",
            file=sys.stderr,
        )

    if malformed:
        return fail("scanner report contains malformed entries.")
    if skipped:
        return 1
    if (results or errors) and scanner_status == 0:
        return fail("scanner returned success with blocking report entries.")

    print(
        "semgrep-check: "
        f"{len(paths['scanned'])} targets, "
        f"{len(results)} findings, "
        f"{len(errors)} errors, "
        f"{len(skipped)} skipped."
    )
    return scanner_status


if __name__ == "__main__":
    raise SystemExit(main())
