import { spawnSync } from 'node:child_process';

const REGISTRY = 'https://registry.npmjs.org/';
// npm learned OIDC trusted publishing in 11.5.1. Below that the CLI ignores the
// workflow's OIDC credentials and fails with a bare authentication error, so
// the version is checked up front where the message can say why.
const TRUSTED_PUBLISHING_NPM = [11, 5, 1];

export async function publishRelease(release, publishOptions) {
  const registryState = release.packages.map((entry) => ({
    entry,
    state: inspectRegistry(entry),
  }));
  for (const { entry, state } of registryState) {
    if (state.status === 'published' && state.integrity !== entry.integrity) {
      throw new Error(
        `release publish: ${entry.name}@${entry.version} already exists with different bytes`,
      );
    }
  }

  process.stdout.write(
    `release publish: ${publishOptions.dryRun ? 'dry run' : 'LIVE'} to ${REGISTRY}\n`,
  );
  for (const { entry, state } of registryState) {
    process.stdout.write(
      `  ${entry.name}@${entry.version} ${state.status === 'published' ? '(already verified)' : ''}\n`,
    );
  }

  if (!publishOptions.dryRun) assertPublishIdentity(publishOptions);

  for (const { entry, state } of registryState) {
    if (state.status === 'published') continue;
    const args = [
      'publish',
      `./${entry.filename}`,
      '--access=public',
      `--tag=${publishOptions.tag}`,
      `--registry=${REGISTRY}`,
    ];
    if (publishOptions.dryRun) args.push('--dry-run');
    run('npm', args, {
      cwd: release.releaseDirectory,
      stdio: 'inherit',
    });
    if (!publishOptions.dryRun) {
      await waitForPublishedIntegrity(entry);
    }
  }

  process.stdout.write(
    publishOptions.dryRun
      ? 'release publish: dry run passed; rerun with --confirm to publish\n'
      : 'release publish: all package integrities verified on npm\n',
  );
}

// Two ways to prove who is publishing. Locally it is a logged-in npm account.
// In GitHub Actions it is OIDC trusted publishing: `npm publish` exchanges the
// workflow's identity token for a short-lived, package-scoped credential, so
// there is no account to name and `npm whoami` has nothing to answer.
function assertPublishIdentity(publishOptions) {
  if (!publishOptions.trustedPublishing) {
    const username = run('npm', ['whoami', `--registry=${REGISTRY}`], {
      capture: true,
    }).stdout.trim();
    if (!username) throw new Error('release publish: npm authentication returned no username');
    process.stdout.write(`release publish: authenticated as ${username}\n`);
    return;
  }
  if (
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      'release publish: --trusted-publishing needs GitHub Actions OIDC (permissions: id-token: write)',
    );
  }
  const version = run('npm', ['--version'], { capture: true }).stdout.trim();
  if (!supportsTrustedPublishing(version)) {
    throw new Error(
      `release publish: npm ${version} predates trusted publishing; ` +
        `install npm >= ${TRUSTED_PUBLISHING_NPM.join('.')}`,
    );
  }
  process.stdout.write(
    `release publish: authenticating with OIDC trusted publishing (npm ${version})\n`,
  );
}

export function supportsTrustedPublishing(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!parts) throw new Error('release publish: npm reported an unreadable version');
  const actual = parts.slice(1, 4).map(Number);
  for (const [index, minimum] of TRUSTED_PUBLISHING_NPM.entries()) {
    if (actual[index] !== minimum) return actual[index] > minimum;
  }
  return true;
}

function inspectRegistry(entry) {
  const result = run(
    'npm',
    [
      'view',
      `${entry.name}@${entry.version}`,
      'dist.integrity',
      '--json',
      `--registry=${REGISTRY}`,
    ],
    { capture: true, allowFailure: true },
  );
  if (result.status === 0) {
    let integrity;
    try {
      integrity = JSON.parse(result.stdout);
    } catch {
      throw new Error(`release publish: npm returned invalid metadata for ${entry.name}`);
    }
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
      throw new Error(`release publish: npm returned no integrity for ${entry.name}`);
    }
    return { status: 'published', integrity };
  }
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (/\bE404\b|404 Not Found/.test(diagnostic)) {
    return { status: 'absent' };
  }
  throw new Error(`release publish: npm registry lookup failed for ${entry.name}`);
}

async function waitForPublishedIntegrity(entry) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = inspectRegistry(entry);
    if (state.status === 'published') {
      if (state.integrity !== entry.integrity) {
        throw new Error(
          `release publish: registry integrity mismatch for ${entry.name}@${entry.version}`,
        );
      }
      process.stdout.write(
        `release publish: verified ${entry.name}@${entry.version} (${entry.sha256})\n`,
      );
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`release publish: timed out verifying ${entry.name}@${entry.version}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
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
