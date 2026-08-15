import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  adaptAuth0Export,
  adaptAuth0User,
} from "../src/import/auth0-adapter";
import {
  adaptBetterAuthExport,
  adaptBetterAuthUser,
} from "../src/import/better-auth-adapter";
import {
  adaptClerkExport,
  adaptClerkUser,
} from "../src/import/clerk-adapter";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/imports",
);

describe("Clerk import adapter", () => {
  it("streams the official Dashboard CSV shape into canonical users", async () => {
    const users = await collect(
      adaptClerkExport(resolve(fixtures, "clerk-dashboard-export.csv")),
    );

    expect(users).toHaveLength(3);
    expect(users[0]).toEqual({
      type: "user",
      external_id: "user_clerk_001",
      email: "mariam@example.test",
      email_verified: true,
      name: "Mariam Hassan",
      password: {
        scheme: "bcrypt",
        // Public synthetic fixture.
        // nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash
        hash: "$2b$10$U4C0ZY8OG8y41F9LusfKyu3HRMBL0rCZcKBVsXhgr.n8Ou6FPhzO2",
      },
    });
    expect(users[1]).toMatchObject({
      external_id: "user_clerk_002",
      phone: "+201001112223",
      phone_verified: true,
    });
    expect(users[2]?.password?.scheme).toBe("argon2id");
    expect(JSON.stringify(users)).not.toContain("totp_secret");
  });

  it("preserves safe metadata from the Clerk JSON array shape", async () => {
    const users = await collect(
      adaptClerkExport(resolve(fixtures, "clerk-dashboard-export.json")),
    );

    expect(users).toEqual([
      expect.objectContaining({
        external_id: "user_clerk_json_001",
        email_verified: true,
        public_metadata: { customer_tier: "starter" },
        private_metadata: {
          legacy_customer_id: "customer_synthetic_001",
        },
        unsafe_metadata: { locale: "ar" },
      }),
    ]);
  });

  it("fails with a source row when a stable Clerk id is absent", () => {
    expect(() =>
      adaptClerkUser({ primary_email_address: "person@example.test" }, 7),
    ).toThrow("Clerk row 7");
  });

  it("does not silently discard malformed source metadata", () => {
    expect(() =>
      adaptClerkUser(
        {
          id: "user_clerk_invalid",
          primary_email_address: "person@example.test",
          public_metadata: "{not-json}",
        },
        8,
      ),
    ).toThrow("Clerk row 8 public_metadata");
  });
});

describe("Auth0 import adapter", () => {
  it("streams Management API NDJSON and preserves identities and metadata", async () => {
    const users = await collect(
      adaptAuth0Export(resolve(fixtures, "auth0-management-export.ndjson")),
    );

    expect(users).toHaveLength(3);
    expect(users[0]).toMatchObject({
      external_id: "auth0|synthetic001",
      email: "layla@example.test",
      email_verified: true,
      phone: "+201001234567",
      phone_verified: false,
      external_accounts: [
        { provider: "auth0", provider_user_id: "synthetic001" },
      ],
      public_metadata: { locale: "ar", theme: "dark" },
      private_metadata: { roles: ["member"], legacy_plan: "pro" },
    });
    expect(users[1]?.external_accounts).toEqual([
      { provider: "github", provider_user_id: "synthetic002" },
    ]);
    expect(users[2]?.password?.scheme).toBe("bcrypt");
    expect(JSON.stringify(users)).not.toContain("last_login");
  });

  it("accepts Auth0's documented JSON array conversion and supported custom hashes", async () => {
    const users = await collect(
      adaptAuth0Export(resolve(fixtures, "auth0-converted-export.json")),
    );

    expect(users[0]?.password?.scheme).toBe("argon2id");
    expect(users[1]?.password).toEqual({
      scheme: "pbkdf2-sha256",
      hash: "2ne8SxL2N6z9M0+fN4Xv97R0M2Q8eVZl+ACuB8rYHhI=",
      parameters: {
        salt: "YWJjMTIz",
        iterations: 100000,
        hash_encoding: "base64",
        salt_encoding: "base64",
      },
    });
  });

  it("reads the gzip-compressed downloads returned by Auth0 export jobs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "authowl-auth0-import-"));
    try {
      const source = await readFile(
        resolve(fixtures, "auth0-management-export.ndjson"),
      );
      const archive = join(directory, "tenant-users.json.gz");
      await writeFile(archive, gzipSync(source));
      const users = await collect(adaptAuth0Export(archive));
      expect(users).toHaveLength(3);
      expect(users[0]?.external_id).toBe("auth0|synthetic001");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous or malformed Auth0 password and identity data", () => {
    expect(() =>
      adaptAuth0User(
        {
          user_id: "auth0|one",
          email: "one@example.test",
          passwordHash: "$2b$10$hash",
          custom_password_hash: {
            algorithm: "bcrypt",
            hash: { value: "$2b$10$hash" },
          },
        },
        4,
      ),
    ).toThrow("both a direct and custom password hash");
    expect(() =>
      adaptAuth0User(
        {
          user_id: "auth0|one",
          email: "one@example.test",
          identities: [{}],
        },
        5,
      ),
    ).toThrow("identity 1");
    expect(() =>
      adaptAuth0User(
        {
          user_id: "auth0|one",
          email: "one@example.test",
          email_verified: "yes",
        },
        6,
      ),
    ).toThrow("Auth0 row 6 email_verified");
  });
});

describe("better-auth import adapter", () => {
  it("maps a credential user's scrypt password natively and marks verification", () => {
    const user = adaptBetterAuthUser(
      {
        id: "ba_user_1",
        email: "person@example.test",
        emailVerified: true,
        name: "Test Person",
        image: "https://cdn.example.test/a.png",
        createdAt: "2026-01-02T03:04:05.000Z",
        accounts: [
          {
            providerId: "credential",
            accountId: "ba_user_1",
            password: "s0mesalt:deadbeefscrypthash",
          },
        ],
      },
      1,
    );
    expect(user).toEqual({
      type: "user",
      external_id: "ba_user_1",
      email: "person@example.test",
      email_verified: true,
      name: "Test Person",
      image_url: "https://cdn.example.test/a.png",
      password: { scheme: "authowl-scrypt", hash: "s0mesalt:deadbeefscrypthash" },
      created_at: "2026-01-02T03:04:05.000Z",
    });
  });

  it("turns non-credential providers into external accounts, verification defaults false", () => {
    const user = adaptBetterAuthUser(
      {
        id: "ba_user_2",
        email: "social@example.test",
        accounts: [
          { providerId: "google", accountId: "google-sub-123" },
          { providerId: "github", accountId: "99887766" },
        ],
      },
      2,
    );
    expect(user.email_verified).toBe(false);
    expect(user.password).toBeUndefined();
    expect(user.external_accounts).toEqual([
      { provider: "google", provider_user_id: "google-sub-123" },
      { provider: "github", provider_user_id: "99887766" },
    ]);
  });

  it("carries a phone user with both a password and a social link", () => {
    const user = adaptBetterAuthUser(
      {
        id: "ba_user_3",
        phoneNumber: "+201000000000",
        phoneNumberVerified: true,
        accounts: [
          { providerId: "credential", accountId: "ba_user_3", password: "salt:hash" },
          { providerId: "apple", accountId: "apple-xyz" },
        ],
      },
      3,
    );
    expect(user.phone).toBe("+201000000000");
    expect(user.phone_verified).toBe(true);
    expect(user.password).toEqual({ scheme: "authowl-scrypt", hash: "salt:hash" });
    expect(user.external_accounts).toEqual([
      { provider: "apple", provider_user_id: "apple-xyz" },
    ]);
  });

  it("accepts snake_case columns from a raw SQL dump", () => {
    const user = adaptBetterAuthUser(
      {
        id: "ba_user_4",
        email: "snake@example.test",
        email_verified: true,
        created_at: "2026-02-02T00:00:00.000Z",
        accounts: [{ provider_id: "google", account_id: "g-1" }],
      },
      4,
    );
    expect(user.email_verified).toBe(true);
    expect(user.created_at).toBe("2026-02-02T00:00:00.000Z");
    expect(user.external_accounts).toEqual([
      { provider: "google", provider_user_id: "g-1" },
    ]);
  });

  it("rejects a row without a stable id, and a row with two credential accounts", () => {
    expect(() => adaptBetterAuthUser({ email: "x@example.test" }, 5)).toThrow(/stable id/);
    expect(() =>
      adaptBetterAuthUser(
        {
          id: "ba_user_6",
          accounts: [
            { providerId: "credential", password: "a:b" },
            { providerId: "credential", password: "c:d" },
          ],
        },
        6,
      ),
    ).toThrow(/more than one credential/);
  });

  it("streams a JSON-array export through the file reader", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ba-import-"));
    const file = join(dir, "better-auth-users.json");
    await writeFile(
      file,
      JSON.stringify([
        {
          id: "ba_a",
          email: "a@example.test",
          emailVerified: true,
          accounts: [{ providerId: "credential", accountId: "ba_a", password: "s:h" }],
        },
        {
          id: "ba_b",
          email: "b@example.test",
          accounts: [{ providerId: "google", accountId: "g-b" }],
        },
      ]),
    );
    try {
      const users = await collect(adaptBetterAuthExport(file));
      expect(users).toHaveLength(2);
      expect(users[0]?.password).toEqual({ scheme: "authowl-scrypt", hash: "s:h" });
      expect(users[1]?.external_accounts).toEqual([
        { provider: "google", provider_user_id: "g-b" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
