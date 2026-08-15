import { describe, expect, it, vi } from "vitest";
import { DeviceLoginError, loginWithDevice } from "../src/device-login";
import type { CliCredential } from "../src/credentials";

const apiUrl = "http://localhost:3010";
const deviceCode = `aod_${"d".repeat(43)}`;
const accessToken = `aoc_${"t".repeat(43)}`;

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function startBody(overrides: Record<string, unknown> = {}) {
  return {
    device_code: deviceCode,
    user_code: "ABCD-2345",
    verification_uri: `${apiUrl}/cli-auth`,
    verification_uri_complete: `${apiUrl}/cli-auth?code=ABCD-2345`,
    expires_in: 600,
    interval: 5,
    ...overrides,
  };
}

describe("device login client", () => {
  it("follows pending and slow-down responses, stores once, and never prints secrets", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(startBody()))
      .mockResolvedValueOnce(response({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(
        response({ error: "slow_down", interval: 10 }, 400),
      )
      .mockResolvedValueOnce(
        response({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "projects:read projects:create keys:publishable:issue",
        }),
      );
    const sleeps: number[] = [];
    const lines: string[] = [];
    let stored: CliCredential | undefined;
    const now = new Date("2026-07-14T00:00:00.000Z");

    const credential = await loginWithDevice(
      { apiUrl },
      {
        fetch: request,
        now: () => now,
        openBrowser: async () => true,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
        store: async (value) => {
          stored = value;
        },
        write: (line) => lines.push(line),
      },
    );

    expect(sleeps).toEqual([5_000, 5_000, 10_000]);
    expect(stored).toEqual(credential);
    expect(credential).toMatchObject({
      apiUrl,
      accessToken,
      scopes: ["projects:read", "projects:create", "keys:publishable:issue"],
      createdAt: now.toISOString(),
      expiresAt: "2026-07-14T01:00:00.000Z",
    });
    expect(lines.join("\n")).toContain("ABCD-2345");
    expect(lines.join("\n")).not.toContain(deviceCode);
    expect(lines.join("\n")).not.toContain(accessToken);
    expect(request.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ device_code: deviceCode }),
    );
  });

  it("keeps the manual URL visible when the browser launcher is unavailable", async () => {
    const lines: string[] = [];
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(startBody()))
      .mockResolvedValueOnce(response({ error: "access_denied" }, 400));
    await expect(
      loginWithDevice(
        { apiUrl },
        {
          fetch: request,
          openBrowser: async () => false,
          sleep: async () => undefined,
          write: (line) => lines.push(line),
        },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(lines.join("\n")).toContain(`${apiUrl}/cli-auth?code=ABCD-2345`);
    expect(lines.join("\n")).toContain("could not be opened automatically");
  });

  it("rejects a verification URL on another origin before opening a browser", async () => {
    const launch = vi.fn(async () => true);
    await expect(
      loginWithDevice(
        { apiUrl },
        {
          fetch: vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              response(
                startBody({
                  verification_uri_complete: "https://attacker.example/code",
                }),
              ),
            ),
          openBrowser: launch,
        },
      ),
    ).rejects.toBeInstanceOf(DeviceLoginError);
    expect(launch).not.toHaveBeenCalled();
  });

  it("rejects scopes outside the server contract", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(startBody()))
      .mockResolvedValueOnce(
        response({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "projects:read secret_keys:issue",
        }),
      );
    await expect(
      loginWithDevice(
        { apiUrl },
        {
          fetch: request,
          openBrowser: async () => true,
          sleep: async () => undefined,
          write: () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects an incomplete scope set from the server", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(startBody()))
      .mockResolvedValueOnce(
        response({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "projects:read projects:create",
        }),
      );
    await expect(
      loginWithDevice(
        { apiUrl },
        {
          fetch: request,
          openBrowser: async () => true,
          sleep: async () => undefined,
          write: () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("stops reading responses beyond the size limit", async () => {
    await expect(
      loginWithDevice(
        { apiUrl },
        {
          fetch: vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              new Response(JSON.stringify({ padding: "x".repeat(70_000) })),
            ),
          openBrowser: async () => true,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
