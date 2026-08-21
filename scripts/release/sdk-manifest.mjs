// Release inventory for every AuthOwl SDK, in one place.
//
// This repository ships seven npm packages plus five non-JavaScript SDKs, and
// every ecosystem publishes somewhere different. `.github/workflows/deploy.yml`
// reads this file so the workflow never parses `pyproject.toml`, `Cargo.toml`,
// or `pubspec.yaml` with shell tools, and so "which version are we releasing,
// and where does it go" has exactly one answer per SDK.
//
// Usage:
//   node scripts/release/sdk-manifest.mjs
//   node scripts/release/sdk-manifest.mjs --registry-state
//   node scripts/release/sdk-manifest.mjs --registry-state --summary-file FILE
//
// Compact JSON goes to stdout (one line, safe for a GitHub Actions output).
// `--registry-state` adds `published` per unit by asking each registry whether
// that exact version already exists; `--summary-file` also appends a Markdown
// table for the workflow run summary.

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASE_PACKAGES } from './artifact-contract.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const USER_AGENT = 'authowl-sdk release (https://github.com/authowl/authowl-sdk)';
const GO_MODULE = 'github.com/authowl/authowl-sdk/sdks/go';
// Accepts the semver these ecosystems agree on, including the `+build` suffix
// Dart allows. Everything here becomes a Git tag, so it is validated once.
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function releaseUnits() {
  return [...npmUnits(), ...sdkUnits()];
}

export function isReleaseVersion(value) {
  return typeof value === 'string' && VERSION.test(value);
}

function npmUnits() {
  return RELEASE_PACKAGES.map((entry) => {
    const manifest = readJson(`${entry.directory}/package.json`);
    if (manifest?.name !== entry.name) {
      throw new Error(`sdk manifest: ${entry.directory} does not declare ${entry.name}`);
    }
    const version = requireVersion(manifest.version, entry.name);
    return {
      id: `npm:${entry.name}`,
      ecosystem: 'npm',
      registry: 'npmjs.com',
      name: entry.name,
      version,
      directory: entry.directory,
      // Matches the tag Changesets writes for a JavaScript monorepo.
      tag: `${entry.name}@${version}`,
      url: `https://www.npmjs.com/package/${entry.name}/v/${version}`,
      probe: `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${version}`,
      publishable: true,
    };
  });
}

function sdkUnits() {
  const python = requireVersion(
    tomlValue(readText('sdks/python/pyproject.toml'), 'project', 'version'),
    'sdks/python',
  );
  const rust = requireVersion(
    tomlValue(readText('sdks/rust/Cargo.toml'), 'package', 'version'),
    'sdks/rust',
  );
  const flutter = requireVersion(
    yamlRootValue(readText('sdks/flutter/pubspec.yaml'), 'version'),
    'sdks/flutter',
  );
  const go = requireVersion(readText('sdks/go/VERSION').trim(), 'sdks/go');

  return [
    {
      id: 'pypi:authowl',
      ecosystem: 'pypi',
      registry: 'pypi.org',
      name: 'authowl',
      version: python,
      directory: 'sdks/python',
      tag: `sdks/python-v${python}`,
      url: `https://pypi.org/project/authowl/${python}/`,
      probe: `https://pypi.org/pypi/authowl/${python}/json`,
      publishable: true,
    },
    {
      id: 'crates:authowl',
      ecosystem: 'crates.io',
      registry: 'crates.io',
      name: 'authowl',
      version: rust,
      directory: 'sdks/rust',
      tag: `sdks/rust-v${rust}`,
      url: `https://crates.io/crates/authowl/${rust}`,
      probe: `https://crates.io/api/v1/crates/authowl/${rust}`,
      publishable: true,
    },
    {
      id: 'pub:authowl',
      ecosystem: 'pub.dev',
      registry: 'pub.dev',
      name: 'authowl',
      version: flutter,
      directory: 'sdks/flutter',
      // pub.dev only trusts tag-triggered runs, so this tag is what actually
      // releases the Flutter SDK - see .github/workflows/publish-flutter.yml.
      tag: `sdks/flutter-v${flutter}`,
      url: `https://pub.dev/packages/authowl/versions/${flutter}`,
      probe: `https://pub.dev/api/packages/authowl/versions/${flutter}`,
      publishable: true,
    },
    {
      id: 'go:authowl',
      ecosystem: 'go',
      registry: 'proxy.golang.org',
      name: GO_MODULE,
      version: go,
      directory: 'sdks/go',
      // Go has no registry: consumers resolve the module straight out of this
      // repository, and a subdirectory module must be tagged with its path.
      tag: `sdks/go/v${go}`,
      url: `https://pkg.go.dev/${GO_MODULE}@v${go}`,
      // Deliberately unprobed: asking the module proxy about a version before
      // its tag exists teaches the proxy to cache the miss.
      probe: null,
      publishable: true,
      note: 'the tag is the release',
    },
    {
      id: 'packagist:authowl/authowl',
      ecosystem: 'packagist',
      registry: 'packagist.org',
      name: 'authowl/authowl',
      // Composer takes the version from the tag, so composer.json declares none.
      version: null,
      directory: 'sdks/php',
      tag: null,
      url: null,
      probe: null,
      publishable: false,
      note:
        'Packagist requires composer.json at the repository root; publishing ' +
        'sdks/php needs a subtree-split mirror repository',
    },
  ];
}

export async function withRegistryState(units) {
  return Promise.all(
    units.map(async (unit) => ({ ...unit, published: await isPublished(unit) })),
  );
}

async function isPublished(unit) {
  if (!unit.probe) return null;
  let response;
  try {
    response = await fetch(unit.probe, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
  } catch (cause) {
    throw new Error(`sdk manifest: ${unit.registry} is unreachable for ${unit.id}`, { cause });
  }
  if (response.status === 200) return true;
  // 404 is "not published yet"; the Go module proxy answers 410 for a version
  // it has never seen. Anything else (403 from a registry that dislikes the
  // user agent, 5xx) is an unknown, not an invitation to republish.
  if (response.status === 404 || response.status === 410) return false;
  throw new Error(
    `sdk manifest: ${unit.registry} answered ${response.status} for ${unit.id}`,
  );
}

// packages/cli/src/metadata.ts reads @authowl/react and @authowl/next versions
// at BUILD time, and `authowl init` installs them with --save-exact. So the CLI's
// published bytes change whenever either package is released, while Changesets
// leaves the CLI's own version alone unless a changeset names it. The release
// contract then refuses to republish the CLI under a version whose bytes moved,
// and the run dies at the publish step - after roughly an hour of audit and
// build. Checked here instead, where the plan already knows what is pending.
export function assertScaffoldPinCoupling(units) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const cli = byId.get('npm:authowl');
  const scaffolded = ['npm:@authowl/react', 'npm:@authowl/next']
    .map((id) => byId.get(id))
    .filter(Boolean);
  // `--only` narrows the unit list, and without --registry-state there is no
  // `published` to reason about. Either way there is nothing to assert.
  if (!cli || scaffolded.length === 0) return;
  if (cli.published !== true) return;
  const pending = scaffolded.filter((unit) => unit.published === false);
  if (pending.length === 0) return;
  throw new Error(
    `sdk manifest: ${pending.map((unit) => unit.name).join(' and ')} ` +
      `${pending.length === 1 ? 'is' : 'are'} pending publish, but authowl@${cli.version} ` +
      'is already on npmjs.com. The CLI embeds those versions at build time ' +
      '(packages/cli/src/metadata.ts) and installs them with --save-exact, so ' +
      'releasing them without releasing the CLI leaves `authowl init` pinning the ' +
      'previous pair. Add a changeset bumping `authowl` (patch).',
  );
}

export function summarize(units) {
  const lines = [
    '## SDK release plan',
    '',
    '| SDK | Registry | Version | Tag | State |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const unit of units) {
    lines.push(
      `| ${unit.directory} | ${unit.registry} | ${unit.version ?? '—'} | ` +
        `${unit.tag ? `\`${unit.tag}\`` : '—'} | ${describeState(unit)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function describeState(unit) {
  if (!unit.publishable) return `skipped — ${unit.note}`;
  if (unit.published === true) return `already on ${unit.registry}`;
  if (unit.published === false) return 'to publish';
  return unit.note ?? 'not checked';
}

function requireVersion(value, label) {
  if (!isReleaseVersion(value)) {
    throw new Error(`sdk manifest: ${label} has an unusable version: ${value}`);
  }
  return value;
}

// Minimal section-aware TOML reader: enough for a `key = "value"` line inside a
// named table, and deliberately blind to everything else so a `version` under
// `[dependencies]` can never be mistaken for the package version. Multi-line
// strings are tracked and skipped whole - a `version = "9.9.9"` sitting inside
// a long `description` is prose, not the answer.
function tomlValue(text, section, key) {
  let current = '';
  let openDelimiter = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (openDelimiter) {
      if (line.includes(openDelimiter)) openDelimiter = '';
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      if (end < 0) continue;
      current = line.slice(1, end).trim();
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const value = line.slice(separator + 1).trim();
    const delimiter = ['"""', "'''"].find((candidate) => value.startsWith(candidate));
    if (delimiter && !value.slice(delimiter.length).includes(delimiter)) {
      openDelimiter = delimiter;
      continue;
    }
    if (current !== section || line.slice(0, separator).trim() !== key) continue;
    return unquote(value, `${section}.${key}`);
  }
  throw new Error(`sdk manifest: ${section}.${key} is missing`);
}

// Top-level YAML scalar only: an indented line is nested and never the answer.
function yamlRootValue(text, key) {
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || /^\s/.test(line)) continue;
    const separator = line.indexOf(':');
    if (separator < 0 || line.slice(0, separator) !== key) continue;
    const value = line.slice(separator + 1).trim();
    const comment = value.indexOf(' #');
    return unquote(comment < 0 ? value : value.slice(0, comment).trim(), key);
  }
  throw new Error(`sdk manifest: ${key} is missing`);
}

// Manifests quote versions or not, with either quote character, and all of it
// is legal. Take the value either way rather than failing on a lawful edit.
function unquote(value, label) {
  for (const quote of ['"', "'"]) {
    if (value.length >= 2 && value.startsWith(quote) && value.endsWith(quote)) {
      return value.slice(1, -1);
    }
  }
  if (value.includes('"') || value.includes("'")) {
    throw new Error(`sdk manifest: ${label} is not a plain string`);
  }
  return value;
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (cause) {
    throw new Error(`sdk manifest: ${relativePath} is not valid JSON`, { cause });
  }
}

function readText(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

export function parseArguments(argv) {
  const parsed = {
    only: undefined,
    registryState: false,
    summaryFile: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--only') {
      parsed.only = argv[index + 1];
      index += 1;
      if (!parsed.only) throw new Error('sdk manifest: --only requires a unit id');
    } else if (argument === '--registry-state') {
      parsed.registryState = true;
    } else if (argument === '--summary-file') {
      parsed.summaryFile = argv[index + 1];
      index += 1;
      if (!parsed.summaryFile) throw new Error('sdk manifest: --summary-file requires a path');
    } else {
      throw new Error(`sdk manifest: unsupported argument ${argument}`);
    }
  }
  if (parsed.summaryFile && !parsed.registryState) {
    throw new Error('sdk manifest: --summary-file requires --registry-state');
  }
  return parsed;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  let units = releaseUnits();
  if (options.only) {
    // Narrowing before the probes matters: a workflow that only ships one SDK
    // should not fail because an unrelated registry is having a bad day.
    units = units.filter((unit) => unit.id === options.only);
    if (units.length === 0) throw new Error(`sdk manifest: no unit ${options.only}`);
  }
  if (options.registryState) {
    units = await withRegistryState(units);
    assertScaffoldPinCoupling(units);
  }
  if (options.summaryFile) appendFileSync(options.summaryFile, summarize(units));
  process.stdout.write(`${JSON.stringify({ repository: 'authowl-sdk', units })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
