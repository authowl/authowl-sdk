#!/usr/bin/env python3
"""Verify the canonical semantic digest of a bounded Semgrep rules document."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml


SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class StrictSafeLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects aliases and duplicate mapping keys."""

    def compose_node(self, parent: Any, index: Any) -> Any:
        if self.check_event(yaml.AliasEvent):
            raise ValueError("YAML aliases are forbidden")
        return super().compose_node(parent, index)

    def construct_mapping(self, node: Any, deep: bool = False) -> dict[Any, Any]:
        mapping: dict[Any, Any] = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError("mapping keys must be strings")
            if key in mapping:
                raise ValueError("duplicate mapping key")
            mapping[key] = self.construct_object(value_node, deep=deep)
        return mapping


def canonical_bytes(raw_yaml: str) -> bytes:
    document = yaml.load(raw_yaml, Loader=StrictSafeLoader)
    if not isinstance(document, dict):
        raise ValueError("document root must be a mapping")

    rules = document.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValueError("rules must be a non-empty list")

    rule_ids: set[str] = set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise ValueError("every rule must be a mapping")
        rule_id = rule.get("id")
        if not isinstance(rule_id, str) or not rule_id:
            raise ValueError("every rule must have a non-empty string id")
        if rule_id in rule_ids:
            raise ValueError("rule ids must be unique")
        rule_ids.add(rule_id)

    canonical_document = dict(document)
    canonical_document["rules"] = sorted(rules, key=lambda rule: rule["id"])
    return json.dumps(
        canonical_document,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def semantic_digest(raw_yaml: str) -> str:
    return hashlib.sha256(canonical_bytes(raw_yaml)).hexdigest()


def self_test() -> None:
    first = """
rules:
  - id: second
    message: same
    languages: [typescript]
  - id: first
    message: stable
"""
    reordered = """
rules:
  - message: stable
    id: first
  - languages:
      - typescript
    message: same
    id: second
"""
    changed = reordered.replace("message: same", "message: changed")
    duplicate_id = first.replace("id: first", "id: second")
    duplicate_key = first.replace("message: stable", "message: stable\n    message: hidden")
    alias = "shared: &shared stable\nrules:\n  - id: first\n    message: *shared\n"

    assert semantic_digest(first) == semantic_digest(reordered)
    assert semantic_digest(first) != semantic_digest(changed)
    for rejected in (duplicate_id, duplicate_key, alias):
        try:
            semantic_digest(rejected)
        except (TypeError, ValueError, yaml.YAMLError):
            continue
        raise AssertionError("unsafe fixture was accepted")


def main(arguments: list[str]) -> int:
    if arguments == ["--self-test"]:
        self_test()
        print("semgrep-rules-digest: self-test passed.")
        return 0

    if len(arguments) != 2:
        print(
            "Usage: semgrep-rules-digest.py <rules.yml> <expected-sha256>",
            file=sys.stderr,
        )
        return 2

    rules_path = Path(arguments[0])
    expected = arguments[1]
    if SHA256_PATTERN.fullmatch(expected) is None:
        print("semgrep-rules-digest: invalid expected digest.", file=sys.stderr)
        return 2

    try:
        actual = semantic_digest(rules_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, TypeError, ValueError, yaml.YAMLError):
        print("semgrep-rules-digest: invalid rules document.", file=sys.stderr)
        return 1

    if not hmac.compare_digest(actual, expected):
        print("semgrep-rules-digest: policy digest mismatch.", file=sys.stderr)
        return 1

    print(f"{rules_path.name}: canonical policy digest OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
