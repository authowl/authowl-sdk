import { describe, expect, it, vi } from "vitest";
import type { CliCredential } from "../src/credentials";
import { CliApiError } from "../src/cli-api";
import {
  createCliProject,
  listCliProjects,
  waitForCliProjectActivation,
} from "../src/project-api";

const projectId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const authBaseUrl = `https://authowl.dev/api/projects/${projectId}/auth`;
const credential: CliCredential = {
  apiUrl: "https://authowl.dev",
  accessToken: `aoc_${"t".repeat(43)}`,
  scopes: ["projects:read", "projects:create", "keys:publishable:issue"],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T01:00:00.000Z",
};
const now = () => new Date("2026-07-14T00:30:00.000Z");

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function project(createdAt = true) {
  return {
    id: projectId,
    application_id: applicationId,
    environment_type: "development",
    auth_base_url: authBaseUrl,
    name: "Next Fixture",
    slug: "next-fixture-a1b2c3",
    allowed_origins: ["http://localhost:3000"],
    auth_methods: ["password", "passkey"],
    first_end_user_session_at: null,
    ...(createdAt ? { created_at: "2026-07-14T00:00:00.000Z" } : {}),
  };
}

describe("CLI project API client", () => {
  it("lists projects with the bearer only in the request header", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ projects: [project()] }));
    const projects = await listCliProjects(credential, { fetch: request, now });
    expect(projects).toEqual([
      {
        id: projectId,
        applicationId,
        environmentType: "development",
        authBaseUrl,
        name: "Next Fixture",
        slug: "next-fixture-a1b2c3",
        allowedOrigins: ["http://localhost:3000"],
        authMethods: ["password", "passkey"],
        createdAt: "2026-07-14T00:00:00.000Z",
        firstSessionAt: null,
      },
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://authowl.dev/api/cli/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${credential.accessToken}`,
        }),
      }),
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain(
      `"accessToken"`,
    );
  });

  it("creates a project with the requested configuration", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ project: project(false) }, 201));
    const created = await createCliProject(
      credential,
      {
        name: "Next Fixture",
        allowedOrigin: "http://localhost:3000",
        authMethods: ["password", "passkey"],
      },
      { fetch: request, now },
    );
    expect(created.id).toBe(projectId);
    expect(created).toMatchObject({
      applicationId,
      environmentType: "development",
      authBaseUrl,
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Next Fixture",
      allowed_origin: "http://localhost:3000",
      auth_methods: ["password", "passkey"],
    });
  });

  it.each([
    ["missing application id", { application_id: undefined }],
    ["invalid environment", { environment_type: "preview" }],
    ["invalid auth URL", { auth_base_url: "javascript:alert(1)" }],
    [
      "insecure remote auth URL",
      { auth_base_url: `http://authowl.dev/api/projects/${projectId}/auth` },
    ],
    [
      "mismatched auth URL",
      {
        auth_base_url:
          "https://authowl.dev/api/projects/33333333-3333-4333-8333-333333333333/auth",
      },
    ],
  ])("rejects %s", async (_case, invalid) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ projects: [{ ...project(), ...invalid }] }));
    await expect(
      listCliProjects(credential, { fetch: request, now }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("normalizes server errors without reflecting arbitrary response text", async () => {
    await expect(
      createCliProject(
        credential,
        {
          name: "Next",
          allowedOrigin: "http://localhost:3000",
          authMethods: ["password"],
        },
        {
          fetch: vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              response({ error: "\u001b[31mserver-controlled" }, 500),
            ),
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "http_500", status: 500 });
  });

  it("rejects expired credentials before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      listCliProjects(credential, {
        fetch: request,
        now: () => new Date("2026-07-14T01:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(CliApiError);
    expect(request).not.toHaveBeenCalled();
  });

  it("waits until the owned project reports its first real session", async () => {
    const activatedAt = "2026-07-14T00:31:00.000Z";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ projects: [project()] }))
      .mockResolvedValueOnce(
        response({
          projects: [{ ...project(), first_end_user_session_at: activatedAt }],
        }),
      );
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    let elapsed = 0;

    await expect(
      waitForCliProjectActivation(
        credential,
        projectId,
        {
          clock: () => elapsed,
          fetch: request,
          now,
          sleep: async (milliseconds) => {
            elapsed += milliseconds;
            await sleep(milliseconds);
          },
        },
        { intervalMs: 10, timeoutMs: 20 },
      ),
    ).resolves.toBe(activatedAt);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("times out without leaking or inventing an activation", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ projects: [project()] }));
    let elapsed = 0;
    await expect(
      waitForCliProjectActivation(
        credential,
        projectId,
        {
          clock: () => elapsed,
          fetch: request,
          now,
          sleep: async (milliseconds) => {
            elapsed += milliseconds;
          },
        },
        { intervalMs: 10, timeoutMs: 20 },
      ),
    ).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not report an activation returned after the deadline", async () => {
    let elapsed = 0;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      elapsed = 21;
      return response({
        projects: [
          {
            ...project(),
            first_end_user_session_at: "2026-07-14T00:31:00.000Z",
          },
        ],
      });
    });
    await expect(
      waitForCliProjectActivation(
        credential,
        projectId,
        { clock: () => elapsed, fetch: request, now },
        { intervalMs: 10, timeoutMs: 20 },
      ),
    ).resolves.toBeNull();
  });
});
