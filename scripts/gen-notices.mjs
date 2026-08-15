// Third-party notices generator. AuthOwl packages bundle selected reviewed
// runtime helpers, so their licenses and notices must ship with the tarball.
//
// It re-bundles the package's own entrypoints with esbuild using the SAME
// externals tsup does (react/react-dom stay external; everything else is
// inlined), reads the esbuild metafile to learn exactly which node_modules
// packages ended up in the bytes, and emits their license id + full license
// text. Run from a package directory (cwd), after `tsup`.
//
// It FAILS the build (fail-closed) if a bundled package's license is not on the
// permissive allowlist - the point of the gate is legal safety, not merely
// "has a license string", so copyleft / UNLICENSED / undeterminable licenses
// stop the build rather than shipping silently.
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripDelimitedSections } from './notice-text.mjs';

const pkgDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

// Match tsup's externals: declared deps + peerDeps are external, plus the
// explicit react/react-dom. Everything else gets bundled -> must be noticed.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  'react',
  'react-dom',
];

// Entrypoints come from argv (each package passes its own published entries);
// default to the common index/server pair. Only existing files are bundled.
const entryArgs = process.argv.slice(2);
const entries = (entryArgs.length ? entryArgs : ['src/index.ts', 'src/server.ts']).filter((e) =>
  existsSync(join(pkgDir, e)),
);

// Bundle every published format. esbuild bundles one format per run, and a dep
// can be reached only through one format's conditional-export path (require vs
// import), so union the inputs across esm+cjs to avoid missing a shipped dep.
const inputs = new Set();
for (const format of ['esm', 'cjs']) {
  const result = await build({
    entryPoints: entries.map((e) => resolve(pkgDir, e)),
    bundle: true,
    format,
    platform: 'node',
    metafile: true,
    write: false,
    outdir: resolve(pkgDir, 'dist'), // required for multi-entry; write:false means nothing is emitted
    external,
    logLevel: 'silent',
  });
  for (const f of Object.keys(result.metafile.inputs)) inputs.add(f);
}

// Map each bundled input file back to the node_modules package that owns it.
function pkgRootFromInput(file) {
  const marker = 'node_modules/';
  const idx = file.lastIndexOf(marker);
  if (idx === -1) return null; // first-party source, not third-party
  const after = file.slice(idx + marker.length);
  const parts = after.split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  const root = resolve(pkgDir, file.slice(0, idx + marker.length) + name);
  return { name, root };
}

// Dedup by RESOLVED ROOT PATH: two versions of one package live at distinct
// .pnpm roots, so a name-keyed map would silently drop the second version.
const roots = new Map(); // root path -> name
for (const file of inputs) {
  const info = pkgRootFromInput(file);
  if (!info) continue;
  if (info.name.startsWith('@authowl/')) continue; // our own workspace packages
  if (!roots.has(info.root)) roots.set(info.root, info.name);
}

// SPDX ids we may redistribute by bundling. Anything outside this set (copyleft,
// UNLICENSED, "SEE LICENSE IN ...", unknown) fails the build closed.
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  '0BSD',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
]);

const LICENSE_RE = /^licen[cs]e|^copying|^notice/i;

function declaredLicenseId(meta) {
  if (typeof meta.license === 'string') return meta.license;
  if (meta.license && typeof meta.license === 'object' && meta.license.type) return meta.license.type;
  if (Array.isArray(meta.licenses)) return meta.licenses.map((l) => l.type ?? l).join(' OR ');
  return null;
}

// An id is acceptable only if every SPDX token in it (handles "A OR B",
// "A AND B", and parenthesised expressions) is on the allowlist.
function isAllowed(id) {
  if (!id) return false;
  const tokens = id
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => ALLOWED.has(t));
}

// Some genuinely-permissive packages omit the package.json `license` field but
// ship a LICENSE file (e.g. @better-fetch/fetch). Infer a permissive SPDX id
// from the text so they pass; anything we cannot confidently identify as
// permissive stays unidentified and fails closed.
function inferSpdx(texts) {
  const blob = texts.map((t) => t.text).join('\n');
  if (/\bMIT License\b/i.test(blob) || /Permission is hereby granted, free of charge/i.test(blob))
    return 'MIT';
  if (
    /\bISC License\b/i.test(blob) ||
    /Permission to use, copy, modify, and\/or distribute this software/i.test(blob)
  )
    return 'ISC';
  if (/Apache License[,\s]+Version 2\.0/i.test(blob)) return 'Apache-2.0';
  if (/This is free and unencumbered software released into the public domain/i.test(blob))
    return 'Unlicense';
  if (/\bBlue Oak Model License\b/i.test(blob)) return 'BlueOak-1.0.0';
  if (/Redistribution and use in source and binary forms/i.test(blob))
    return /neither the name of/i.test(blob) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  return null;
}

// A copyright holder for the synthesized notice, from package.json `author`
// (npm allows a "Name <email> (url)" string or a { name, email } object).
function authorHolder(meta) {
  const a = meta.author;
  if (typeof a === 'string') {
    const withoutEmail = stripDelimitedSections(a, '<', '>');
    const name = stripDelimitedSections(withoutEmail, '(', ')').trim();
    return name || null;
  }
  if (a && typeof a === 'object' && typeof a.name === 'string') return a.name.trim() || null;
  return null;
}

// The verbatim `Copyright (c) <year> <holder>` line for a package that ships no
// license file. MIT/ISC require preserving the ACTUAL copyright notice, and a
// bundle-only package often carries it (with its year) as a source-header comment
// (e.g. qrcode-generator's `// Copyright (c) 2009 Kazuhiko Arase`) - which
// bundling strips. Read the entrypoints, take the real line if present, else fall
// back to reconstructing `Copyright (c) <author>` from package.json (year unknown).
function copyrightLineFor(root, meta) {
  const entries = new Set();
  const add = (v) => typeof v === 'string' && entries.add(v);
  const walk = (e) => {
    if (typeof e === 'string') add(e);
    else if (e && typeof e === 'object') for (const v of Object.values(e)) walk(v);
  };
  add(meta.main);
  add(meta.module);
  add(meta.browser);
  walk(meta.exports);
  for (const rel of entries) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    // Copyright banners live at the top; scan the header only and strip the
    // comment leader (// , * , /*! ) so we keep the bare notice line.
    for (const raw of text.slice(0, 4000).split('\n')) {
      const s = raw
        .replace(/^\s*(\/\/+|\/\*!?|\*+)\s?/, '')
        .replace(/\s*\*\/\s*$/, '')
        .trim();
      if (/^copyright\b/i.test(s) && /\b\d{4}\b/.test(s) && !/^copyright notice\b/i.test(s)) return s;
    }
  }
  const holder = authorHolder(meta);
  return holder ? `Copyright (c) ${holder}` : null;
}

// Canonical, self-contained license texts, parameterized only by the copyright
// line. Used ONLY for a package that declares a permissive license but ships no
// license file (e.g. qrcode-generator: `"license": "MIT"`, no LICENSE). We
// reproduce the exact OSI text so the distributed notice is legally complete.
// Restricted to MIT/ISC: their full obligation is the copyright + this verbatim
// text, so a holder line is enough to synthesize a valid notice. Other ids
// (BSD needs the holder inside the disclaimer, Apache-2.0 has NOTICE handling)
// are NOT synthesized - they fail closed for a conscious human call.
const CANONICAL = {
  MIT: (copyright) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (copyright) => `ISC License

${copyright}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
};

// Build the verbatim notice text for a package that declares `id` but ships no
// license file. Returns a single synthesized text, or null if we cannot produce
// a legally complete one (no attributable copyright, or an id we do not template).
function synthesizeTexts(id, meta, root) {
  const template = CANONICAL[id];
  const copyright = copyrightLineFor(root, meta);
  if (!template || !copyright) return null;
  return { file: 'LICENSE (reconstructed from bundled source/metadata)', text: template(copyright) };
}

// Collect ALL license/notice files (dual-license, Apache NOTICE), sorted for
// deterministic output across filesystems.
function licenseTexts(root) {
  let dir;
  try {
    dir = readdirSync(root);
  } catch {
    return [];
  }
  return dir
    .filter((f) => LICENSE_RE.test(f))
    .sort()
    .map((f) => {
      try {
        return { file: f, text: readFileSync(join(root, f), 'utf8').trim() };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const notices = [];
const violations = [];
for (const [root, name] of [...roots].sort((a, b) => a[1].localeCompare(b[1]))) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    meta = {};
  }
  let texts = licenseTexts(root);
  const declared = declaredLicenseId(meta);
  const id = isAllowed(declared) ? declared : (inferSpdx(texts) ?? declared);
  if (!isAllowed(id)) {
    violations.push(`${name}@${meta.version ?? '?'} (license: ${declared ?? 'none'})`);
    continue;
  }
  // Declares a permissive license but ships no license file: synthesize the
  // canonical text so the notice is complete. Fail closed if we cannot (an id
  // we do not template, or no attributable author) rather than emit an empty,
  // legally deficient notice block.
  if (texts.length === 0) {
    const synthesized = synthesizeTexts(id, meta, root);
    if (!synthesized) {
      violations.push(
        `${name}@${meta.version ?? '?'} (license: ${id}, but no license file and no synthesizable canonical text/author)`,
      );
      continue;
    }
    texts = [synthesized];
  }
  notices.push({ name, version: meta.version ?? '', id, texts });
}

if (violations.length) {
  console.error(
    `gen-notices: FAILED - bundled package(s) with a non-permissive or undeterminable license (not redistributable by bundling): ${violations.join('; ')}`,
  );
  process.exit(1);
}

// --- Attribute by copyright HOLDER, not package name --------------------------
// MIT / ISC / BSD require preserving each work's copyright and permission
// notice, not its npm package name, so group the bundled
// components by copyright holder and reproduce each distinct license text
// verbatim (that verbatim block IS the legal notice; the holder heading is
// derived from its copyright line). No package name is emitted.

// Distinct "Copyright ..." lines across a component's license/notice files.
function copyrightLines(texts) {
  const out = [];
  for (const t of texts)
    for (const raw of t.text.split('\n')) {
      const s = raw.trim();
      if (/^copyright\b/i.test(s) && !/^copyright notice\b/i.test(s)) out.push(s);
    }
  return [...new Set(out)];
}

// "Copyright (c) 2024 - present, Bereket Engida" -> "Bereket Engida".
function holderFromCopyright(line) {
  const withoutEmail = stripDelimitedSections(line, '<', '>');
  return withoutEmail
    .replace(/^copyright\b/i, '')
    .replace(/\(c\)|©/gi, '')
    .replace(/\b\d{4}\b(\s*[-–]\s*(present|\d{4}))?/gi, '') // year or year-range
    .replace(/\bpresent\b/gi, '')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Group by normalized holder; keep each group's distinct license ids + texts.
const groups = new Map();
let anon = 0;
for (const n of notices) {
  const holder = holderFromCopyright(copyrightLines(n.texts)[0] ?? '');
  const key = holder ? holder.toLowerCase() : `${String.fromCharCode(0)}anon-${anon++}`;
  let g = groups.get(key);
  if (!g) {
    g = { display: holder || `${n.id}-licensed component`, ids: new Set(), texts: new Set() };
    groups.set(key, g);
  }
  g.ids.add(n.id);
  for (const t of n.texts) g.texts.add(t.text.trim());
}
const grouped = [...groups.values()].sort((a, b) => a.display.localeCompare(b.display));

const outPath = join(pkgDir, 'THIRD_PARTY_NOTICES.md');
let body = `# Third-party notices

\`${pkg.name}\` bundles third-party components into its published \`dist/\`. Each
is redistributed under its own license, with the required copyright and
permission notices reproduced in full below, grouped by copyright holder. This
file is generated by \`scripts/gen-notices.mjs\`; do not edit by hand.
`;

if (grouped.length === 0) {
  body += '\nNo third-party code is bundled into this package.\n';
} else {
  for (const g of grouped) {
    body += `\n---\n\n## ${g.display}\n\nLicense: ${[...g.ids].sort().join(', ')}\n`;
    for (const text of [...g.texts].sort()) body += `\n\`\`\`\n${text}\n\`\`\`\n`;
  }
}

writeFileSync(outPath, body);
console.log(
  `gen-notices: wrote ${outPath} (${notices.length} component${notices.length === 1 ? '' : 's'} across ${grouped.length} copyright holder${grouped.length === 1 ? '' : 's'})`,
);
