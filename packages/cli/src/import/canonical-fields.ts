import type {
  CanonicalExternalAccount,
  CanonicalPasswordEnvelope,
  CanonicalUserRecord,
} from "./contracts";
import {
  ImportSourceError,
  isRecord,
  type SourceRecord,
} from "./source-reader";
import {
  optionalBoolean,
  optionalNullableString,
  optionalObject,
  optionalString,
  strictStringList,
} from "./shared";

const USER_KEYS = new Set([
  "type",
  "external_id",
  "email",
  "email_verified",
  "phone",
  "phone_verified",
  "name",
  "image_url",
  "password",
  "password_scheme",
  "password_hash",
  "password_parameters",
  "external_accounts",
  "organization_slugs",
  "public_metadata",
  "private_metadata",
  "unsafe_metadata",
  "created_at",
]);

export function adaptCanonicalUser(
  source: SourceRecord,
  row: number,
): CanonicalUserRecord {
  assertObjectKeys(source, USER_KEYS, `Canonical row ${row}`);
  if (source.type !== undefined && optionalString(source.type) !== "user") {
    throw new ImportSourceError(`Canonical row ${row} must use type "user".`);
  }
  const email = optionalNullableString(
    source.email,
    `Canonical row ${row} email`,
  );
  const phone = optionalNullableString(
    source.phone,
    `Canonical row ${row} phone`,
  );
  const externalId = optionalString(source.external_id);
  if (!externalId) {
    throw new ImportSourceError(
      `Canonical row ${row} does not contain external_id.`,
    );
  }
  const name = optionalNullableString(source.name, `Canonical row ${row} name`);
  const imageUrl = optionalNullableString(
    source.image_url,
    `Canonical row ${row} image_url`,
  );
  const password = canonicalPassword(source, row);
  const externalAccounts = canonicalExternalAccounts(
    source.external_accounts,
    row,
  );
  const organizationSlugs = strictStringList(
    source.organization_slugs,
    `Canonical row ${row} organization_slugs`,
  );
  const publicMetadata = optionalObject(
    source.public_metadata,
    `Canonical row ${row} public_metadata`,
  );
  const privateMetadata = optionalObject(
    source.private_metadata,
    `Canonical row ${row} private_metadata`,
  );
  const unsafeMetadata = optionalObject(
    source.unsafe_metadata,
    `Canonical row ${row} unsafe_metadata`,
  );
  const createdAt = canonicalTimestamp(source.created_at, row);
  const emailVerified = canonicalBoolean(
    source.email_verified,
    `Canonical row ${row} email_verified`,
  );
  const phoneVerified = canonicalBoolean(
    source.phone_verified,
    `Canonical row ${row} phone_verified`,
  );

  return {
    type: "user",
    external_id: externalId,
    ...(email !== undefined ? { email } : {}),
    ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
    ...(phone !== undefined ? { phone } : {}),
    ...(phoneVerified === undefined ? {} : { phone_verified: phoneVerified }),
    ...(name !== undefined ? { name } : {}),
    ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
    ...(password ? { password } : {}),
    ...(externalAccounts ? { external_accounts: externalAccounts } : {}),
    ...(organizationSlugs ? { organization_slugs: organizationSlugs } : {}),
    ...(publicMetadata ? { public_metadata: publicMetadata } : {}),
    ...(privateMetadata ? { private_metadata: privateMetadata } : {}),
    ...(unsafeMetadata ? { unsafe_metadata: unsafeMetadata } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

function canonicalPassword(
  source: SourceRecord,
  row: number,
): CanonicalPasswordEnvelope | undefined {
  const objectValue = source.password;
  const columnValue =
    source.password_scheme !== undefined ||
    source.password_hash !== undefined ||
    source.password_parameters !== undefined;
  if (objectValue !== undefined && objectValue !== null && columnValue) {
    throw new ImportSourceError(
      `Canonical row ${row} cannot mix password and password_* columns.`,
    );
  }
  if (objectValue === undefined || objectValue === null || objectValue === "") {
    if (!columnValue) return undefined;
    const scheme = optionalString(source.password_scheme);
    const hash = optionalString(source.password_hash);
    if (!scheme || !hash) {
      throw new ImportSourceError(
        `Canonical row ${row} password_scheme and password_hash are required together.`,
      );
    }
    const parameters = optionalObject(
      source.password_parameters,
      `Canonical row ${row} password_parameters`,
    );
    return { scheme, hash, ...(parameters ? { parameters } : {}) };
  }
  const password = parseObject(objectValue, `Canonical row ${row} password`);
  assertObjectKeys(
    password,
    new Set(["scheme", "hash", "parameters"]),
    `Canonical row ${row} password`,
  );
  const scheme = optionalString(password.scheme);
  const hash = optionalString(password.hash);
  if (!scheme || !hash) {
    throw new ImportSourceError(
      `Canonical row ${row} password requires scheme and hash.`,
    );
  }
  const parameters = optionalObject(
    password.parameters,
    `Canonical row ${row} password parameters`,
  );
  return { scheme, hash, ...(parameters ? { parameters } : {}) };
}

function canonicalExternalAccounts(
  value: unknown,
  row: number,
): CanonicalExternalAccount[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const accounts = parseArray(value, `Canonical row ${row} external_accounts`);
  return accounts.map((account, index) => {
    const location = `Canonical row ${row} external account ${index + 1}`;
    const object = parseObject(account, location);
    assertObjectKeys(
      object,
      new Set(["provider", "provider_user_id", "email", "email_verified"]),
      location,
    );
    const provider = optionalString(object.provider);
    const providerUserId = optionalString(object.provider_user_id);
    if (!provider || !providerUserId) {
      throw new ImportSourceError(
        `${location} requires provider and provider_user_id.`,
      );
    }
    const email = optionalString(object.email);
    const emailVerified = canonicalBoolean(
      object.email_verified,
      `${location} email_verified`,
    );
    return {
      provider,
      provider_user_id: providerUserId,
      ...(email ? { email } : {}),
      ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
    };
  });
}

function parseObject(value: unknown, location: string): SourceRecord {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ImportSourceError(`${location} must be a JSON object.`);
    }
  }
  if (!isRecord(parsed)) {
    throw new ImportSourceError(`${location} must be a JSON object.`);
  }
  return parsed;
}

function parseArray(value: unknown, location: string): unknown[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ImportSourceError(`${location} must be a JSON array.`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new ImportSourceError(`${location} must be a JSON array.`);
  }
  return parsed;
}

function assertObjectKeys(
  value: SourceRecord,
  allowed: Set<string>,
  location: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new ImportSourceError(
      `${location} contains unsupported field ${unexpected[0]}.`,
    );
  }
}

function canonicalBoolean(
  value: unknown,
  location: string,
): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = optionalBoolean(value, location);
  if (parsed === undefined) {
    throw new ImportSourceError(`${location} must be a boolean.`);
  }
  return parsed;
}

function canonicalTimestamp(value: unknown, row: number): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw new ImportSourceError(
      `Canonical row ${row} created_at must be an ISO 8601 timestamp with an offset.`,
    );
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ImportSourceError(
      `Canonical row ${row} created_at must be a valid timestamp.`,
    );
  }
  return date.toISOString();
}
