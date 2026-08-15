import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  expectedReleaseDirectory,
  verifyReleaseArtifacts,
} from './artifact-contract.mjs';
import { publishRelease } from './npm-publisher.mjs';

const MAX_EVIDENCE_BYTES = 128 * 1024;

const repositoryRoot = realpathSync(resolve(import.meta.dirname, '../..'));

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'prepare') {
    assertCompletelyClean();
    const source = sourceIdentity();
    const releaseDirectory = expectedReleaseDirectory(repositoryRoot, source.commit);
    if (!existsSync(releaseDirectory)) {
      run('pnpm', ['run', 'ci:local'], {
        env: { ...process.env, AUTHOWL_EXPORT_RELEASE_ARTIFACTS: '1' },
        stdio: 'inherit',
      });
    }
    const release = verifyCurrentRelease(releaseDirectory, source);
    printRelease(release, 'prepared');
  } else if (options.command === 'verify') {
    assertTrackedClean();
    const source = sourceIdentity();
    const release = verifyCurrentRelease(
      options.directory ?? expectedReleaseDirectory(repositoryRoot, source.commit),
      source,
    );
    printRelease(release, 'verified');
  } else {
    assertTrackedClean();
    const source = sourceIdentity();
    const release = verifyCurrentRelease(
      options.directory ?? expectedReleaseDirectory(repositoryRoot, source.commit),
      source,
    );
    await publishRelease(release, options);
  }
}

function verifyCurrentRelease(releaseDirectory, source) {
  requireReleaseLocation(releaseDirectory);
  const release = verifyReleaseArtifacts({
    releaseDirectory,
    repositoryRoot,
    commit: source.commit,
    tree: source.tree,
  });
  release.evidence = findPassingEvidence(source);
  return release;
}

function findPassingEvidence(source) {
  const resultBase = resolve(repositoryRoot, '.authowl-ci', 'results');
  if (!existsSync(resultBase) || lstatSync(resultBase).isSymbolicLink()) {
    throw new Error('release verify: exact-commit local-gate evidence is missing');
  }
  const candidates = [];
  for (const directoryEntry of readdirSync(resultBase, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) continue;
    const directory = resolve(resultBase, directoryEntry.name);
    for (const fileEntry of readdirSync(directory, { withFileTypes: true })) {
      if (
        !fileEntry.isFile() ||
        fileEntry.isSymbolicLink() ||
        !fileEntry.name.startsWith(`${source.commit}-`) ||
        !fileEntry.name.endsWith('.txt')
      ) {
        continue;
      }
      const path = resolve(directory, fileEntry.name);
      const stats = statSync(path);
      if (stats.size <= 0 || stats.size > MAX_EVIDENCE_BYTES) continue;
      const fields = parseEvidence(readFileSync(path, 'utf8'));
      if (
        fields.repository === 'authowl-sdk' &&
        fields.commit === source.commit &&
        fields.tree === source.tree &&
        fields['result.release-artifacts'] === 'passed' &&
        fields['result.cleanup'] === 'passed' &&
        fields.status === 'passed'
      ) {
        candidates.push(path);
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error('release verify: no passing release-artifact gate evidence exists');
  }
  return candidates.sort().at(-1);
}

function parseEvidence(input) {
  const fields = {};
  for (const line of input.split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('release verify: malformed local-gate evidence');
    const key = line.slice(0, separator);
    if (Object.hasOwn(fields, key)) {
      throw new Error(`release verify: duplicate evidence field ${key}`);
    }
    fields[key] = line.slice(separator + 1);
  }
  return fields;
}

function sourceIdentity() {
  return {
    commit: git(['rev-parse', '--verify', 'HEAD']),
    tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
  };
}

function assertCompletelyClean() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) {
    throw new Error('release prepare: a completely clean worktree is required');
  }
}

function assertTrackedClean() {
  const status = git(['status', '--porcelain=v1', '--untracked-files=no']);
  if (status) {
    throw new Error('release verify: tracked files differ from the release commit');
  }
}

function requireReleaseLocation(path) {
  if (!existsSync(path)) {
    throw new Error(`release verify: release directory does not exist: ${path}`);
  }
  const releaseBasePath = resolve(repositoryRoot, '.authowl-release');
  if (!existsSync(releaseBasePath)) {
    throw new Error('release verify: .authowl-release does not exist');
  }
  if (lstatSync(releaseBasePath).isSymbolicLink()) {
    throw new Error('release verify: .authowl-release must not be a symbolic link');
  }
  const releaseBase = realpathSync(releaseBasePath);
  if (lstatSync(resolve(path)).isSymbolicLink()) {
    throw new Error('release verify: release directory must not be a symbolic link');
  }
  const releasePath = realpathSync(path);
  const pathFromBase = relative(releaseBase, releasePath);
  if (
    !pathFromBase ||
    pathFromBase === '..' ||
    pathFromBase.startsWith(`..${sep}`)
  ) {
    throw new Error('release verify: release directory is outside .authowl-release');
  }
}

function git(args) {
  return run('git', args, { capture: true }).stdout.trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: options.capture ? 'utf8' : undefined,
    env: options.env ?? process.env,
    maxBuffer: 2 * 1024 * 1024,
    stdio: options.stdio ?? (options.capture ? 'pipe' : 'inherit'),
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args[0] ?? ''} failed with status ${result.status}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function printRelease(release, verb) {
  process.stdout.write(`release ${verb}: ${release.releaseDirectory}\n`);
  process.stdout.write(`release evidence: ${release.evidence}\n`);
  for (const entry of release.packages) {
    process.stdout.write(
      `  ${entry.name}@${entry.version} ${entry.sha256} ${entry.filename}\n`,
    );
  }
}

export function parseArguments(argv) {
  const [command, ...rawRest] = argv;
  const rest = rawRest[0] === '--' ? rawRest.slice(1) : rawRest;
  if (!['prepare', 'verify', 'publish'].includes(command)) {
    throw new Error(
      'Usage: release.mjs prepare | verify [--directory PATH] | ' +
        'publish [--directory PATH] [--tag TAG] [--dry-run|--confirm] ' +
        '[--trusted-publishing]',
    );
  }
  const parsed = {
    command,
    directory: undefined,
    tag: 'latest',
    dryRun: true,
    trustedPublishing: false,
  };
  let publishModeWasSet = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--directory') {
      parsed.directory = rest[index + 1];
      index += 1;
      if (!parsed.directory) throw new Error('release: --directory requires a path');
    } else if (argument === '--tag') {
      parsed.tag = rest[index + 1];
      index += 1;
      if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(parsed.tag ?? '')) {
        throw new Error('release: invalid npm tag');
      }
    } else if (argument === '--dry-run' && command === 'publish') {
      if (publishModeWasSet) throw new Error('release: choose one publish mode');
      parsed.dryRun = true;
      publishModeWasSet = true;
    } else if (argument === '--confirm' && command === 'publish') {
      if (publishModeWasSet) throw new Error('release: choose one publish mode');
      parsed.dryRun = false;
      publishModeWasSet = true;
    } else if (argument === '--trusted-publishing' && command === 'publish') {
      parsed.trustedPublishing = true;
    } else {
      throw new Error(`release: unsupported argument ${argument}`);
    }
  }
  if (command !== 'publish' && (parsed.tag !== 'latest' || !parsed.dryRun)) {
    throw new Error(`release: ${command} does not accept publish options`);
  }
  if (command === 'prepare' && parsed.directory) {
    throw new Error('release: prepare does not accept --directory');
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
