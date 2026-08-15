# Local merge and release gate

Run the canonical SDK gate from a clean, full-history checkout:

```bash
pnpm run ci:local
```

The command requires Docker and Git, but does not trust ambient Node, pnpm,
Playwright, or browser installations. It captures the exact commit, creates a
private immutable checkout, and builds a source-free Linux image from
digest-pinned Node and Playwright bases. The image pins Node 20.19.0, pnpm
10.34.5, Chromium, and the required Linux browser libraries.

The gate fails unless all of these boundaries pass:

- full tracked-source Semgrep and full-history Gitleaks;
- Git-tree-to-export content, path, mode, symlink, and hard-link verification;
- manifest-only pnpm dependency fetch and audit with no source checkout
  mounted;
- source-free npm cache preparation and audit for the exact Next.js and Vite
  consumer compatibility graphs;
- frozen offline dependency installation with lifecycle scripts disabled;
- offline lifecycle rebuild followed by strict source and generated-root
  integrity comparison;
- build, lint, type contracts, package tests, Storybook, browser accessibility,
  generators, bundle budgets, release hooks, and package boundaries;
- real packed CLI, Admin SDK, and consumer installs that receive
  only reviewed tarballs and proof harnesses;
- production dependency audit with no high or critical advisory;
- final authored-source integrity, image cleanup, and evidence finalization.

Registry-connected dependency acquisition receives only package manifests,
lockfiles, an isolated pnpm store, and an isolated npm cache. The generated
Next.js and Vite proofs perform real npm installs offline against packed SDK
archives in a dedicated executable temporary filesystem; the general
container temporary filesystem remains non-executable. Policy fetching
receives no source. All scanner execution and ordinary product execution are
offline. The remaining packed consumer checks intentionally use the registry
to reproduce a customer installation, receive no credentials or source
checkout, and run only after the offline product checks.

Each run writes a mode-private result below `.authowl-ci/results/`. It contains
only the exact commit/tree, digest-pinned toolchain, named pass/fail results,
image and source-bearing volume cleanup results, and timestamps. It contains
no raw scanner output, source, tokens, registry credentials, or package
contents.

For local merge authority while hosted GitHub Actions billing is unavailable,
merge only the exact commit named by a passing result after security and
structural review. Package releases must use the same exact-commit result.
