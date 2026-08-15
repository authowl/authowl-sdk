#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const sourceRoot = resolve(process.argv[2] ?? '');
const mode = process.argv[3] ?? 'authored';
if (!process.argv[2]) {
  throw new Error(
    'usage: snapshot-source.mjs <source-root> [pristine|authored|post-lifecycle]',
  );
}
if (!['pristine', 'authored', 'post-lifecycle'].includes(mode)) {
  throw new Error(`unsupported snapshot mode: ${mode}`);
}

const records = [];
const generatedDirectories = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.next',
  'storybook-static',
]);
const excludedDirectories = new Set(['node_modules']);
if (mode === 'authored') {
  for (const generatedDirectory of generatedDirectories) {
    excludedDirectories.add(generatedDirectory);
  }
}

async function walk(relativeDirectory = '') {
  const absoluteDirectory = resolve(sourceRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory);
  entries.sort((left, right) => left.localeCompare(right, 'en'));

  for (const entry of entries) {
    if (
      mode === 'pristine' &&
      (generatedDirectories.has(entry) || entry.endsWith('.tsbuildinfo'))
    ) {
      const generatedPath = relativeDirectory
        ? `${relativeDirectory}${sep}${entry}`
        : entry;
      throw new Error(`generated path exists in source export: ${generatedPath}`);
    }
    if (excludedDirectories.has(entry)) continue;
    const relativePath = relativeDirectory
      ? `${relativeDirectory}${sep}${entry}`
      : entry;
    const absolutePath = resolve(sourceRoot, relativePath);
    const metadata = await lstat(absolutePath);
    const fileMode = metadata.mode & 0o777;

    if (metadata.isDirectory()) {
      records.push({ path: relativePath, type: 'directory', mode: fileMode });
      await walk(relativePath);
    } else if (metadata.isFile()) {
      if (mode === 'authored' && entry.endsWith('.tsbuildinfo')) continue;
      if (metadata.nlink !== 1) {
        throw new Error(`hard-linked authored file is forbidden: ${relativePath}`);
      }
      const digest = createHash('sha256')
        .update(await readFile(absolutePath))
        .digest('hex');
      records.push({ path: relativePath, type: 'file', mode: fileMode, digest });
    } else if (metadata.isSymbolicLink()) {
      records.push({
        path: relativePath,
        type: 'symlink',
        mode: fileMode,
        target: await readlink(absolutePath),
      });
    } else {
      throw new Error(`unsupported source entry: ${relativePath}`);
    }
  }
}

await walk();
process.stdout.write(`${JSON.stringify(records)}\n`);
