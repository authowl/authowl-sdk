import { describe, expect, it, vi } from "vitest";
import type { CliCredential } from "../src/credentials";
import {
  issueCliPublishableKey,
  listCliPublishableKeys,
} from "../src/publishable-key-api";

const projectId = "11111111-1111-4111-8111-111111111111";
const credential: CliCredential = {
  apiUrl: "https://authowl.dev",
  accessToken: `aoc_${"t".repeat(43)}`,
  scopes: ["projects:read", "keys:publishable:issue"],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T01:00:00.000Z",
};
const now = () => new Date("2026-07-14T00:30:00.000Z");

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("CLI publishable-key API client", () => {
  it("issues only a validated publishable key", async () => {
    const publishableKey = `pk_live_${projectId}_${"p".repeat(32)}`;
    await expect(
      issueCliPublishableKey(
        credential,
        { projectId, name: "Next local" },
        {
          fetch: vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              response({ publishable_key: publishableKey }, 201),
            ),
          now,
        },
      ),
    ).resolves.toBe(publishableKey);
  });

  it("lists only validated publishable-key metadata", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        keys: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Next local",
            prefix: "pk_live",
            last4: "Ab29",
            created_at: "2026-07-14T00:10:00.000Z",
            last_used_at: null,
          },
        ],
      }),
    );
    const keys = await listCliPublishableKeys(credential, projectId, {
      fetch: request,
      now,
    });
    expect(keys).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Next local",
        prefix: "pk_live",
        last4: "Ab29",
        createdAt: "2026-07-14T00:10:00.000Z",
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(keys)).not.toContain(credential.accessToken);
    expect(request).toHaveBeenCalledWith(
      `https://authowl.dev/api/cli/projects/${projectId}/publishable-keys`,
      expect.anything(),
    );
  });

  it("rejects secret-key metadata", async () => {
    await expect(
      listCliPublishableKeys(credential, projectId, {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          response({
            keys: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                name: "Unsafe",
                prefix: "sk_live",
                last4: "Ab29",
                created_at: "2026-07-14T00:10:00.000Z",
                last_used_at: null,
              },
            ],
          }),
        ),
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
