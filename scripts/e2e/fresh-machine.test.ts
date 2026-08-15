import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixture,
  e2eEnvironment,
  prepareWorkspace,
  type Fixture,
  type FreshMachineWorkspace,
} from "./fixtures";
import {
  capture,
  cleanEnvironment,
  cleanupChildren,
  redact,
  trackedSpawn,
  waitForHttp,
} from "./process";

const repository = resolve(import.meta.dirname, "../..");
const apiUrl = process.env.AUTHOWL_E2E_URL;
if (!apiUrl) {
  throw new Error("AUTHOWL_E2E_URL is required for the fresh-machine E2E");
}
const apiOrigin = new URL(apiUrl).origin;
const maximumSeconds = 300;
let workspace: FreshMachineWorkspace;

beforeAll(async () => {
  workspace = await prepareWorkspace(repository);
});

afterAll(async () => {
  cleanupChildren();
  if (workspace) await rm(workspace.root, { recursive: true, force: true });
});

describe.sequential("fresh-machine AuthOwl onboarding", () => {
  it.each([
    { framework: "next" as const, port: 3101 },
    { framework: "vite" as const, port: 5101 },
  ])(
    "$framework reaches a real signed-in user in under five minutes",
    async ({ framework, port }) => {
      const fixture = await createFixture(workspace, framework, port);
      const startedAt = performance.now();
      const cli = trackedSpawn(
        workspace.npxPath,
        [
          "--prefix",
          fixture.runner,
          "--no-install",
          "authowl",
          "init",
          "--api-url",
          apiUrl,
          "--auth-methods",
          "password",
          "--cwd",
          fixture.application,
          "--no-open",
          "--project-name",
          `Fresh ${framework} ${randomUUID().slice(0, 8)}`,
          "--yes",
        ],
        {
          cwd: fixture.application,
          env: await e2eEnvironment(workspace, fixture),
        },
      );
      const output = capture(cli);

      const codeMatch = await output.waitFor(
        /Device code: ([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})/,
        30_000,
      );
      await createPlatformAccountAndApprove(codeMatch[1]!);

      await output.waitFor(/AuthOwl is ready\. Open /, 180_000);
      const configuration = await readGeneratedConfiguration(fixture);
      const application = trackedSpawn(workspace.npmPath, ["run", "dev"], {
        cwd: fixture.application,
        env: { ...cleanEnvironment(), NODE_ENV: undefined },
      });
      const applicationOutput = capture(application);
      await waitForHttp(`${fixture.origin}/sign-in`, 60_000, applicationOutput);
      await createAndConfirmEndUser(fixture, configuration);

      const exitCode = await output.exit(30_000);
      expect(exitCode, output.safe()).toBe(0);
      expect(
        output.text().includes("First signed-in user detected"),
        output.safe(),
      ).toBe(true);
      expect(containsCredential(output.text()), output.safe()).toBe(false);
      expect(
        containsCredential(applicationOutput.text()),
        applicationOutput.safe(),
      ).toBe(false);
      const elapsedSeconds = (performance.now() - startedAt) / 1_000;
      expect(elapsedSeconds).toBeLessThan(maximumSeconds);
      process.stdout.write(
        `fresh-machine ${framework}: ${elapsedSeconds.toFixed(1)}s to confirmed session\n`,
      );
      application.kill("SIGTERM");
    },
    360_000,
  );
});

async function createPlatformAccountAndApprove(
  userCode: string,
): Promise<void> {
  const id = randomUUID();
  const signup = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: apiOrigin },
    body: JSON.stringify({
      email: `fresh-platform-${id}@e2e.local`,
      password: `Fresh-platform-${id}!`,
      name: "Fresh Machine Owner",
    }),
  });
  expect(signup.status, await safeResponse(signup)).toBe(200);
  const approval = await fetch(`${apiUrl}/api/cli/device/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: responseCookie(signup),
      origin: apiOrigin,
    },
    body: JSON.stringify({ user_code: userCode, decision: "approve" }),
  });
  expect(approval.status, await safeResponse(approval)).toBe(200);
}

async function readGeneratedConfiguration(fixture: Fixture): Promise<{
  projectId: string;
  publishableKey: string;
}> {
  const env = await readFile(fixture.envFile, "utf8");
  const publishableKey = env.match(
    /(?:NEXT_PUBLIC_|VITE_)?AUTHOWL_PUBLISHABLE_KEY=(pk_(?:live|test)_[A-Za-z0-9_-]+)/,
  )?.[1];
  if (!publishableKey) throw new Error("Generated publishable key is missing");
  const projectId = publishableKey.match(
    /^pk_(?:live|test)_([0-9a-f-]{36})_/i,
  )?.[1];
  if (!projectId) throw new Error("Generated project id is missing");
  return { projectId, publishableKey };
}

async function createAndConfirmEndUser(
  fixture: Fixture,
  configuration: { projectId: string; publishableKey: string },
): Promise<void> {
  const email = `fresh-user-${randomUUID()}@e2e.local`;
  const base = `${apiUrl}/api/projects/${configuration.projectId}/auth`;
  const headers = {
    "content-type": "application/json",
    origin: fixture.origin,
    "x-publishable-key": configuration.publishableKey,
  };
  const signup = await fetch(`${base}/sign-up/email`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password: `Fresh-user-${randomUUID()}!`,
      name: "First User",
    }),
  });
  expect(signup.status, await safeResponse(signup)).toBe(200);
  const session = await fetch(`${base}/get-session`, {
    headers: { ...headers, cookie: responseCookie(signup) },
  });
  expect(session.status, await safeResponse(session)).toBe(200);
  const body = (await session.json()) as {
    user?: { email?: string };
    session?: unknown;
  };
  expect(body.user?.email).toBe(email);
  expect(body.session).toBeTruthy();
}

function responseCookie(response: Response): string {
  const values = response.headers.getSetCookie?.() ?? [];
  const source =
    values.length > 0 ? values : [response.headers.get("set-cookie") ?? ""];
  const cookie = source
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("Expected a session cookie");
  return cookie;
}

async function safeResponse(response: Response): Promise<string> {
  return redact(await response.clone().text());
}

function containsCredential(value: string): boolean {
  return /(?:aoc|pk|sk)_(?:live_|test_)?[A-Za-z0-9_-]{12,}/.test(value);
}
