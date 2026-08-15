import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliCredential } from "../src/credentials";
import type { ProjectDetection } from "../src/detect";
import { parseAuthMethods, runInit } from "../src/init";
import type { CliPrompt } from "../src/prompt";

const roots: string[] = [];
const projectId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const accessToken = `aoc_${"t".repeat(43)}`;
const publishableKey = `pk_live_${projectId}_${"p".repeat(32)}`;
const credential: CliCredential = {
  apiUrl: "https://api.authowl.test",
  accessToken,
  scopes: ["projects:read", "projects:create", "keys:publishable:issue"],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T02:00:00.000Z",
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("init orchestration", () => {
  it("reuses a valid login and eligible project without printing credentials", async () => {
    const root = await applicationRoot();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ projects: [project(true)] }))
      .mockResolvedValueOnce(response({ publishable_key: publishableKey }, 201))
      .mockResolvedValueOnce(response({ projects: [project(true, true)] }));
    const generate = vi.fn(async () => ({
      files: ["app/layout.tsx"],
      route: "http://localhost:3010/sign-in",
    }));
    const output: string[] = [];

    const result = await runInit(
      { cwd: root },
      {
        api: { fetch: request, now: fixedNow, sleep: async () => undefined },
        detect: async () => detection(root),
        generate,
        generator: { plan: async () => [] },
        now: fixedNow,
        readCredential: async () => credential,
        write: (line) => output.push(line),
      },
    );

    expect(result.route).toBe("http://localhost:3010/sign-in");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ publishableKey, apiUrl: credential.apiUrl }),
      expect.any(Object),
    );
    expect(output.join("\n")).not.toContain(accessToken);
    expect(output.join("\n")).not.toContain(publishableKey);
  });

  it("creates a project with selected methods when no eligible project exists", async () => {
    const root = await applicationRoot();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ projects: [] }))
      .mockResolvedValueOnce(response({ project: project(false) }, 201))
      .mockResolvedValueOnce(response({ publishable_key: publishableKey }, 201))
      .mockResolvedValueOnce(response({ projects: [project(true, true)] }));

    await runInit(
      {
        authMethods: "password,passkey",
        cwd: root,
        projectName: "  Cairo Shop  ",
        yes: true,
      },
      {
        api: { fetch: request, now: fixedNow, sleep: async () => undefined },
        detect: async () => detection(root),
        generate: async () => ({ files: [], route: "/sign-in" }),
        generator: { plan: async () => [] },
        now: fixedNow,
        readCredential: async () => credential,
        write: () => undefined,
      },
    );

    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      name: "Cairo Shop",
      allowed_origin: "http://localhost:3010",
      auth_methods: ["password", "passkey"],
    });
  });

  it("accepts a safe Vite React detection through the framework adapter", async () => {
    const root = await applicationRoot();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ projects: [project(true)] }))
      .mockResolvedValueOnce(response({ publishable_key: publishableKey }, 201))
      .mockResolvedValueOnce(response({ projects: [project(true, true)] }));
    const plan = vi.fn(async () => []);
    const generate = vi.fn(async () => ({
      files: ["src/main.tsx"],
      route: "http://localhost:3010/sign-in",
    }));

    await runInit(
      { cwd: root },
      {
        api: { fetch: request, now: fixedNow, sleep: async () => undefined },
        detect: async () =>
          detection(root, {
            framework: "vite-react",
            frameworkVersion: "7.0.0",
            sourceRoot: "src",
          }),
        generate,
        generator: { plan },
        now: fixedNow,
        readCredential: async () => credential,
        write: () => undefined,
      },
    );

    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({
        detection: expect.objectContaining({ framework: "vite-react" }),
      }),
    );
    expect(generate).toHaveBeenCalled();
  });

  it("preflights before login and cancels a dirty worktree without side effects", async () => {
    const root = await applicationRoot();
    const login = vi.fn();
    const plan = vi.fn(async () => []);
    const prompt = promptStub({ confirm: false });
    await expect(
      runInit(
        { cwd: root },
        {
          detect: async () => detection(root, { dirtyWorktree: true }),
          generator: { plan },
          login,
          prompt,
          write: () => undefined,
        },
      ),
    ).rejects.toThrow("cancelled");
    expect(plan).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("uses a fresh login when an explicit API origin differs", async () => {
    const root = await applicationRoot();
    const replacement = {
      ...credential,
      apiUrl: "https://other.authowl.test",
    };
    const login = vi.fn(async () => replacement);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ projects: [project(true)] }))
      .mockResolvedValueOnce(response({ publishable_key: publishableKey }, 201))
      .mockResolvedValueOnce(response({ projects: [project(true, true)] }));
    await runInit(
      { apiUrl: replacement.apiUrl, cwd: root },
      {
        api: { fetch: request, now: fixedNow, sleep: async () => undefined },
        detect: async () => detection(root),
        generate: async () => ({ files: [], route: "/sign-in" }),
        generator: { plan: async () => [] },
        login,
        now: fixedNow,
        readCredential: async () => credential,
        write: () => undefined,
      },
    );
    expect(login).toHaveBeenCalled();
  });

  it("routes undo without login or project API calls", async () => {
    const root = await applicationRoot();
    const undo = vi.fn(async () => ({
      files: ["app/layout.tsx"],
      dependencySyncOk: false,
    }));
    const output: string[] = [];
    await expect(
      runInit(
        { cwd: root, undo: true },
        {
          detect: async () => detection(root),
          undo,
          write: (line) => output.push(line),
        },
      ),
    ).resolves.toEqual({ files: ["app/layout.tsx"] });
    expect(undo).toHaveBeenCalled();
    expect(output.join("\n")).toContain("dependency sync failed");
  });
});

describe("auth method parsing", () => {
  it("accepts unique supported combinations", () => {
    expect(parseAuthMethods("password, passkey")).toEqual([
      "password",
      "passkey",
    ]);
  });

  it.each(["", "passkey", "password,password", "password,sms"])(
    "rejects %s",
    (value) => expect(() => parseAuthMethods(value)).toThrow(),
  );
});

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function project(includeCreatedAt: boolean, activated = false) {
  return {
    id: projectId,
    application_id: applicationId,
    environment_type: "development",
    auth_base_url: `https://api.authowl.test/api/projects/${projectId}/auth`,
    name: "Cairo Shop",
    slug: "cairo-shop-a1b2c3",
    allowed_origins: ["http://localhost:3010"],
    auth_methods: ["password", "passkey"],
    ...(includeCreatedAt
      ? {
          first_end_user_session_at: activated
            ? "2026-07-14T01:01:00.000Z"
            : null,
        }
      : {}),
    ...(includeCreatedAt ? { created_at: "2026-07-14T00:00:00.000Z" } : {}),
  };
}

function fixedNow(): Date {
  return new Date("2026-07-14T01:00:00.000Z");
}

async function applicationRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "authowl-init-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), '{"name":"fixture-app"}\n');
  return root;
}

function detection(
  root: string,
  overrides: Partial<ProjectDetection> = {},
): ProjectDetection {
  return {
    root,
    framework: "next-app",
    frameworkVersion: "15.5.0",
    packageManager: "npm",
    packageManagerRoot: root,
    packageManagerEvidence: ["package-lock.json:npm"],
    sourceRoot: ".",
    typescript: true,
    ports: [3010],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
    ...overrides,
  };
}

function promptStub(values: { confirm?: boolean } = {}): CliPrompt {
  return {
    input: async (_message, defaultValue) => defaultValue ?? "",
    confirm: async () => values.confirm ?? true,
    select: async (_message, choices) => choices[0]!.value,
  };
}
