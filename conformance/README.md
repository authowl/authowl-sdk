# AuthOwl SDK conformance corpus

One set of vectors. Every implementation gives the same answer, or CI fails.

`vectors/` is the **single source of truth** for the security primitives every
AuthOwl SDK must implement identically, in every language. Each SDK re-verifies
the committed vectors from scratch in its own test framework, so `has()` fails
closed the same way in TypeScript, Go, Python, PHP, Rust, and Dart/Flutter.

## What is covered

| File | Cases | Covers |
|---|--:|---|
| `jwt-verify.json` | 38 | ES256 verification: signature, `iss`/`aud`/`exp`/`nbf`, `alg` confusion, malformed structure, membership decoding |
| `jwks-parse.json` | 20 | JWKS hardening: private-member leakage, `key_ops`, unexpected members, wrong curve, duplicate `kid`, key-count ceiling |
| `webhook-verify.json` | 26 | HMAC-SHA256 signatures, rotation overlap, replay window, malformed headers, config errors |
| `membership-has.json` | 20 | `has()` / `hasPermission()`, AND semantics, the teams-absent rule |
| `publishable-key.json` | 14 | Key decoding, the `sk_` refusal, and project-id canonicalisation |
| `cookie-name.json` | 7 | Session cookie-name derivation |
| | **125** | |

## The invariants worth stating out loud

These are the cases most likely to be got wrong by a well-meaning
reimplementation, which is exactly why they are pinned:

- **Check order is contractual.** Structure → algorithm → key → signature →
  claims. A token with a bad signature *and* an expired `exp` must report
  `TOKEN_SIGNATURE_INVALID`, never `TOKEN_CLAIM_INVALID`. Reporting a claim
  error first tells an attacker their forgery got as far as claim evaluation.
- **`alg` is pinned before key resolution.** That is what makes `alg: none` and
  the HS256-confusion attack structurally impossible rather than merely unlikely.
- **`exp` and `iss` are required, not skip-if-absent.** A token with no expiry
  would never fail closed on its own.
- **An absent `teams` claim is not "any team".** A token minted before teams
  shipped must never satisfy a `teamId` query.
- **Untrusted input degrades to `false`; local misconfiguration raises.** A bad
  signature is a quiet `false`. A malformed *secret* is a loud error — an
  endpoint silently dropping every delivery is far worse to debug.
- **`sk_` is refused before any shape validation.** A secret key must never be
  reported as merely "malformed": the fix is to rotate it, not correct a typo.
- **The project id is lowercased, at the decoder AND at the cookie name.** Every
  key grammar accepts `[0-9a-fA-F-]` in the uuid segment, so a case-mangled key
  is structurally VALID. The server's id is a Postgres `uuid` and always renders
  lowercase, so a verbatim mixed-case id names a cookie nothing ever set and
  fails every byte-comparison against a JWT `aud` or a public-config
  `environmentId`. It is pinned in both places because a caller can reach a
  project id without going through the decoder at all: `@authowl/next` splits the
  publishable key itself in two separate entry points.

## Running it

```bash
bash scripts/ci/conformance-all.sh      # every SDK that has a toolchain present
```

Or one at a time:

```bash
pnpm --filter @authowl/core exec vitest run src/conformance.test.ts
cd sdks/go     && go test ./...
cd sdks/python && pytest
cd sdks/php    && ./vendor/bin/phpunit
cd sdks/rust   && cargo test
cd sdks/flutter && flutter test
```

## If a case fails

**Fix the implementation, not the vector.** A failing case means that SDK has
diverged from behaviour the other SDKs already agree on.

Change a vector only when the *contract itself* is changing — and when it is,
regenerate, re-run every suite in the same PR, and say so in the commit
message. A vector edited to make one language pass is a silent security
regression in that language.

## Regenerating

```bash
node conformance/generate.mjs
```

The vectors are a **committed artifact**, not a build output. Regenerating mints
fresh ECDSA signatures (ECDSA is randomised), so the JSON changes on every run
even when nothing semantic did — that is expected and harmless, because
correctness is established by the seven suites re-verifying the committed bytes,
not by byte-comparing a regeneration. Regenerate only when adding or changing
cases.

The signing keys in `generate.mjs` are fixed and committed on purpose: vectors
must be reproducible across languages, so the key cannot be ephemeral. They sign
nothing but these fixtures.

## Adding an SDK

1. Implement the six primitives.
2. Load `conformance/vectors/*.json` in that language's test framework.
3. Assert the **exact error code strings** — they are contractual across SDKs, so
   a log line means the same thing everywhere.
4. Map the language's error types onto the portable `reason` names
   (`missing` / `secret_key` / `malformed`) rather than inventing new ones.
5. Add it to `scripts/ci/conformance-all.sh` and the CI matrix.

The reference implementation is `packages/auth-core` — when a vector and the
docs disagree, read `src/token-verify.ts`.
