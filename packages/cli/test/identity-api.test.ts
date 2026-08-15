import { describe, expect, it, vi } from "vitest";
import type { CliCredential } from "../src/credentials";
import { getCliIdentity } from "../src/identity-api";

const credential: CliCredential = {
  apiUrl: "https://authowl.dev",
  accessToken: `aoc_${"t".repeat(43)}`,
  scopes: ["projects:read"],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T01:00:00.000Z",
};
const now = () => new Date("2026-07-14T00:30:00.000Z");

describe("CLI identity API client", () => {
  it("reads the bearer-bound user and workspace identity", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "owner@example.com",
          },
          workspace: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Cairo Shop",
          },
        }),
      ),
    );
    await expect(
      getCliIdentity(credential, { fetch: request, now }),
    ).resolves.toEqual({
      user: {
        id: "22222222-2222-4222-8222-222222222222",
        email: "owner@example.com",
      },
      workspace: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Cairo Shop",
      },
    });
    expect(request).toHaveBeenCalledWith(
      "https://authowl.dev/api/cli/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${credential.accessToken}`,
        }),
      }),
    );
  });

  it("rejects malformed identity responses", async () => {
    await expect(
      getCliIdentity(credential, {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(JSON.stringify({ user: {}, workspace: {} })),
          ),
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
