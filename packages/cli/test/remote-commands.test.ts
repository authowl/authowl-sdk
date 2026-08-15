import { describe, expect, it, vi } from "vitest";
import type { CliCredential } from "../src/credentials";
import {
  runKeysCommand,
  runProjectsCommand,
  runWhoamiCommand,
} from "../src/remote-commands";

const projectId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const credential: CliCredential = {
  apiUrl: "https://authowl.dev",
  accessToken: `aoc_${"t".repeat(43)}`,
  scopes: ["projects:read"],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T01:00:00.000Z",
};

describe("authenticated CLI commands", () => {
  it("shows identity without exposing the stored bearer", async () => {
    const output = await runWhoamiCommand(
      {},
      {
        readCredential: async () => credential,
        getIdentity: async () => ({
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "owner@example.com",
          },
          workspace: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Cairo Shop",
          },
        }),
      },
    );
    expect(output).toContain("owner@example.com");
    expect(output).toContain("Cairo Shop");
    expect(output).not.toContain(credential.accessToken);
  });

  it("formats project and metadata-only key listings", async () => {
    const readCredential = async () => credential;
    const projects = await runProjectsCommand(
      {},
      {
        readCredential,
        listProjects: async () => [
          {
            id: projectId,
            applicationId,
            environmentType: "development",
            authBaseUrl: `https://authowl.dev/api/projects/${projectId}/auth`,
            name: "Next Fixture",
            slug: "next-fixture",
            allowedOrigins: ["http://localhost:3000"],
            authMethods: ["password", "passkey"],
          },
        ],
      },
    );
    expect(projects).toContain(projectId);
    expect(projects).toContain("development");
    expect(projects).toContain("password, passkey");

    const keys = await runKeysCommand(
      { projectId },
      {
        readCredential,
        listPublishableKeys: async () => [
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Next local",
            prefix: "pk_live",
            last4: "Ab29",
            createdAt: "2026-07-14T00:10:00.000Z",
            lastUsedAt: null,
          },
        ],
      },
    );
    expect(keys).toContain("pk_live_...Ab29");
    expect(keys).not.toContain(credential.accessToken);
  });

  it("supports stable JSON envelopes", async () => {
    const result = await runProjectsCommand(
      { json: true },
      {
        readCredential: async () => credential,
        listProjects: async () => [],
      },
    );
    expect(JSON.parse(result)).toEqual({ projects: [] });
  });

  it("neutralizes terminal controls in human-readable server data", async () => {
    const output = await runWhoamiCommand(
      {},
      {
        readCredential: async () => credential,
        getIdentity: async () => ({
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "owner\u001b[31m@example.com",
          },
          workspace: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Cairo\nShop",
          },
        }),
      },
    );
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("Cairo\nShop");
    expect(output).toContain("owner�[31m@example.com");
    expect(output).toContain("Cairo�Shop");
  });

  it("requires login, a project id, and a matching API origin", async () => {
    await expect(
      runWhoamiCommand({}, { readCredential: async () => null }),
    ).rejects.toThrow("authowl login");
    await expect(
      runKeysCommand({}, { readCredential: vi.fn(async () => credential) }),
    ).rejects.toThrow("--project-id");
    await expect(
      runProjectsCommand(
        { apiUrl: "https://other.example.com" },
        { readCredential: async () => credential },
      ),
    ).rejects.toThrow("logged in to https://authowl.dev");
  });
});
