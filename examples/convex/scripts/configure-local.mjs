import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const convexBin = path.join(
  exampleRoot,
  process.platform === 'win32' ? 'node_modules/.bin/convex.cmd' : 'node_modules/.bin/convex',
);
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === '--') cliArgs.shift();
if (cliArgs.length !== 2) {
  throw new TypeError('Usage: pnpm configure:local -- <issuer> <audience>');
}
const [issuerInput, audienceInput] = cliArgs;
const issuer = validIssuer(issuerInput);
const audience = validAudience(audienceInput);
const local = await localDeploymentConfig();
const selfHostedEnv = {
  ...process.env,
  CONVEX_DEPLOYMENT: '',
  CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${local.cloudPort}`,
  CONVEX_SELF_HOSTED_ADMIN_KEY: local.adminKey,
};

run(['env', 'set', 'AUTHOWL_ISSUER_URL', issuer], { cwd: exampleRoot, env: selfHostedEnv });
run(['env', 'set', 'AUTHOWL_PROJECT_ID', audience], { cwd: exampleRoot, env: selfHostedEnv });
run(['dev', '--once', '--codegen', 'disable'], { cwd: exampleRoot, env: selfHostedEnv });

console.info('Configured and deployed the anonymous local Convex verifier.');

async function localDeploymentConfig() {
  const configPath = path.join(exampleRoot, '.convex/local/default/config.json');
  let value;
  try {
    value = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (cause) {
    throw new Error('Start `pnpm dev:convex` before configuring local auth.', { cause });
  }
  if (!isRecord(value) ||
      !isRecord(value.ports) ||
      !Number.isInteger(value.ports.cloud) ||
      typeof value.adminKey !== 'string' ||
      value.adminKey.length === 0) {
    throw new Error('Convex local deployment config is invalid.');
  }
  return { cloudPort: value.ports.cloud, adminKey: value.adminKey };
}

function validIssuer(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Issuer must be an absolute URL.');
  }
  if (url.username || url.password || !url.pathname.endsWith('/auth') || url.search || url.hash) {
    throw new TypeError('Issuer must be the AuthOwl environment auth URL.');
  }
  return url.toString().replace(/\/$/, '');
}

function validAudience(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '')) {
    throw new TypeError('Audience must be the AuthOwl environment UUID.');
  }
  return value;
}

function run(args, options) {
  const result = spawnSync(convexBin, args, { ...options, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Convex command failed with status ${result.status}.`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
