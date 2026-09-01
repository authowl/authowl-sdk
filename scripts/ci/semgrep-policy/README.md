# Reviewed Semgrep policy snapshots

These compressed, base64-encoded JSON documents are internal copies of the
Semgrep Registry packs used by AuthOwl's SDK release gate:

- `https://semgrep.dev/c/p/typescript`
- `https://semgrep.dev/c/p/owasp-top-ten`

They were retrieved and reviewed on 2026-09-01. The canonical semantic digests
remain pinned in `scripts/ci/semgrep-check.sh`; the gate decodes each snapshot
inside an isolated private volume, verifies the digest, and scans without
network access.

The copies are used only for AuthOwl's internal security testing under the
[Semgrep Rules License v1.0](https://semgrep.dev/legal/rules-license/). Rule
metadata, including each rule's source and license notice, is preserved
byte-for-byte inside the compressed documents.
