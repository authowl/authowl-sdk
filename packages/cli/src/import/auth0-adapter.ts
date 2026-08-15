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
import {
  directPassword,
  joinedName,
  mapPasswordScheme,
  normalizedScheme,
  optionalBoolean,
  optionalObject,
  optionalString,
} from "./shared";

export const AUTH0_SOURCE_VERSION = "management-api-v2-export-2026-07";

export async function* adaptAuth0Export(
  filePath: string,
): AsyncGenerator<CanonicalUserRecord> {
  const format = await sniffSourceFormat(filePath);
  if (format === "csv") {
    throw new ImportSourceError(
      "Auth0 imports require the JSON-compatible NDJSON export or its JSON array conversion.",
    );
  }
  const records =
    format === "json-array"
      ? readJsonArrayRecords(filePath)
      : readNdjsonRecords(filePath);
  let row = 0;
  for await (const record of records) {
    row += 1;
    yield adaptAuth0User(record, row);
  }
}

export function adaptAuth0User(
  source: SourceRecord,
  row: number,
): CanonicalUserRecord {
  const externalId = optionalString(source.user_id);
  if (!externalId) {
    throw new ImportSourceError(
      `Auth0 row ${row} does not contain a stable user_id.`,
    );
  }

  const email = optionalString(source.email);
  const phone = optionalString(source.phone_number);
  const name =
    optionalString(source.name) ??
    joinedName(source.given_name, source.family_name) ??
    optionalString(source.nickname) ??
    optionalString(source.username);
  const imageUrl = optionalString(source.picture);
  const publicMetadata = optionalObject(
    source.user_metadata,
    `Auth0 row ${row} user_metadata`,
  );
  const privateMetadata = optionalObject(
    source.app_metadata,
    `Auth0 row ${row} app_metadata`,
  );
  const createdAt = optionalString(source.created_at);
  const password = auth0Password(source, row);
  const externalAccounts = auth0ExternalAccounts(source.identities, row);

  return {
    type: "user",
    external_id: externalId,
    ...(email
      ? {
          email,
          email_verified:
            optionalBoolean(
              source.email_verified,
              `Auth0 row ${row} email_verified`,
            ) ?? false,
        }
      : {}),
    ...(phone
      ? {
          phone,
          phone_verified:
            optionalBoolean(
              source.phone_verified,
              `Auth0 row ${row} phone_verified`,
            ) ?? false,
        }
      : {}),
    ...(name ? { name } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(password ? { password } : {}),
    ...(externalAccounts.length > 0
      ? { external_accounts: externalAccounts }
      : {}),
    ...(publicMetadata ? { public_metadata: publicMetadata } : {}),
    ...(privateMetadata ? { private_metadata: privateMetadata } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

function auth0ExternalAccounts(
  value: unknown,
  row: number,
): CanonicalExternalAccount[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ImportSourceError(
      `Auth0 row ${row} has a malformed identities field.`,
    );
  }
  return value.map((identity, index) => {
    if (!isRecord(identity)) {
      throw new ImportSourceError(
        `Auth0 row ${row} identity ${index + 1} is not an object.`,
      );
    }
    const provider = optionalString(identity.provider);
    const providerUserId = optionalString(identity.user_id);
    if (!provider || !providerUserId) {
      throw new ImportSourceError(
        `Auth0 row ${row} identity ${index + 1} lacks provider or user_id.`,
      );
    }
    return {
      provider: normalizedScheme(provider),
      provider_user_id: providerUserId,
    };
  });
}

function auth0Password(
  source: SourceRecord,
  row: number,
): CanonicalPasswordEnvelope | undefined {
  const directHash =
    optionalString(source.passwordHash) ?? optionalString(source.password_hash);
  const custom = source.custom_password_hash;
  if (directHash && custom !== undefined && custom !== null) {
    throw new ImportSourceError(
      `Auth0 row ${row} contains both a direct and custom password hash.`,
    );
  }
  if (directHash) return directPassword(directHash, "bcrypt");
  if (custom === undefined || custom === null) return undefined;
  if (!isRecord(custom) || !isRecord(custom.hash)) {
    throw new ImportSourceError(
      `Auth0 row ${row} has a malformed custom_password_hash.`,
    );
  }
  const algorithm = optionalString(custom.algorithm);
  const value = optionalString(custom.hash.value);
  if (!algorithm || !value) {
    throw new ImportSourceError(
      `Auth0 row ${row} custom_password_hash lacks algorithm or hash.value.`,
    );
  }
  const pbkdf2 = parsePbkdf2Sha256(algorithm, value);
  if (pbkdf2) return pbkdf2;
  return {
    scheme: mapPasswordScheme(algorithm, value),
    hash: value,
  };
}

function parsePbkdf2Sha256(
  algorithm: string,
  value: string,
): CanonicalPasswordEnvelope | undefined {
  if (normalizedScheme(algorithm) !== "pbkdf2") return undefined;
  const match =
    /^\$pbkdf2-sha256\$i=(\d+),l=\d+\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) return undefined;
  return {
    scheme: "pbkdf2-sha256",
    hash: paddedBase64(match[3]!),
    parameters: {
      salt: paddedBase64(match[2]!),
      iterations: Number(match[1]),
      hash_encoding: "base64",
      salt_encoding: "base64",
    },
  };
}

function paddedBase64(value: string): string {
  return value.padEnd(Math.ceil(value.length / 4) * 4, "=");
}
