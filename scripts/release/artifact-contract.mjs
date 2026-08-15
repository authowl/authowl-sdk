import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digestFile, validatePackageArchive } from './package-archive.mjs';

export const RELEASE_MANIFEST = 'release-manifest.json';
export const DIRECT_PUBLISH_GUARD =
  'node ../../scripts/release/direct-publish-guard.mjs';
export const RELEASE_PACKAGES = Object.freeze([
  { directory: 'packages/auth-core', name: '@authowl/core' },
  { directory: 'packages/auth-react', name: '@authowl/react' },
  { directory: 'packages/auth-next', name: '@authowl/next' },
  { directory: 'packages/auth-convex', name: '@authowl/convex' },
  { directory: 'packages/auth-react-native', name: '@authowl/react-native' },
  { directory: 'packages/auth-expo', name: '@authowl/expo' },
  { directory: 'packages/cli', name: 'authowl' },
]);

const MAX_JSON_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40,64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function createReleaseArtifacts({
  sourceDirectory,
  outputDirectory,
  repositoryRoot,
  commit,
  tree,
}) {
  assertGitObject(commit, 'commit');
  assertGitObject(tree, 'tree');
  const source = requireDirectory(sourceDirectory, 'artifact source');
  const output = requireEmptyDirectory(outputDirectory, 'release output');
  const repository = requireDirectory(repositoryRoot, 'repository');
  const expected = readExpectedPackages(repository);
  const expectedFiles = new Set(expected.map((entry) => entry.filename));
  const sourceFiles = readdirSync(source).sort();
  if (
    sourceFiles.length !== expectedFiles.size ||
    sourceFiles.some((entry) => !expectedFiles.has(entry))
  ) {
    throw new Error(
      `release artifacts: source must contain exactly ${[...expectedFiles].join(', ')}`,
    );
  }

  const validatedPackages = expected.map((entry) => {
    const sourceArchive = requireRegularFileWithin(
      source,
      join(source, entry.filename),
      `source archive ${entry.filename}`,
    );
    const archive = validatePackageArchive(sourceArchive, entry);
    const destination = join(output, entry.filename);
    copyFileSync(sourceArchive, destination, constants.COPYFILE_EXCL);
    const copied = requireRegularFileWithin(
      output,
      destination,
      `copied archive ${entry.filename}`,
    );
    const digest = digestFile(copied);
    if (digest.sha256 !== archive.sha256 || digest.integrity !== archive.integrity) {
      throw new Error(`release artifacts: copied archive changed: ${entry.filename}`);
    }
    return {
      record: {
        name: entry.name,
        version: entry.version,
        filename: entry.filename,
        bytes: digest.bytes,
        sha256: digest.sha256,
        integrity: digest.integrity,
      },
      packedManifest: archive.manifest,
    };
  });

  validatePackedInternalVersions(validatedPackages);
  const packages = validatedPackages.map((entry) => entry.record);
  const manifest = {
    schema: 1,
    repository: 'authowl-sdk',
    commit,
    tree,
    packages,
  };
  writeFileSync(
    join(output, RELEASE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o444 },
  );
  return verifyReleaseArtifacts({
    releaseDirectory: output,
    repositoryRoot: repository,
    commit,
    tree,
  });
}

export function verifyReleaseArtifacts({
  releaseDirectory,
  repositoryRoot,
  commit,
  tree,
}) {
  assertGitObject(commit, 'commit');
  assertGitObject(tree, 'tree');
  const release = requireDirectory(releaseDirectory, 'release directory');
  const repository = requireDirectory(repositoryRoot, 'repository');
  const expected = readExpectedPackages(repository);
  const manifestPath = requireRegularFileWithin(
    release,
    join(release, RELEASE_MANIFEST),
    'release manifest',
  );
  const manifest = readJson(manifestPath, 'release manifest');
  if (
    manifest?.schema !== 1 ||
    manifest.repository !== 'authowl-sdk' ||
    manifest.commit !== commit ||
    manifest.tree !== tree ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length !== expected.length
  ) {
    throw new Error('release artifacts: manifest does not match the source commit');
  }

  const allowedFiles = new Set([
    RELEASE_MANIFEST,
    ...expected.map((entry) => entry.filename),
  ]);
  const actualFiles = readdirSync(release).sort();
  if (
    actualFiles.length !== allowedFiles.size ||
    actualFiles.some((entry) => !allowedFiles.has(entry))
  ) {
    throw new Error('release artifacts: release directory contains unexpected files');
  }

  const validatedPackages = expected.map((entry, index) => {
    const recorded = manifest.packages[index];
    if (
      recorded?.name !== entry.name ||
      recorded.version !== entry.version ||
      recorded.filename !== entry.filename ||
      !Number.isSafeInteger(recorded.bytes) ||
      recorded.bytes <= 0 ||
      !SHA256.test(recorded.sha256) ||
      typeof recorded.integrity !== 'string' ||
      !recorded.integrity.startsWith('sha512-')
    ) {
      throw new Error(`release artifacts: invalid manifest entry for ${entry.name}`);
    }
    const archivePath = requireRegularFileWithin(
      release,
      join(release, entry.filename),
      `release archive ${entry.filename}`,
    );
    const digest = digestFile(archivePath);
    if (
      digest.bytes !== recorded.bytes ||
      digest.sha256 !== recorded.sha256 ||
      digest.integrity !== recorded.integrity
    ) {
      throw new Error(`release artifacts: digest mismatch for ${entry.filename}`);
    }
    const archive = validatePackageArchive(archivePath, entry);
    return {
      record: { ...recorded, path: archivePath },
      packedManifest: archive.manifest,
    };
  });

  validatePackedInternalVersions(validatedPackages);
  const packages = validatedPackages.map((entry) => entry.record);
  return { releaseDirectory: release, manifest, packages };
}

export function expectedReleaseDirectory(repositoryRoot, commit) {
  assertGitObject(commit, 'commit');
  return resolve(repositoryRoot, '.authowl-release', commit);
}

function readExpectedPackages(repositoryRoot) {
  assertNoPendingChangesets(repositoryRoot);
  const packages = RELEASE_PACKAGES.map((entry) => {
    const manifestPath = requireRegularFileWithin(
      repositoryRoot,
      join(repositoryRoot, entry.directory, 'package.json'),
      `package manifest ${entry.name}`,
    );
    const manifest = readJson(manifestPath, `package manifest ${entry.name}`);
    if (
      manifest?.name !== entry.name ||
      typeof manifest.version !== 'string' ||
      !VERSION.test(manifest.version) ||
      manifest.private === true ||
      manifest.scripts?.prepublishOnly !== DIRECT_PUBLISH_GUARD
    ) {
      throw new Error(`release artifacts: invalid source package ${entry.name}`);
    }
    return {
      ...entry,
      version: manifest.version,
      filename: archiveFilename(entry.name, manifest.version),
      manifest,
    };
  });
  validateSourceInternalVersions(packages);
  return packages;
}

function assertNoPendingChangesets(repositoryRoot) {
  const changesetDirectory = join(repositoryRoot, '.changeset');
  if (!existsSync(changesetDirectory)) return;
  const directory = requireDirectory(changesetDirectory, 'changeset directory');
  const pending = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name !== 'README.md' && entry.name.endsWith('.md'));
  if (pending.length > 0) {
    throw new Error(
      'release artifacts: pending changesets must be applied with pnpm version-packages',
    );
  }
}

function validateSourceInternalVersions(packages) {
  const names = new Set(packages.map((entry) => entry.name));
  for (const entry of packages) {
    for (const [name, range] of Object.entries(entry.manifest.dependencies ?? {})) {
      if (names.has(name) && range !== 'workspace:*') {
        throw new Error(
          `release artifacts: ${entry.name} source dependency on ${name} must use workspace:*`,
        );
      }
    }
  }
}

function validatePackedInternalVersions(packages) {
  const versions = new Map(
    packages.map((entry) => [entry.record.name, entry.record.version]),
  );
  for (const entry of packages) {
    const manifest = entry.packedManifest;
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (versions.has(name) && range !== versions.get(name)) {
        throw new Error(
          `release artifacts: ${entry.record.name} must depend on ${name}@${versions.get(name)}`,
        );
      }
    }
  }
}

function archiveFilename(name, version) {
  return `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`;
}

function readJson(path, label) {
  const bytes = readFileSync(path);
  if (bytes.length <= 0 || bytes.length > MAX_JSON_BYTES) {
    throw new Error(`release artifacts: invalid ${label} size`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`release artifacts: invalid ${label} JSON`);
  }
}

function requireEmptyDirectory(path, label) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const directory = requireDirectory(path, label);
  if (readdirSync(directory).length !== 0) {
    throw new Error(`release artifacts: ${label} must be empty`);
  }
  return directory;
}

function requireDirectory(path, label) {
  const requested = resolve(path);
  if (lstatSync(requested).isSymbolicLink()) {
    throw new Error(`release artifacts: ${label} must not be a symbolic link`);
  }
  const resolved = realpathSync(requested);
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`release artifacts: ${label} is not a directory`);
  }
  return resolved;
}

function requireRegularFileWithin(parent, path, label) {
  const parentPath = realpathSync(parent);
  const requested = resolve(path);
  if (lstatSync(requested).isSymbolicLink()) {
    throw new Error(`release artifacts: ${label} must not be a symbolic link`);
  }
  const filePath = realpathSync(requested);
  if (
    filePath === parentPath ||
    (!filePath.startsWith(`${parentPath}${sep}`)) ||
    !statSync(filePath).isFile()
  ) {
    throw new Error(`release artifacts: ${label} is not a contained regular file`);
  }
  return filePath;
}

function assertGitObject(value, label) {
  if (typeof value !== 'string' || !GIT_OBJECT.test(value)) {
    throw new Error(`release artifacts: invalid ${label}`);
  }
}

function parseArguments(argv) {
  const [command, ...values] = argv;
  if (command === 'create' && values.length === 5) {
    return {
      command,
      sourceDirectory: values[0],
      outputDirectory: values[1],
      repositoryRoot: values[2],
      commit: values[3],
      tree: values[4],
    };
  }
  if (command === 'verify' && values.length === 4) {
    return {
      command,
      releaseDirectory: values[0],
      repositoryRoot: values[1],
      commit: values[2],
      tree: values[3],
    };
  }
  throw new Error(
    'Usage: artifact-contract.mjs create <source> <output> <repo> <commit> <tree> | ' +
      'verify <release> <repo> <commit> <tree>',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArguments(process.argv.slice(2));
  const result = options.command === 'create'
    ? createReleaseArtifacts(options)
    : verifyReleaseArtifacts(options);
  process.stdout.write(
    `release artifacts: OK (${result.packages.length} packages, ${result.manifest.commit})\n`,
  );
}
