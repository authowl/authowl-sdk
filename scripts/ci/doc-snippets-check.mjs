import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultReadme = path.join(repoRoot, 'packages/billing/README.md');
const paths = {
  '@authowl/billing': [path.join(repoRoot, 'packages/billing/dist/index.d.ts')],
  '@authowl/billing/react': [path.join(repoRoot, 'packages/billing/dist/react.d.ts')],
  '@authowl/billing/server': [path.join(repoRoot, 'packages/billing/dist/server.d.ts')],
  '@authowl/core': [path.join(repoRoot, 'packages/auth-core/dist/index.d.ts')],
  '@authowl/core/server': [path.join(repoRoot, 'packages/auth-core/dist/server.d.ts')],
  '@authowl/react': [path.join(repoRoot, 'packages/auth-react/dist/index.d.ts')],
  '@authowl/next/server': [path.join(repoRoot, 'packages/auth-next/dist/server.d.ts')],
  react: [path.join(repoRoot, 'node_modules/@types/react/index.d.ts')],
  'react/jsx-runtime': [path.join(repoRoot, 'node_modules/@types/react/jsx-runtime.d.ts')],
};
const entries = Object.keys(paths)
  .filter((name) => name.startsWith('@authowl/billing'));

function readmeArgument(argv) {
  if (argv.length === 0) return defaultReadme;
  if (argv.length === 2 && argv[0] === '--readme') return path.resolve(argv[1]);
  throw new Error('Usage: doc-snippets-check.mjs [--readme <path>]');
}

function extractBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  const ids = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const opening = /^```(ts|tsx) test="([a-z0-9-]+)"$/.exec(line);
    if (!opening) {
      if (line === '```bash') {
        index += 1;
        while (index < lines.length && lines[index] !== '```') index += 1;
        if (index === lines.length) throw new Error('Unclosed bash code block.');
        continue;
      }
      if (/^\s*(?:```|~~~)/.test(line)) {
        throw new Error(`README line ${index + 1}: every code block is tested and needs a test tag.`);
      }
      continue;
    }
    const [, language, id] = opening;
    if (ids.has(id)) throw new Error(`Duplicate doc snippet id: ${id}.`);
    ids.add(id);
    const body = [];
    const codeLine = index + 2;
    index += 1;
    while (index < lines.length && lines[index] !== '```') {
      body.push(lines[index]);
      index += 1;
    }
    if (index === lines.length) throw new Error(`Unclosed doc snippet: ${id}.`);
    blocks.push({ id, language, codeLine, source: body.join('\n') });
  }
  return blocks;
}

function compilerOptions() {
  const converted = ts.convertCompilerOptionsFromJson({
    strict: true,
    jsx: 'react-jsx',
    module: 'esnext',
    moduleResolution: 'bundler',
    moduleDetection: 'force',
    target: 'es2022',
    lib: ['es2022', 'dom', 'dom.iterable'],
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
    typeRoots: [path.join(repoRoot, 'node_modules/@types')],
    paths,
  }, repoRoot);
  if (converted.errors.length > 0) {
    throw new Error(ts.flattenDiagnosticMessageText(converted.errors[0].messageText, '\n'));
  }
  return converted.options;
}

function importedEntries(program, files) {
  const imported = new Set();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && entries.includes(statement.moduleSpecifier.text)) {
        imported.add(statement.moduleSpecifier.text);
      }
    }
  }
  return imported;
}

function run() {
  const readme = readmeArgument(process.argv.slice(2));
  for (const mapped of Object.values(paths).flat()) {
    if (mapped.includes(`${path.sep}dist${path.sep}`) && !fs.existsSync(mapped)) {
      throw new Error(`MISSING ${path.relative(repoRoot, mapped)}: run pnpm build first.`);
    }
  }

  const blocks = extractBlocks(fs.readFileSync(readme, 'utf8'));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'authowl-doc-snippets-'));
  try {
    const blockByFile = new Map();
    const files = blocks.map((block) => {
      const file = path.join(temporary, `${block.id}.${block.language}`);
      fs.writeFileSync(file, block.source);
      blockByFile.set(path.resolve(file), block);
      return file;
    });
    const program = ts.createProgram(files, compilerOptions());
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        const block = diagnostic.file
          ? blockByFile.get(path.resolve(diagnostic.file.fileName))
          : undefined;
        if (block && diagnostic.start !== undefined) {
          const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          console.error(`${block.id}:${block.codeLine + position.line}: ${message}`);
        } else {
          console.error(`doc-snippets: ${message}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const imported = importedEntries(program, files);
    for (const entry of entries) {
      if (!imported.has(entry)) throw new Error(`No tested block imports ${entry}.`);
    }
    console.log(`doc-snippets: ${blocks.length} blocks, ${entries.length} entries, OK`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
