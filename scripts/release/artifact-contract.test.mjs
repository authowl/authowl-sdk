import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createReleaseArtifacts,
  DIRECT_PUBLISH_GUARD,
  RELEASE_PACKAGES,
  verifyReleaseArtifacts,
} from './artifact-contract.mjs';
import { supportsTrustedPublishing } from './npm-publisher.mjs';
import { parseArguments } from './release.mjs';
import {
  assertScaffoldPinCoupling,
  isReleaseVersion,
  releaseUnits,
} from './sdk-manifest.mjs';
import { stripDelimitedSections } from '../notice-text.mjs';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'authowl-release-contract.'));
const commit = '1'.repeat(40);
const tree = '2'.repeat(40);

try {
  const repository = join(fixtureRoot, 'repository');
  const archives = join(fixtureRoot, 'archives');
  const release = join(fixtureRoot, 'release');
  createFixture(repository, archives);

  const created = createReleaseArtifacts({
    sourceDirectory: archives,
    outputDirectory: release,
    repositoryRoot: repository,
    commit,
    tree,
  });
  assert.equal(created.packages.length, RELEASE_PACKAGES.length);
  assert.deepEqual(
    created.packages.map((entry) => entry.name),
    RELEASE_PACKAGES.map((entry) => entry.name),
  );

  const verified = verifyReleaseArtifacts({
    releaseDirectory: release,
    repositoryRoot: repository,
    commit,
    tree,
  });
  assert.deepEqual(
    verified.packages.map((entry) => entry.sha256),
    created.packages.map((entry) => entry.sha256),
  );

  appendFileSync(created.packages[0].path, 'tampered');
  assert.throws(
    () => verifyReleaseArtifacts({ releaseDirectory: release, repositoryRoot: repository, commit, tree }),
    /digest mismatch/,
  );

  const unexpectedRelease = join(fixtureRoot, 'unexpected-release');
  createReleaseArtifacts({
    sourceDirectory: archives,
    outputDirectory: unexpectedRelease,
    repositoryRoot: repository,
    commit,
    tree,
  });
  writeFileSync(join(unexpectedRelease, 'extra.txt'), 'not allowed');
  assert.throws(
    () => verifyReleaseArtifacts({
      releaseDirectory: unexpectedRelease,
      repositoryRoot: repository,
      commit,
      tree,
    }),
    /unexpected files/,
  );

  const invalidRepository = join(fixtureRoot, 'invalid-repository');
  const invalidArchives = join(fixtureRoot, 'invalid-archives');
  createFixture(invalidRepository, invalidArchives, { packedWorkspaceRange: true });
  assert.throws(
    () => createReleaseArtifacts({
      sourceDirectory: invalidArchives,
      outputDirectory: join(fixtureRoot, 'invalid-release'),
      repositoryRoot: invalidRepository,
      commit,
      tree,
    }),
    /workspace range remains/,
  );

  const linkedRepository = join(fixtureRoot, 'linked-repository');
  const linkedArchives = join(fixtureRoot, 'linked-archives');
  createFixture(linkedRepository, linkedArchives, { linkedReadme: true });
  assert.throws(
    () => createReleaseArtifacts({
      sourceDirectory: linkedArchives,
      outputDirectory: join(fixtureRoot, 'linked-release'),
      repositoryRoot: linkedRepository,
      commit,
      tree,
    }),
    /links or special files/,
  );

  assert.deepEqual(parseArguments(['publish']), {
    command: 'publish',
    directory: undefined,
    tag: 'latest',
    dryRun: true,
    trustedPublishing: false,
  });
  assert.equal(parseArguments(['publish', '--', '--confirm']).dryRun, false);
  assert.equal(parseArguments(['verify']).dryRun, true);
  assert.equal(
    parseArguments(['publish', '--confirm', '--trusted-publishing']).trustedPublishing,
    true,
  );
  assert.throws(() => parseArguments(['prepare', '--confirm']), /unsupported argument/);
  assert.throws(
    () => parseArguments(['verify', '--trusted-publishing']),
    /unsupported argument/,
  );
  assert.throws(
    () => parseArguments(['prepare', '--directory', '/tmp/release']),
    /does not accept --directory/,
  );
  assert.throws(
    () => parseArguments(['publish', '--confirm', '--dry-run']),
    /choose one publish mode/,
  );

  // OIDC trusted publishing arrived in npm 11.5.1; older clients ignore the
  // workflow's credentials, so the release refuses to start on one.
  for (const version of ['11.5.1', '11.19.0', '12.0.2', '11.6.0']) {
    assert.equal(supportsTrustedPublishing(version), true, version);
  }
  for (const version of ['11.5.0', '11.4.9', '10.9.4', '9.0.0']) {
    assert.equal(supportsTrustedPublishing(version), false, version);
  }
  assert.throws(() => supportsTrustedPublishing('not-a-version'), /unreadable version/);

  for (const version of ['1.2.3', '1.2.3-alpha.1', '1.2.3+build.4', '1.2.3-alpha.1+build.4']) {
    assert.equal(isReleaseVersion(version), true, version);
  }
  for (const version of ['1.2', '1.2.3-alpha+build+extra', '1.2.3/../../tag']) {
    assert.equal(isReleaseVersion(version), false, version);
  }
  const goUnit = releaseUnits().find((unit) => unit.ecosystem === 'go');
  assert.equal(goUnit?.version, '0.2.0');
  assert.equal(goUnit?.tag, 'sdks/go/v0.2.0');
  assert.equal(goUnit?.publishable, true);
  assert.equal(stripDelimitedSections('Devcoat <<script>>', '<', '>'), 'Devcoat ');
  assert.equal(stripDelimitedSections('Devcoat ((website))', '(', ')'), 'Devcoat ');
  assert.equal(stripDelimitedSections('Devcoat <unfinished', '<', '>'), 'Devcoat ');

  // The CLI embeds @authowl/react and @authowl/next versions at build time, so
  // releasing either without releasing the CLI leaves `authowl init` pinning the
  // previous pair - and the publish dies on the integrity check an hour in.
  const pinUnits = (overrides) =>
    [
      { id: 'npm:@authowl/react', name: '@authowl/react', version: '0.18.0', published: true },
      { id: 'npm:@authowl/next', name: '@authowl/next', version: '0.2.8', published: true },
      { id: 'npm:authowl', name: 'authowl', version: '0.2.6', published: true },
    ].map((unit) => ({ ...unit, ...(overrides[unit.id] ?? {}) }));

  assert.throws(
    () => assertScaffoldPinCoupling(pinUnits({ 'npm:@authowl/react': { published: false } })),
    /@authowl\/react is pending publish/,
  );
  assert.throws(
    () =>
      assertScaffoldPinCoupling(
        pinUnits({
          'npm:@authowl/react': { published: false },
          'npm:@authowl/next': { published: false },
        }),
      ),
    /@authowl\/react and @authowl\/next are pending publish/,
  );
  // The CLI going out alongside them is the whole point - not a failure.
  assert.doesNotThrow(() =>
    assertScaffoldPinCoupling(
      pinUnits({
        'npm:@authowl/react': { published: false },
        'npm:authowl': { published: false },
      }),
    ),
  );
  // Nothing pending, nothing to say.
  assert.doesNotThrow(() => assertScaffoldPinCoupling(pinUnits({})));
  // Without --registry-state there is no `published` to reason about, and
  // `--only` can narrow the CLI out of the list entirely.
  assert.doesNotThrow(() =>
    assertScaffoldPinCoupling(
      pinUnits({}).map((unit) => {
        const withoutState = { ...unit };
        delete withoutState.published;
        return withoutState;
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertScaffoldPinCoupling(
      pinUnits({ 'npm:@authowl/react': { published: false } }).filter(
        (unit) => unit.id !== 'npm:authowl',
      ),
    ),
  );

  process.stdout.write('release artifact contract: OK\n');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function createFixture(repository, archives, options = {}) {
  mkdirSync(repository, { recursive: true });
  mkdirSync(archives, { recursive: true });
  const versions = new Map(RELEASE_PACKAGES.map((entry, index) => [entry.name, `1.0.${index}`]));

  for (const entry of RELEASE_PACKAGES) {
    const dependencies = sourceDependencies(entry.name);
    const sourceDirectory = join(repository, entry.directory);
    mkdirSync(sourceDirectory, { recursive: true });
    writeJson(join(sourceDirectory, 'package.json'), {
      name: entry.name,
      version: versions.get(entry.name),
      license: 'MIT',
      scripts: { prepublishOnly: DIRECT_PUBLISH_GUARD },
      dependencies,
    });

    const archiveRoot = join(fixtureRoot, `packed-${entry.name.replaceAll('/', '-')}`);
    const packageRoot = join(archiveRoot, 'package');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true });
    const packedDependencies = Object.fromEntries(
      Object.keys(dependencies).map((name) => [
        name,
        options.packedWorkspaceRange ? 'workspace:*' : versions.get(name),
      ]),
    );
    writeJson(join(packageRoot, 'package.json'), {
      name: entry.name,
      version: versions.get(entry.name),
      license: 'MIT',
      publishConfig: { access: 'public' },
      main: './dist/index.js',
      dependencies: packedDependencies,
    });
    for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      writeFileSync(join(packageRoot, file), `${entry.name} ${file}\n`);
    }
    if (options.linkedReadme && entry.name === '@authowl/core') {
      unlinkSync(join(packageRoot, 'README.md'));
      symlinkSync('LICENSE', join(packageRoot, 'README.md'));
    }
    writeFileSync(join(packageRoot, 'dist', 'index.js'), 'export const ready = true;\n');

    const filename = `${entry.name.replace(/^@/, '').replaceAll('/', '-')}-${versions.get(entry.name)}.tgz`;
    const result = spawnSync('tar', ['-czf', join(archives, filename), '-C', archiveRoot, 'package'], {
      encoding: 'utf8',
    });
    if (result.status !== 0 || result.error) {
      throw new Error(`unable to create test archive for ${entry.name}`);
    }
  }
}

function sourceDependencies(name) {
  if (
    name === '@authowl/react'
    || name === '@authowl/next'
    || name === '@authowl/react-native'
  ) {
    return { '@authowl/core': 'workspace:*' };
  }
  if (name === '@authowl/expo') {
    return { '@authowl/react-native': 'workspace:*' };
  }
  return {};
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
