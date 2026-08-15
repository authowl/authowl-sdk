import type {
  CanonicalExternalAccount,
  CanonicalPasswordEnvelope,
  CanonicalUserRecord,
} from "./contracts";
import {
  isRecord,
  ImportSourceError,
  readJsonArrayRecords,
  readNdjsonRecords,
  sniffSourceFormat,
  type SourceRecord,
} from "./source-reader";
import { optionalBoolean, optionalString } from "./shared";

export const BETTER_AUTH_SOURCE_VERSION = "better-auth-schema-2026-07";

/**
 * Migrate users from a self-hosted better-auth deployment.
 *
 * Input: the better-auth `user` table exported as a JSON array or NDJSON, each
 * row optionally carrying its `account` rows in a nested `accounts` array, e.g.
 *   SELECT u.*,
 *          coalesce(json_agg(a.*) FILTER (WHERE a.id IS NOT NULL), '[]') AS accounts
 *     FROM "user" u
 *     LEFT JOIN "account" a ON a."userId" = u.id
 *    GROUP BY u.id;
 *
 * The `credential` account's password (better-auth's default scrypt) imports
 * natively and verifies on first sign-in; every other provider becomes an
 * external (social) account. Sessions and verification tokens are not migrated -
 * users keep their password and linked providers and re-establish sessions by
 * signing in.
 */
export async function* adaptBetterAuthExport(
  filePath: string,
): AsyncGenerator<CanonicalUserRecord> {
  const format = await sniffSourceFormat(filePath);
  if (format === "csv") {
    throw new ImportSourceError(
      "better-auth imports require a JSON array or NDJSON export of the user table with nested accounts.",
    );
  }
  const records =
    format === "json-array"
      ? readJsonArrayRecords(filePath)
      : readNdjsonRecords(filePath);
  let row = 0;
  for await (const record of records) {
    row += 1;
    yield adaptBetterAuthUser(record, row);
  }
}

/** better-auth stores camelCase fields by default; a raw SQL dump may snake-case
 * the columns, so accept either spelling. */
function pick(source: SourceRecord, camel: string, snake: string): unknown {
  return source[camel] !== undefined ? source[camel] : source[snake];
}

export function adaptBetterAuthUser(
  source: SourceRecord,
  row: number,
): CanonicalUserRecord {
  const externalId = optionalString(source.id);
  if (!externalId) {
    throw new ImportSourceError(
      `better-auth row ${row} does not contain a stable id.`,
    );
  }

  const email = optionalString(source.email);
  const phone = optionalString(pick(source, "phoneNumber", "phone_number"));
  const name = optionalString(source.name);
  const imageUrl = optionalString(source.image);
  const createdAt = optionalString(pick(source, "createdAt", "created_at"));
  const { password, externalAccounts } = adaptBetterAuthAccounts(
    source.accounts,
    row,
  );

  return {
    type: "user",
    external_id: externalId,
    ...(email
      ? {
          email,
          email_verified:
            optionalBoolean(
              pick(source, "emailVerified", "email_verified"),
              `better-auth row ${row} emailVerified`,
            ) ?? false,
        }
      : {}),
    ...(phone
      ? {
          phone,
          phone_verified:
            optionalBoolean(
              pick(source, "phoneNumberVerified", "phone_number_verified"),
              `better-auth row ${row} phoneNumberVerified`,
            ) ?? false,
        }
      : {}),
    ...(name ? { name } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(password ? { password } : {}),
    ...(externalAccounts.length > 0
      ? { external_accounts: externalAccounts }
      : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

function adaptBetterAuthAccounts(
  value: unknown,
  row: number,
): {
  password?: CanonicalPasswordEnvelope;
  externalAccounts: CanonicalExternalAccount[];
} {
  if (value === undefined || value === null) return { externalAccounts: [] };
  if (!Array.isArray(value)) {
    throw new ImportSourceError(
      `better-auth row ${row} has a malformed accounts field.`,
    );
  }

  const externalAccounts: CanonicalExternalAccount[] = [];
  let password: CanonicalPasswordEnvelope | undefined;

  value.forEach((account, index) => {
    if (!isRecord(account)) {
      throw new ImportSourceError(
        `better-auth row ${row} account ${index + 1} is not an object.`,
      );
    }
    const providerId = optionalString(pick(account, "providerId", "provider_id"));
    if (!providerId) {
      throw new ImportSourceError(
        `better-auth row ${row} account ${index + 1} lacks providerId.`,
      );
    }

    if (providerId === "credential") {
      const hash = optionalString(account.password);
      if (!hash) return; // a credential row with no password: nothing to carry.
      if (password) {
        throw new ImportSourceError(
          `better-auth row ${row} has more than one credential account.`,
        );
      }
      // better-auth's default credential hash is the same scrypt format AuthOwl
      // stores, so it imports natively and verifies on first sign-in.
      password = { scheme: "authowl-scrypt", hash };
      return;
    }

    const accountId = optionalString(pick(account, "accountId", "account_id"));
    if (!accountId) {
      throw new ImportSourceError(
        `better-auth row ${row} account ${index + 1} (${providerId}) lacks accountId.`,
      );
    }
    externalAccounts.push({ provider: providerId, provider_user_id: accountId });
  });

  return { password, externalAccounts };
}
