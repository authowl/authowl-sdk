# authowl

**[Complete CLI guide](https://authowl.dev/docs/sdks/cli)** ·
**[All SDKs](https://authowl.dev/docs/sdks)**

The AuthOwl command-line client provides secure browser login, read-only
application detection, and transactional setup for supported Next.js App Router
and Vite React applications.

```bash
npx authowl login
npx authowl whoami
npx authowl projects
npx authowl keys --project-id <project-id>
npx authowl docs
npx authowl detect
npx authowl init
npx authowl init --undo
npx authowl import clerk-users.csv --from clerk --project <project-id> --source-namespace <instance-id> --dry-run
npx authowl import auth0-users.ndjson --from auth0 --project <project-id> --source-namespace <tenant-name>
npx authowl import firebase-users.json --from firebase --firebase-hash-config firebase-hash-config.json --project <project-id> --source-namespace <firebase-project-id>
npx authowl import supabase-users.csv --from supabase --project <project-id> --source-namespace <supabase-project-ref>
npx authowl import canonical-users.ndjson --from authowl --project <project-id> --source-namespace <source-export-id>
npx authowl import clerk-users.csv --from clerk --project <project-id> --source-namespace <instance-id> --resume
npx authowl logout
```

`whoami`, `projects`, and `keys` reuse the short-lived browser-login credential.
They support `--json`; `keys` returns active publishable-key metadata only and
never prints a full key or secret key. `docs --no-open` prints the documentation
URL without launching a browser.

`authowl init` selects or creates an AuthOwl project, installs exact SDK
versions, configures the provider, sign-in route, and `.env.local`, plus
middleware for Next.js, then runs the application's available typecheck and
build scripts. If validation fails, edited source, configuration, and lockfiles
are restored. A successful setup can be reverted with `authowl init --undo`
until any generated file is edited.

The generators refuse ambiguous render anchors, existing middleware, existing
AuthOwl environment values, and conflicting generated routes. They print manual
guidance instead of guessing how to merge application code.

Use `--yes` for safe defaults, `--project-id` to select an existing project, or
`--auth-methods password,passkey` when creating one.

Use `--api-url http://localhost:3010` when developing against the local AuthOwl
server. Non-local API URLs must use HTTPS.

## User imports

`authowl import` converts provider exports locally into the versioned AuthOwl
canonical NDJSON contract. Provider-specific files never reach the server.
Only mapped canonical rows, including supported password-hash envelopes, are
uploaded. Set a project secret key with the `users:write` scope in the
environment:

```bash
export AUTHOWL_SECRET_KEY=sk_test_<project-id>_<random>
```

Always run `--dry-run` first. `--project` must match the project encoded in the
secret key. `--source-namespace` must remain stable across retries and later
updates. Use the Clerk instance id for Clerk and the tenant name or domain for
Auth0. Use the Firebase project id, Supabase project ref, or a stable source
database/export id for the other adapters.

Large sources are streamed into bounded canonical batches. After every
successful batch, the CLI writes a private atomic checkpoint under the AuthOwl
configuration directory. If transport or the process stops, rerun the exact
command with `--resume`. AuthOwl verifies the source fingerprint and
destination before skipping completed rows. A crash after server acceptance
but before checkpoint persistence may replay one batch; stable source
identities make that replay deterministic and do not create duplicate users.

Supported inputs:

- Clerk Dashboard CSV exports and Clerk JSON array exports. Bcrypt and
  Argon2id hashes are preserved. Unsupported hash schemes remain explicit and
  are reported as invalid rows by AuthOwl.
- Auth0 Management API v2 JSON-compatible NDJSON exports, or the JSON array
  produced by converting that NDJSON. Gzip-compressed provider downloads are
  read directly. Standard Auth0 exports do not contain password hashes. If a
  separately approved hash export is merged into the records, the adapter
  recognizes `passwordHash`, `password_hash`, and supported
  `custom_password_hash` values.
- Firebase CLI `auth:export` JSON or 26-column CSV. To preserve Firebase
  modified-scrypt passwords, copy the project's password hash parameters into
  a local JSON file and pass `--firebase-hash-config <file>`. The file accepts
  `base64_signer_key`, `base64_salt_separator`, `rounds`, and `mem_cost`,
  optionally nested under `hash_config`. It is read locally, never printed,
  and never uploaded separately from the sealed canonical password envelopes.
  Passwordless Firebase exports do not require the config.
- Supabase `auth.users` CSV exports and JSON arrays. `encrypted_password`
  bcrypt values are preserved. `raw_app_meta_data` maps to private metadata;
  user-editable `raw_user_meta_data` maps to unsafe metadata. An optional
  `identities` JSON-array column preserves OAuth/SAML provider identifiers.
- AuthOwl or custom canonical CSV, JSON arrays, and NDJSON. Canonical NDJSON
  may include the v1 manifest as line 1, but its provider and namespace must
  match `--from` and `--source-namespace`. Unknown canonical fields fail
  locally instead of being silently discarded.

Sessions, MFA secrets, OAuth tokens, API secrets, and provider private keys are
not migrated.
