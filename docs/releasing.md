# Publishing the AuthOwl SDKs

This repository ships twelve things to five different places:

| SDK | Package | Ships to | Released by |
| --- | --- | --- | --- |
| `packages/*` (7) | `@authowl/core`, `@authowl/react`, `@authowl/next`, `@authowl/convex`, `@authowl/react-native`, `@authowl/expo`, `authowl` | npm | `deploy.yml` |
| `sdks/python` | `authowl` | PyPI | `deploy.yml` |
| `sdks/rust` | `authowl` | crates.io | `deploy.yml` |
| `sdks/flutter` | `authowl` | pub.dev | `publish-flutter.yml`, started by a tag |
| `sdks/go` | `github.com/authowl/authowl-sdk/sdks/go` | a Git tag | `deploy.yml` |
| `sdks/php` | `authowl/authowl` | nowhere yet | see [PHP](#php-is-not-published-yet) |

Every version is read from its own manifest by `scripts/release/sdk-manifest.mjs`,
and a target whose exact version is already on its registry is skipped. Running
a deploy twice is safe.

```bash
# what would a deploy do right now?
node scripts/release/sdk-manifest.mjs --registry-state
```

## Prepare versions

For each user-visible change to a JavaScript package, create and commit a
changeset:

```bash
pnpm changeset
```

When the release is ready, apply the changesets and review the version and
dependency updates:

```bash
pnpm version-packages
git diff
```

Commit the generated version changes. Do not edit generated changelogs by hand.
The release commit must have a completely clean worktree, including no untracked
files.

The non-JavaScript SDKs are versioned by hand, in `sdks/python/pyproject.toml`,
`sdks/rust/Cargo.toml`, `sdks/flutter/pubspec.yaml`, and `sdks/go/VERSION`.
The Go SDK has no registry manifest, so the release workflow reads this small
version file and creates the matching module tag.

## Deploy from GitHub Actions

Run the **Deploy SDKs** workflow from `main` (Actions → Deploy SDKs → Run
workflow). It refuses to run from any other ref. Inputs:

| Input | Default | Meaning |
| --- | --- | --- |
| `dry_run` | `true` | Build, verify and dry-run everything, publish nothing |
| `npm` | `true` | Publish `packages/*`; skipped when all seven versions exist |
| `python` | `true` | Publish `sdks/python` |
| `rust` | `true` | Publish `sdks/rust` |
| `flutter` | `true` | Push the tag that publishes `sdks/flutter` |
| `dist_tag` | `latest` | npm dist-tag; use `next` for a prerelease channel |
| `tags` | `true` | Push Git tags and create GitHub Releases for what shipped |

Leave `dry_run` on for the first pass. The npm job runs the full pinned Docker
gate before it publishes anything, so a real deploy takes about an hour; the
other targets take minutes.

### What gets tagged

A tag points at the deploy commit and its Release says the version came from
there, so **a tag is only ever cut for something that run actually released**. A
version the registry already had was built by a different commit, so it is left
alone rather than given invented provenance - which is why the first deploy does
not back-fill tags for the versions already on npm and pub.dev. Cut those by
hand, against the commit that really produced them:

```bash
git tag '@authowl/core@0.13.0' <the commit that released it>
git push origin '@authowl/core@0.13.0'
```

Go is the exception in the other direction: it has no registry, so its tag *is*
the release and is cut from the version in `sdks/go/VERSION`. The Flutter tag is a
request to publish, so `deploy.yml` pushes it without creating a Release;
`publish-flutter.yml` creates that Release once pub.dev has actually accepted
the version.

Publish jobs are recorded independently. If one ecosystem fails, the workflow
still creates tags and GitHub Releases for every other ecosystem that completed
successfully; a failed or cancelled job is never recorded as released.

Two consequences worth knowing:

- When every npm version already exists, the npm job is skipped — and with it
  the byte-for-byte integrity comparison that `release:publish` performs against
  the registry. A deploy is not a tamper check; `ci.yml` runs the gate on every
  push to `main`.
- Turning `tags` off, or leaving `dry_run` on, releases nothing for Go because
  the module tag is the release.

### The Flutter SDK is published by its tag

pub.dev's automated publishing only trusts a run that a Git tag started; it
reads the `ref` claim out of the GitHub OIDC token. So `deploy.yml` pushes
`sdks/flutter-vX.Y.Z` and `publish-flutter.yml` does the publishing.

A tag pushed with the default `GITHUB_TOKEN` deliberately starts no workflow. To
close that loop automatically, add a `RELEASE_TAG_TOKEN` secret (a fine-grained
PAT with `contents: write`); `deploy.yml` uses it to push tags. Without it, run
**Publish Flutter SDK** by hand and choose the tag as the ref.

## One-time registry setup

Authentication is OIDC trusted publishing everywhere: no registry tokens are
stored in this repository, and every credential is minted for a single publish.
Each registry has to be told, once, to trust this repository and workflow.

| Registry | Where | Configure |
| --- | --- | --- |
| npm | npmjs.com → each of the 7 packages → Settings → Trusted publisher | repository `authowl/authowl-sdk`, workflow `deploy.yml` |
| PyPI | pypi.org → Publishing → add a GitHub publisher | project `authowl`, repository `authowl/authowl-sdk`, workflow `deploy.yml` |
| crates.io | crates.io → `authowl` → Settings → Trusted Publishing | repository `authowl/authowl-sdk`, workflow `deploy.yml` |
| pub.dev | pub.dev → `authowl` → Admin → Automated publishing | repository `authowl/authowl-sdk`, tag pattern `sdks/flutter-v{{version}}` |

Two of these need the package to exist before a trusted publisher can be
attached to it:

- **npm** — all seven packages are published, so configure them now.
- **crates.io** — the `authowl` crate does not exist yet. Its *first* version
  has to be published from a laptop with `cargo publish`; after that, configure
  trusted publishing and let the workflow take over.
- **PyPI** supports a *pending* publisher for a name that has never been
  published, so the `authowl` project can be created by the first workflow run.
- **pub.dev** already serves `authowl`, so configure it now.

## Publishing npm from a laptop

The hosted deploy is the normal path. The local path still works and is the
fallback when GitHub Actions is unavailable.

```bash
npm login --auth-type=web
npm whoami
```

Do not store npm tokens in this repository or in `.env` files. From a clean
release commit:

```bash
pnpm release:prepare
pnpm release:verify
pnpm release:publish              # dry run
pnpm release:publish -- --confirm # live
```

`release:prepare` runs the complete pinned Docker gate and exports one tarball
per package under `.authowl-release/<commit>/`, only after every check and
cleanup succeeds. A manifest records package order, version, byte length,
SHA-256 and npm SHA-512 integrity. Exact-commit evidence is written under
`.authowl-ci/results/`. The publication order is `@authowl/core`,
`@authowl/react`, `@authowl/next`, `@authowl/convex`, `@authowl/react-native`,
`@authowl/expo`, `authowl`.

npm may request a one-time password. The command checks the registry before each
release and verifies npm's published SHA-512 integrity afterward. If the process
is interrupted, rerun the same command: packages already present with the
expected integrity are skipped, and a matching version with different bytes
stops the release.

`--trusted-publishing` is what the workflow adds to that last command. It
swaps the `npm whoami` account check for GitHub's OIDC credentials, and it
requires npm 11.5.1 or newer.

Never run `npm publish` inside a package directory. Every publishable package
contains a lifecycle guard that rejects that path.

## PHP is not published yet

Packagist reads `composer.json` from the root of a repository, and this one
lives in `sdks/php`. Publishing `authowl/authowl` needs a subtree-split mirror
repository (for example `authowl/authowl-php`) that receives `sdks/php` as its
root, plus a Packagist webhook pointing at it. Until that exists, the deploy
reports the PHP SDK as skipped and explains why.
