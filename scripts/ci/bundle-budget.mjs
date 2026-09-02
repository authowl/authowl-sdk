// Bundle budget guard (plan 11 task 0.5; budgets from plan 04).
//
// Measures the REAL gzipped browser payload a consumer ships: the published
// auth-react artifact bundled together with its whole runtime dependency graph
// (auth-core + the AuthOwl fetch/state client + WebAuthn helper), minified,
// with only react/react-dom left external - the host app already ships those as
// peer dependencies. Gating the raw `dist/index.js` on its own would be
// meaningless, because tsup leaves every dependency external, so a PR that
// bloats auth-core or pulls in a heavy runtime dep would still slip under the
// gate. Run after `pnpm run build`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// react/react-dom are @authowl/react peer deps the host app already bundles, so
// they are excluded from that measured payload. Core itself has no React
// dependency; keeping the same external list for both entries makes no change
// to its result.
const PEER_EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime'];

// Budgets are gzipped kilobytes. Plan 21.5 consciously raises @authowl/react
// from 50kb to 55kb after adding the Google Identity/FedCM lifecycle manager;
// the measured 49.9kb baseline keeps 10% headroom without weakening the gate.
// The @authowl/core row guards the framework-agnostic runtime payload:
// its published dist includes the first-party fetch/state client and reviewed
// WebAuthn helper, so this measures what a framework-agnostic consumer ships.
// Native-client baseline: 8.1kb gzip after named JWT template identity and
// policy-isolated caching on 2026-07-15.
//
// Org custom-permissions Slice C (2026-07-23) consciously raises both rows for
// the new advisory permission surface: @authowl/core gains the pure membership
// evaluators + `organization.has()`/`hasPermission()`/`listRoles()` (8.5->9.0),
// and @authowl/react gains `useOrganization()` + `<Protect role|permission>` +
// the server-driven role select (55->57). The pure server token verifier lives
// in the `@authowl/core/server` entry, so it is NOT in either measured browser
// payload. Both rows keep regression headroom over the measured size.
//
// Brand accent derivation P1-5 (2026-07-24) raises @authowl/react 57->60: the
// new brand.ts (OKLab/OKLCH color math + WCAG contrast solve + sRGB gamut clamp)
// that fixes the muddy accent adds ~1.4kb gz (measured 57.7->59.1). Core is
// untouched. The row keeps regression headroom over the 59.1kb measured size.
//
// Browser session-token containment (2026-07-26) raises core 9->9.5 and React
// 60->61. The exact-path response projector adds defense in depth for consumers
// running against an older server while preserving the separate short-lived
// backend JWT. Measured baselines are 9.2kb and 59.7kb respectively.
//
// Canonical browser transport (2026-07-26) raises core 9.5->11.5 and React
// 61->62.5. The required redirect refusal, total deadline, streamed byte cap,
// strict JSON boundary, safe error mapping, and retry policy measure 10.8kb in
// core and 61.5kb through React. This is reviewed security code, not dependency
// weight, and both rows retain explicit regression headroom.
//
// Session/account runtime DTO decoding (2026-07-26) raises core 11.5->12.5 and
// React 62.5->63.5. Exact shape construction prevents malformed JSON from
// becoming authenticated state, crashing account lists, or carrying unknown
// credential fields forward. Measured baselines are 11.6kb and 62.4kb.
//
// Organization runtime DTO decoding (2026-07-26) raises core 12.5->13.5 and
// React 63.5->64.5. Exact entity projection, tenant-id consistency checks, and
// bounded metadata/permission reconstruction prevent credential-shaped plugin
// fields or cross-organization rows from entering browser state. Measured
// baselines are 12.4kb and 63.2kb.
//
// WebAuthn runtime contract hardening (2026-07-26) raises core 13.5->16.5 and
// React 64.5->67.5. Bounded ceremony options, exact passkey/session projection,
// credential relation checks, extension-result stripping, and canonical name
// input prevent malformed or secret-bearing data from crossing the browser
// boundary. Measured baselines are 15.9kb and 66.8kb.
//
// Identity lifecycle adoption (2026-07-30) raises React 67.5->70. The central
// compatibility resolver, username sign-in, structured identity fields, code
// verification, and separate passkey-add/email-change controls measure 69.0kb.
// Core remains inside its existing budget.
//
// Canonical transport adoption (2026-07-30) raises core 16.5->18 and React
// 70->71.5. Public config, consent, token, Admin API, and JWKS now share the
// bounded transport and runtime response contracts. Measured baselines are
// 17.1kb and 70.0kb; the new rows retain explicit regression headroom.
//
// Akedly Shield phone-OTP challenge (plan 36) raises Core 18->19 and React
// 71.5->73. The runtime challenge decoder and lazy proof surface measure 18.2kb
// in Core; the server-selected challenge lookup, discriminated guard state,
// and conditional Turnstile/proof ceremony in <PhoneOTP /> measure 71.8kb in
// React. Both rows retain explicit regression headroom.
//
// Header session transports (2026-08-07) raise Core 19->21 and React 73->75.
// TWO causes, named separately rather than folded together, because one of them
// is debt this entry is regularizing rather than requesting:
//
//   1. The bearer session transport (sdk#132) merged OVER the existing budget
//      and nobody noticed. GitHub Actions are billing-paused, so `local-gate.sh`
//      is the only thing that runs this file, and it was not run before that
//      merge. `main` measures 19.7kb and 73.8kb TODAY, against ceilings of 19
//      and 73. That overage is stated here rather than absorbed silently, so the
//      history does not read as though this raise paid for one feature when it
//      paid for two.
//   2. The 2FA challenge transport adds the wire grammar, the per-name merge and
//      the session-scoped store: +0.5kb Core, +0.4kb React. Measured baselines
//      after both are 20.2kb and 74.2kb.
//
// The new ceilings keep 0.8kb of regression headroom on each row, matching what
// every prior entry above reserved. A size sweep is queued separately: this
// raise buys the release, it does not license drift.
//
// Required-MFA phone entry-point policy (2026-08-15) raises React 75->76. The
// sign-in resolver now hides phone OTP when every account must enter through
// password + TOTP, while optional MFA handles the typed TWO_FACTOR_REQUIRED
// response by returning enrolled users to password sign-in. The reviewed React
// payload measures 75.1kb; Core remains 20.8kb. The new ceiling preserves about
// 0.9kb of regression headroom.
//
// The provider package `@akedly/shield` is a direct dependency so consumer
// bundlers always resolve it. The measurement uses code splitting and follows
// static imports only, matching the initial browser payload: Shield remains in
// an on-demand chunk and is still built, rather than hidden behind an external.
// Tolerant organization display strings (2026-08-19) raise React 75->76. Core
// stays at 21: it measures 20.81kb.
//
// The change itself is small - two decoder helpers, `asDisplayString` and
// `asEmail`, so one member with no display name stops making the whole
// organization undecodable. Measured cost is +36 bytes gzipped through React and
// +48 through Core.
//
// It failed the gate anyway, and the reason matters more than the raise: `main`
// measures 76774 bytes, which is TWENTY-SIX bytes under this row's ceiling. The
// 2026-08-07 entry above states it reserved 0.8kb of regression headroom; that
// headroom was spent by intervening merges without anyone re-measuring, and the
// "size sweep queued separately" it promised never happened. So a 36-byte
// correctness fix is what finally reported a drift it did not cause.
//
// 76 restores roughly a kilobyte of real headroom against a measured 75.01kb.
// The sweep is still owed.
// Invitation redemption (2026-08-19) raises React 76->78 and Core 21->22.
// Measured 78398 and 21637 bytes: +1588 through React, +328 through Core.
//
// What it buys: the emailed organization invitation link produced no membership
// at all - nothing consumed the id it carries, so the invitee signed up and
// never joined while the flow reported success. The cost is the claim store, the
// redemption hook, a confirm modal, a pre-auth notice on both auth forms, and
// eleven catalog keys in two locales.
//
// A lazy chunk for the modal was tried first and REJECTED on measurement, not
// taste: 76.9kb lazy against 76.6kb static, because Suspense plus the chunk
// boundary cost more than the modal saves - the hook it needs is public API and
// stays in the entry either way. Recorded so the next person does not re-run the
// experiment.
//
// This is the second raise on the React row in one day, and that is worth saying
// plainly: the first regularized headroom that earlier merges had silently
// spent, and this one is a feature paying its own way. The size sweep the
// 2026-08-07 entry queued is still owed, and now visibly so.
// Team management (2026-08-20) raises React 78->80. Core stays at 22.
// Measured 79587 and 21909 bytes: +1351 through React, +195 through Core.
//
// What it buys: teams could be listed and selected from the client and nothing
// else. Creating, renaming, removing one, or moving a member in or out meant
// sending the end user to the AuthOwl dashboard - not because the platform
// lacked the routes, which have existed the whole time, but because the SDK
// never wrapped them. The cost is seven client methods with their decoders, a
// Teams section in <OrganizationProfile/>, and eight catalog keys in two
// locales.
//
// The raise is NOT because the feature overran. At 79587 it fits 78 with 285
// bytes to spare, and shipping that is the mistake this file already has on
// record: the 2026-08-07 entry left 0.8kb, intervening merges spent it without
// re-measuring, and a 36-byte correctness fix took the blame. 285 bytes is that
// story with a smaller number. 80 restores ~2.3kb of real headroom.
//
// Third raise on the React row in two days. The size sweep queued on 2026-08-07
// is now well overdue, and this entry is the strongest argument yet for doing
// it: the row has grown 75->80 while the sweep stayed queued.
//
// React payload sweep (2026-08-22) lowers React 80->72. A source-level esbuild
// metafile showed qrcode-generator as the largest avoidable item in the initial
// entry: 20.4kb minified before gzip, even though it is used only after a user
// starts TOTP enrollment. QrCode now loads that package-owned encoder chunk on
// demand. The otpauth value is still processed entirely in the browser and the
// manual key remains visible while the chunk loads or if it fails.
//
// The measured initial payload drops from 78.8kb to 71.1kb gzip. The 72kb row
// keeps roughly 0.9kb of explicit headroom and pays back every increase since
// the original 73kb ceiling. The on-demand QR chunk is intentionally outside
// this initial-payload row, just like Shield and TeamsSection; esbuild still
// builds and resolves it, so the dependency cannot disappear unnoticed.
// Last-used sign-in memory (2026-08-27) raises React 72->73. Recording every
// successful in-page method plus truthfully settling redirect methods measures
// 72.1kb after removing redundant storage APIs and compacting the pending state.
// The 73kb row preserves roughly 0.9kb of regression headroom.
// Request-locale propagation (2026-08-27) raises Core 22->23. The scoped locale
// registry and outgoing request header measure 22.1kb after combining with the
// new MCP and sign-in-memory surfaces. The 23kb row preserves roughly 0.9kb of
// regression headroom rather than hiding the combined cost in a retry.
// PDPL managed surfaces (2026-08-28) keep both ceilings unchanged. Privacy
// sign-up evidence now has a focused Core subpath, and the privacy center plus
// organization administration surfaces load on demand behind stable component
// wrappers. The initial React payload measures 72.0kb and Core remains below
// 23kb, so the compliance features ship without taxing unrelated auth screens.
// Hosted auth canonical issuers (2026-08-31) raise Core 23->24. The decoder now
// accepts the stable platform issuer when a hosted or custom account portal uses
// a different origin, while retaining exact project path, JWKS, audience, and
// HTTPS checks. Main measured 22.9961kb, leaving only four bytes of headroom;
// the fix measures 23.0264kb (+31 bytes). The new row restores roughly 1kb of
// regression headroom. React remains inside its existing ceiling.
//
// High-assurance MFA capabilities (2026-09-02) raise React 73->73.25 while
// Core stays at 24. The validated public-config fields and localized recovery
// policy keep the SDK UI aligned with the server's enforced boundary. React
// measures 73.03kb, just 31 bytes above the old ceiling; the quarter-kilobyte
// row records that cost explicitly while retaining narrow regression headroom.
// Framework session projection (2026-09-02) raises Core 24->24.5 and React
// 73.25->73.75. The sanctioned integration replaces a shadow transport and
// URL-based lifecycle guessing in @authowl/next, while making successful
// sign-in and sign-out wait for the app-origin HttpOnly session projection.
// Measured baselines are 24.09kb in Core and 73.25kb through React; the new
// ceilings retain roughly half a kilobyte of explicit regression headroom.
const BUDGETS = [
  {
    entry: 'packages/auth-react/dist/index.js',
    maxGzipKb: 73.75,
    label: '@authowl/react (provider + hooks + components)',
  },
  {
    entry: 'packages/auth-core/dist/index.js',
    maxGzipKb: 24.5,
    label: '@authowl/core (framework-neutral fetch/state client)',
  },
];

async function measureGzipKb(entry) {
  const absoluteEntry = resolve(root, entry);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [absoluteEntry],
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    write: false,
    splitting: true,
    outdir: 'bundle-budget-output',
    metafile: true,
    external: PEER_EXTERNALS,
    logLevel: 'silent',
  });

  const outputs = result.metafile.outputs;
  const entryOutput = Object.entries(outputs).find(([, metadata]) =>
    metadata.entryPoint && resolve(root, metadata.entryPoint) === absoluteEntry)?.[0];
  if (!entryOutput) throw new Error(`Could not identify bundle entry for ${entry}`);

  const initialOutputs = new Set();
  const visitStaticImports = (outputPath) => {
    if (initialOutputs.has(outputPath)) return;
    initialOutputs.add(outputPath);
    for (const imported of outputs[outputPath]?.imports ?? []) {
      if (imported.external || imported.kind === 'dynamic-import') continue;
      const resolvedPath = outputs[imported.path]
        ? imported.path
        : relative(root, resolve(root, dirname(outputPath), imported.path));
      if (outputs[resolvedPath]) visitStaticImports(resolvedPath);
    }
  };
  visitStaticImports(entryOutput);

  const filesByPath = new Map(result.outputFiles.map((file) => [
    relative(root, file.path),
    file,
  ]));
  const gzipBytes = [...initialOutputs].reduce((total, outputPath) => {
    const file = filesByPath.get(outputPath);
    if (!file) throw new Error(`Missing generated output ${outputPath}`);
    return total + gzipSync(Buffer.from(file.contents)).length;
  }, 0);
  return gzipBytes / 1024;
}

let failed = false;
const corePackage = JSON.parse(readFileSync(resolve(root, 'packages/auth-core/package.json'), 'utf8'));
if (!corePackage.dependencies?.['@akedly/shield'] || corePackage.peerDependencies?.['@akedly/shield']) {
  console.error('bundle-budget: @akedly/shield must remain a direct @authowl/core dependency');
  failed = true;
}
console.log('bundle-budget (gzipped browser payload, react/react-dom external):');
for (const b of BUDGETS) {
  if (!existsSync(resolve(root, b.entry))) {
    console.error(`  MISSING  ${b.entry} - run \`pnpm run build\` first`);
    failed = true;
    continue;
  }
  const kb = await measureGzipKb(b.entry);
  const ok = kb <= b.maxGzipKb;
  console.log(`  [${ok ? 'OK  ' : 'OVER'}] ${b.label}: ${kb.toFixed(2)}kb / ${b.maxGzipKb}kb`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('bundle-budget: FAILED');
  process.exit(1);
}
console.log('bundle-budget: OK');
