#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const [sourceArgument, manifestArgument, objectFormat] = process.argv.slice(2);
if (!sourceArgument || !manifestArgument || !['sha1', 'sha256'].includes(objectFormat)) {
  throw new Error(
    'usage: verify-source-export.mjs <source-root> <ls-tree-manifest> <sha1|sha256>',
  );
}

const sourceRoot = resolve(sourceArgument);
const manifest = await readFile(resolve(manifestArgument));
const expected = new Map();

for (const entry of splitNull(manifest)) {
  const tab = entry.indexOf(0x09);
  if (tab < 0) throw new Error('malformed Git tree manifest');

  const [mode, type, objectId] = entry.subarray(0, tab).toString('ascii').split(' ');
  const pathBytes = entry.subarray(tab + 1);
  const path = pathBytes.toString('utf8');
  if (!Buffer.from(path, 'utf8').equals(pathBytes)) {
    throw new Error('non-UTF-8 Git paths are not supported by the source boundary');
  }
  if (type !== 'blob' || !['100644', '100755', '120000'].includes(mode)) {
    throw new Error(`unsupported Git tree entry: ${mode} ${type} ${path}`);
  }
  expected.set(path, { mode, objectId });
}

const actualPaths = new Set();
await walk();

for (const path of expected.keys()) {
  if (!actualPaths.has(path)) throw new Error(`source export omitted tracked path: ${path}`);
}
for (const path of actualPaths) {
  if (!expected.has(path)) throw new Error(`source export added untracked path: ${path}`);
}

process.stdout.write(`source export: OK (${expected.size} tracked blobs)\n`);

async function walk(relativeDirectory = '') {
  const entries = await readdir(resolve(sourceRoot, relativeDirectory));
  entries.sort((left, right) => left.localeCompare(right, 'en'));

  for (const name of entries) {
    const path = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const absolutePath = resolve(sourceRoot, path);
    const metadata = await lstat(absolutePath);
    if (metadata.isDirectory()) {
      await walk(path);
      continue;
    }

    actualPaths.add(path);
    const gitEntry = expected.get(path);
    if (!gitEntry) continue;

    let content;
    let mode;
    if (metadata.isSymbolicLink()) {
      content = await readlink(absolutePath, { encoding: 'buffer' });
      mode = '120000';
    } else if (metadata.isFile()) {
      if (metadata.nlink !== 1) {
        throw new Error(`source export contains a hard-linked file: ${path}`);
      }
      content = await readFile(absolutePath);
      mode = metadata.mode & 0o111 ? '100755' : '100644';
    } else {
      throw new Error(`source export contains an unsupported entry: ${path}`);
    }

    if (mode !== gitEntry.mode) {
      throw new Error(`source export mode mismatch: ${path}`);
    }
    if (gitObjectId(content) !== gitEntry.objectId) {
      throw new Error(`source export content mismatch: ${path}`);
    }
  }
}

function gitObjectId(content) {
  const hash = createHash(objectFormat);
  hash.update(`blob ${content.length}\0`);
  hash.update(content);
  return hash.digest('hex');
}

function splitNull(buffer) {
  const entries = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) entries.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) throw new Error('unterminated Git tree manifest');
  return entries;
}
