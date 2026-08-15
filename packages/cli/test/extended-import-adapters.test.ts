import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adaptCanonicalExport,
  adaptCanonicalUser,
} from "../src/import/canonical-adapter";
import {
  adaptFirebaseExport,
  adaptFirebaseUser,
} from "../src/import/firebase-adapter";
import {
  adaptSupabaseExport,
  adaptSupabaseUser,
} from "../src/import/supabase-adapter";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/imports",
);

describe("Firebase import adapter", () => {
  it("streams the official JSON wrapper with modified-scrypt parameters", async () => {
    const users = await collect(
      adaptFirebaseExport(resolve(fixtures, "firebase-auth-export.json"), {
        hashConfigPath: resolve(fixtures, "firebase-hash-config.json"),
      }),
    );

    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      external_id: "kYi4EvWQlQTKSfnJ3dRSP6IH3ed2",
      email: "firebase-password@example.test",
      email_verified: true,
      name: "Firebase Password",
      password: {
        scheme: "firebase-scrypt",
        hash: "lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==",
        parameters: {
          salt: "42xEC+ixf3L2lw==",
          salt_separator: "Bw==",
          rounds: 8,
          mem_cost: 14,
        },
      },
      external_accounts: [
        {
          provider: "google",
          provider_user_id: "google-synthetic-001",
          email: "firebase-password@example.test",
        },
      ],
      created_at: "2017-10-25T01:12:05.000Z",
    });
    expect(users[0]?.password?.parameters?.signer_key).toBeTruthy();
    expect(users[1]).toMatchObject({
      external_id: "firebase-phone-synthetic-002",
      phone: "+201001112233",
      phone_verified: true,
    });
  });

  it("accepts the documented 26-column Firebase CSV export", async () => {
    const users = await collect(
      adaptFirebaseExport(resolve(fixtures, "firebase-auth-export.csv"), {
        hashConfigPath: resolve(fixtures, "firebase-hash-config.json"),
      }),
    );
    expect(users).toHaveLength(2);
    expect(users[0]?.password?.scheme).toBe("firebase-scrypt");
    expect(users[1]?.phone).toBe("+201001112233");
  });

  it("requires local hash parameters only when password hashes exist", async () => {
    await expect(
      collect(
        adaptFirebaseExport(resolve(fixtures, "firebase-auth-export.json")),
      ),
    ).rejects.toThrow("--firebase-hash-config");
  });

  it("does not silently reactivate disabled Firebase users", () => {
    expect(() =>
      adaptFirebaseUser(
        {
          localId: "firebase-disabled",
          email: "disabled@example.test",
          disabled: true,
        },
        3,
      ),
    ).toThrow("disabled");
  });
});

describe("Supabase import adapter", () => {
  it("maps auth.users CSV, trust-separated metadata, bcrypt, and joined identities", async () => {
    const users = await collect(
      adaptSupabaseExport(resolve(fixtures, "supabase-auth-users.csv")),
    );

    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      external_id: "11111111-1111-4111-8111-111111111111",
      email: "supabase-password@example.test",
      email_verified: true,
      name: "Supabase Password",
      password: { scheme: "bcrypt" },
      private_metadata: {
        provider: "email",
        providers: ["email", "github"],
      },
      unsafe_metadata: {
        full_name: "Supabase Password",
        locale: "ar",
      },
      external_accounts: [
        {
          provider: "github",
          provider_user_id: "github-synthetic-001",
          email_verified: true,
        },
      ],
    });
    expect(users[1]).toMatchObject({
      phone: "+201009998887",
      phone_verified: true,
      name: "Supabase Phone",
    });
  });

  it("does not reactivate deleted Supabase rows", () => {
    expect(() =>
      adaptSupabaseUser(
        {
          id: "33333333-3333-4333-8333-333333333333",
          email: "deleted@example.test",
          deleted_at: "2026-01-01T00:00:00.000Z",
        },
        3,
      ),
    ).toThrow("deleted");
    expect(() =>
      adaptSupabaseUser(
        {
          id: "44444444-4444-4444-8444-444444444444",
          email: "banned@example.test",
          banned_until: "infinity",
        },
        4,
      ),
    ).toThrow("banned");
  });
});

describe("canonical import adapter", () => {
  it("accepts a matching complete NDJSON stream and preserves supported fields", async () => {
    const users = await collect(
      adaptCanonicalExport(resolve(fixtures, "canonical-users.ndjson"), {
        provider: "authowl",
        sourceNamespace: "export_synthetic_001",
      }),
    );

    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      external_id: "canonical-user-001",
      email_verified: true,
      password: { scheme: "pbkdf2-sha256" },
      organization_slugs: ["acme"],
      public_metadata: { locale: "ar" },
    });
    expect(users[1]).toMatchObject({
      phone: "+201001010101",
      private_metadata: { legacy_id: "synthetic-002" },
    });
  });

  it("accepts canonical CSV for custom systems", async () => {
    const users = await collect(
      adaptCanonicalExport(resolve(fixtures, "canonical-users.csv"), {
        provider: "custom",
        sourceNamespace: "custom-db-synthetic",
      }),
    );
    expect(users).toEqual([
      expect.objectContaining({
        external_id: "custom-user-001",
        password: expect.objectContaining({ scheme: "bcrypt" }),
        organization_slugs: ["acme"],
      }),
    ]);
  });

  it("rejects manifest identity drift and unknown canonical fields", async () => {
    await expect(
      collect(
        adaptCanonicalExport(resolve(fixtures, "canonical-users.ndjson"), {
          provider: "authowl",
          sourceNamespace: "different-export",
        }),
      ),
    ).rejects.toThrow("must match");
    expect(() =>
      adaptCanonicalUser(
        {
          type: "user",
          external_id: "custom-unknown",
          email: "unknown@example.test",
          refresh_token: "must-not-be-dropped",
        },
        4,
      ),
    ).toThrow("unsupported field refresh_token");
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
