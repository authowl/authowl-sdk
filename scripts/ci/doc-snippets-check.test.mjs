import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checker = path.join(repoRoot, 'scripts/ci/doc-snippets-check.mjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'authowl-doc-snippets-test-'));

const rootBlock = `\`\`\`ts test="root"
import type { BillingClient } from '@authowl/billing';
export const client = null as unknown as BillingClient;
\`\`\``;
const reactBlock = `\`\`\`ts test="react-types"
import type { ProtectProps } from '@authowl/billing/react';
export const feature: ProtectProps['feature'] = 'reports';
\`\`\``;
const serverBlock = `\`\`\`ts test="server"
import { checkFeature } from '@authowl/billing/server';
void checkFeature({ feature: 'reports' }, {
  secretKey: process.env.AUTHOWL_SECRET_KEY!,
  apiUrl: process.env.AUTHOWL_API_URL!,
});
\`\`\``;
const jsxBlock = `\`\`\`tsx test="combined"
import { Protect } from '@authowl/billing/react';
import { requireFeature } from '@authowl/billing/server';
void requireFeature({ feature: 'reports' });
export const view = <Protect feature="reports">Reports</Protect>;
\`\`\``;
const passingBlocks = [rootBlock, reactBlock, serverBlock, jsxBlock];

function run(name, source) {
  const readme = path.join(temporary, `${name}.md`);
  fs.writeFileSync(readme, source);
  return spawnSync(process.execPath, [checker, '--readme', readme], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

try {
  const passing = run('passing', passingBlocks.join('\n\n'));
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /doc-snippets: 4 blocks, 3 entries, OK/);

  const broken = run('broken', [
    ...passingBlocks,
    '```ts test="broken-block"\nconst value: string = 1;\n```',
  ].join('\n\n'));
  assert.equal(broken.status, 1);
  assert.match(`${broken.stdout}${broken.stderr}`, /broken-block/);

  const wrongArgument = run('wrong-argument', [
    ...passingBlocks,
    '```ts test="wrong-argument"\nimport { requireFeature } from \'@authowl/billing/server\';\nvoid requireFeature({ feature: 1 });\n```',
  ].join('\n\n'));
  assert.equal(wrongArgument.status, 1);
  assert.match(`${wrongArgument.stdout}${wrongArgument.stderr}`, /wrong-argument/);

  const missingImport = run('missing-import', [
    ...passingBlocks,
    '```ts test="missing-import"\nimport { missingFeatureHelper } from \'@authowl/billing/server\';\nvoid missingFeatureHelper;\n```',
  ].join('\n\n'));
  assert.equal(missingImport.status, 1);
  assert.match(`${missingImport.stdout}${missingImport.stderr}`, /missing-import/);

  const transitiveType = run('transitive-type', [
    ...passingBlocks,
    '```ts test="transitive-type"\nimport type { FeatureDeniedError } from \'@authowl/billing/server\';\ndeclare const error: FeatureDeniedError;\nexport const status: 200 = error.status;\n```',
  ].join('\n\n'));
  assert.equal(transitiveType.status, 1);
  assert.match(`${transitiveType.stdout}${transitiveType.stderr}`, /transitive-type/);

  const untagged = run('untagged', [
    ...passingBlocks,
    '```ts\nexport {};\n```',
  ].join('\n\n'));
  assert.equal(untagged.status, 1);
  assert.match(`${untagged.stdout}${untagged.stderr}`, /every code block is tested/);

  const missing = run('missing-server', [rootBlock, reactBlock,
    '```tsx test="react-view"\nimport { Protect } from \'@authowl/billing/react\';\nexport const view = <Protect feature="reports">Reports</Protect>;\n```',
  ].join('\n\n'));
  assert.equal(missing.status, 1);
  assert.match(`${missing.stdout}${missing.stderr}`, /@authowl\/billing\/server/);

  console.log('doc-snippets self-test: 7 cases, OK');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
