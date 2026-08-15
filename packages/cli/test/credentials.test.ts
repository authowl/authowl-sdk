import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  credentialPath,
  deleteCredential,
  readCredential,
  writeCredential,
  type CliCredential,
} from "../src/credentials";

const directories: string[] = [];
const credential: CliCredential = {
  apiUrl: "https://authowl.dev",
  accessToken: `aoc_${"t".repeat(43)}`,
  scopes: ["projects:read"],
  createdAt: "2026-07-14T00:00:00.000Z",
  expiresAt: "2026-07-14T01:00:00.000Z",
};

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CLI credential storage", () => {
  it("honors the explicit config home without adding another app directory", () => {
    expect(credentialPath({ AUTHOWL_CONFIG_HOME: "/secure/custom" })).toBe(
      join("/secure/custom", "credentials.json"),
    );
    expect(credentialPath({ XDG_CONFIG_HOME: "/xdg" })).toBe(
      join("/xdg", "authowl", "credentials.json"),
    );
  });

  it("writes atomically with owner-only permissions and reads the same value", async () => {
    const root = await fixtureDirectory();
    const path = join(root, "config", "authowl", "credentials.json");
    await writeCredential(credential, path);
    expect(await readCredential(path)).toEqual(credential);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "config", "authowl"))).mode & 0o777).toBe(
        0o700,
      );
    }
    const names = await import("node:fs/promises").then((fs) =>
      fs.readdir(join(root, "config", "authowl")),
    );
    expect(names).toEqual(["credentials.json"]);
  });

  it("reports malformed credentials without including their contents", async () => {
    const root = await fixtureDirectory();
    const path = join(root, "credentials.json");
    await writeFile(path, '{"accessToken":"secret-value"', "utf8");
    await expect(readCredential(path)).rejects.toThrow(
      `AuthOwl credentials are malformed: ${path}`,
    );
  });

  it.each([
    { label: "empty", scopes: [] as string[] },
    { label: "duplicated", scopes: ["projects:read", "projects:read"] },
  ])("rejects $label stored scope sets", async ({ scopes }) => {
    const root = await fixtureDirectory();
    const path = join(root, "credentials.json");
    await writeFile(path, JSON.stringify({ ...credential, scopes }), "utf8");
    await expect(readCredential(path)).rejects.toThrow(
      "Invalid AuthOwl credential",
    );
  });

  it("deletes idempotently", async () => {
    const root = await fixtureDirectory();
    const path = join(root, "credentials.json");
    await writeCredential(credential, path);
    expect(await deleteCredential(path)).toBe(true);
    expect(await deleteCredential(path)).toBe(false);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function fixtureDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "authowl-cli-"));
  directories.push(path);
  return path;
}
