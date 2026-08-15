import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DIRECT_PUBLISH_GUARD } from '../release/artifact-contract.mjs';

const MAX_METADATA_BYTES = 1024 * 1024;

const input = readFileSync(0, 'utf8');
if (input.length > MAX_METADATA_BYTES) {
  throw new Error('release-hook-check: workspace metadata exceeds 1 MiB');
}

const workspaces = JSON.parse(input);
if (!Array.isArray(workspaces)) {
  throw new TypeError('release-hook-check: pnpm metadata must be an array');
}

const repoRoot = realpathSync(process.cwd());
const seenPaths = new Set();
let publishableCount = 0;
let failed = false;

for (const workspace of workspaces) {
  if (
    workspace === null ||
    typeof workspace !== 'object' ||
    typeof workspace.path !== 'string' ||
    !isAbsolute(workspace.path)
  ) {
    throw new TypeError('release-hook-check: invalid workspace metadata entry');
  }

  const workspacePath = realpathSync(workspace.path);
  const relativePath = relative(repoRoot, workspacePath);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(repoRoot, relativePath) !== workspacePath
  ) {
    throw new Error('release-hook-check: workspace resolves outside the repository');
  }
  if (seenPaths.has(workspacePath)) {
    throw new Error(`release-hook-check: duplicate workspace path: ${relativePath || '.'}`);
  }
  seenPaths.add(workspacePath);

  const manifestPath = realpathSync(resolve(workspacePath, 'package.json'));
  if (manifestPath !== resolve(workspacePath, 'package.json')) {
    throw new Error(
      `release-hook-check: package manifest must not be a symlink: ${relativePath || '.'}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError(
      `release-hook-check: invalid package manifest: ${relativePath || '.'}`,
    );
  }
  const isPrivate = manifest.private === true;
  if (workspace.private !== isPrivate) {
    throw new Error(
      `release-hook-check: private metadata mismatch: ${relativePath || '.'}`,
    );
  }
  if (isPrivate) {
    continue;
  }

  publishableCount += 1;
  if (manifest.scripts?.prepublishOnly !== DIRECT_PUBLISH_GUARD) {
    console.error(
      `release-hook-check: ${manifest.name ?? relativePath} must set prepublishOnly to ` +
        JSON.stringify(DIRECT_PUBLISH_GUARD),
    );
    failed = true;
  }
}

if (publishableCount === 0) {
  throw new Error('release-hook-check: no publishable workspace packages found');
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `release-hook-check: OK (${publishableCount} publishable packages block direct publishing)`,
  );
}
