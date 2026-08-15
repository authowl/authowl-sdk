import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, posix } from 'node:path';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

export function validatePackageArchive(archivePath, expected) {
  const stats = statSync(archivePath);
  if (stats.size <= 0 || stats.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`release artifacts: invalid archive size: ${basename(archivePath)}`);
  }
  const entries = listArchive(archivePath);
  const entrySet = new Set(entries);
  if (entrySet.size !== entries.length) {
    throw new Error(`release artifacts: duplicate archive entry: ${expected.filename}`);
  }
  for (const entry of entries) {
    const normalized = posix.normalize(entry);
    if (
      !entry.startsWith('package/') ||
      normalized !== entry ||
      entry.includes('\0') ||
      entry.split('/').includes('..')
    ) {
      throw new Error(`release artifacts: unsafe archive path in ${expected.filename}`);
    }
  }
  assertOnlyRegularFilesAndDirectories(archivePath, entries, expected.filename);
  for (const required of [
    'package/package.json',
    'package/README.md',
    'package/LICENSE',
    'package/THIRD_PARTY_NOTICES.md',
  ]) {
    if (!entrySet.has(required)) {
      throw new Error(`release artifacts: ${expected.filename} is missing ${required}`);
    }
    assertRegularArchiveEntry(archivePath, required, expected.filename);
  }
  if (entries.some((entry) => entry.endsWith('.map') || entry.startsWith('package/src/'))) {
    throw new Error(`release artifacts: source or source maps escaped into ${expected.filename}`);
  }

  const manifest = readArchiveJson(archivePath, 'package/package.json');
  if (
    manifest?.name !== expected.name ||
    manifest.version !== expected.version ||
    manifest.private === true ||
    manifest.license !== 'MIT' ||
    manifest.publishConfig?.access !== 'public'
  ) {
    throw new Error(`release artifacts: invalid packed manifest for ${expected.name}`);
  }
  assertNoWorkspaceRanges(manifest, expected.name);
  for (const target of packageTargets(manifest)) {
    const entry = `package/${target}`;
    if (!entrySet.has(entry)) {
      throw new Error(`release artifacts: ${expected.filename} is missing ${entry}`);
    }
    assertRegularArchiveEntry(archivePath, entry, expected.filename);
  }
  return { ...digestFile(archivePath), manifest };
}

export function digestFile(path) {
  const bytes = readFileSync(path);
  if (bytes.length <= 0 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`release artifacts: invalid artifact size: ${basename(path)}`);
  }
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}

function assertOnlyRegularFilesAndDirectories(archivePath, entries, filename) {
  const verboseEntries = runTar(
    ['-tvzf', archivePath],
    `inspect ${basename(archivePath)}`,
  )
    .split('\n')
    .filter(Boolean);
  if (
    verboseEntries.length !== entries.length ||
    verboseEntries.some((entry) => !['-', 'd'].includes(entry[0]))
  ) {
    throw new Error(`release artifacts: links or special files in ${filename}`);
  }
}

function assertRegularArchiveEntry(archivePath, entry, filename) {
  const detail = runTar(
    ['-tvzf', archivePath, entry],
    `inspect ${entry} in ${filename}`,
  )
    .split('\n')
    .filter(Boolean);
  if (detail.length !== 1 || detail[0][0] !== '-') {
    throw new Error(`release artifacts: ${entry} is not a regular file in ${filename}`);
  }
}

function packageTargets(manifest) {
  const targets = new Set();
  collectTarget(manifest.main, targets);
  collectTarget(manifest.module, targets);
  collectTarget(manifest.types, targets);
  if (manifest.bin && typeof manifest.bin === 'object') {
    for (const value of Object.values(manifest.bin)) collectTarget(value, targets);
  }
  collectExportTargets(manifest.exports, targets);
  return [...targets].sort();
}

function collectExportTargets(value, targets) {
  if (typeof value === 'string') {
    collectTarget(value, targets);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) collectExportTargets(nested, targets);
  }
}

function collectTarget(value, targets) {
  if (typeof value !== 'string' || !value.startsWith('./')) return;
  const target = posix.normalize(value.slice(2));
  if (!target || target.startsWith('../') || target === '..') {
    throw new Error(`release artifacts: unsafe packed target ${value}`);
  }
  targets.add(target);
}

function assertNoWorkspaceRanges(manifest, name) {
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ]) {
    const value = manifest[field];
    const ranges = Array.isArray(value) ? value : Object.values(value ?? {});
    if (ranges.some((entry) => typeof entry === 'string' && entry.startsWith('workspace:'))) {
      throw new Error(`release artifacts: workspace range remains in ${name}`);
    }
  }
}

function listArchive(archivePath) {
  return runTar(['-tzf', archivePath], `list ${basename(archivePath)}`)
    .split('\n')
    .filter(Boolean);
}

function readArchiveJson(archivePath, entry) {
  const output = runTar(
    ['-xOzf', archivePath, entry],
    `read ${entry} from ${basename(archivePath)}`,
  );
  if (Buffer.byteLength(output) > MAX_JSON_BYTES) {
    throw new Error(`release artifacts: archive manifest exceeds ${MAX_JSON_BYTES} bytes`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`release artifacts: invalid JSON in ${basename(archivePath)}`);
  }
}

function runTar(args, description) {
  const result = spawnSync('tar', args, {
    encoding: 'utf8',
    maxBuffer: MAX_JSON_BYTES * 2,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`release artifacts: unable to ${description}`);
  }
  return result.stdout;
}
