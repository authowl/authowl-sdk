# Provider import fixtures

All people, identifiers, domains, metadata, and timestamps in this directory are
synthetic. Password values are public test hashes and are not customer
credentials.

Compatibility baseline, verified 2026-07-16:

- `clerk-dashboard-export.csv` follows the Clerk Dashboard CSV headers published
  in Clerk's official migration-tool sample: `id`, profile fields, verified and
  unverified identifiers, `password_digest`, and `password_hasher`.
- `clerk-dashboard-export.json` follows the official Clerk migration-tool JSON
  sample, which is a top-level user array.
- `auth0-management-export.ndjson` follows the Auth0 Management API v2
  JSON-compatible bulk export. Auth0 emits one JSON object per line.
- `auth0-converted-export.json` follows Auth0's documented conversion of that
  NDJSON to a JSON array. Its password fields represent the separately merged
  password-hash data described by Auth0. Standard Auth0 exports do not include
  password hashes.
- `firebase-auth-export.json` and `.csv` follow Firebase CLI `auth:export`.
  The JSON file uses the documented top-level `users` array and the CSV uses
  the documented 26 positional columns. `firebase-hash-config.json` uses
  Firebase's documented modified-scrypt parameter names and public reference
  vector.
- `supabase-auth-users.csv` follows the CSV produced from `auth.users`, with an
  optional JSON-aggregated `identities` column. Supabase documents direct SQL
  Editor access to `auth.users` and `auth.identities` for exports.
- `canonical-users.ndjson` is a complete `authowl.user-import.v1` stream.
  `canonical-users.csv` uses the supported flat canonical column names and JSON
  strings for nested values.

The adapters intentionally do not migrate sessions, MFA secrets, backup codes,
OAuth tokens, API keys, or private keys.
