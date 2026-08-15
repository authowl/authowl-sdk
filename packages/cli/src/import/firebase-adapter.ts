import { readFile } from "node:fs/promises";
import type {
  CanonicalExternalAccount,
  CanonicalPasswordEnvelope,
  CanonicalUserRecord,
} from "./contracts";
import {
  ImportSourceError,
  isRecord,
  readCsvRows,
  readJsonPropertyArrayRecords,
  sniffSourceFormat,
  type SourceRecord,
} from "./source-reader";
import {
  normalizedScheme,
  optionalBoolean,
  optionalString,
  optionalTimestamp,
} from "./shared";

export const FIREBASE_SOURCE_VERSION = "firebase-cli-auth-export-2026-07";

export type FirebaseAdapterOptions = {
  hashConfigPath?: string;
};

type FirebaseHashConfig = {
  memCost: number;
  rounds: number;
  saltSeparator: string;
  signerKey: string;
};

export async function* adaptFirebaseExport(
  filePath: string,
  options: FirebaseAdapterOptions = {},
): AsyncGenerator<CanonicalUserRecord> {
  const format = await sniffSourceFormat(filePath);
  const hashConfig = options.hashConfigPath
    ? await readFirebaseHashConfig(options.hashConfigPath)
    : undefined;
  const records =
    format === "csv"
      ? firebaseCsvRecords(filePath)
      : readJsonPropertyArrayRecords(filePath, "users");
  let row = 0;
  for await (const record of records) {
    row += 1;
    yield adaptFirebaseUser(record, row, hashConfig);
  }
}

export function adaptFirebaseUser(
  source: SourceRecord,
  row: number,
  hashConfig?: FirebaseHashConfig,
): CanonicalUserRecord {
  if (
    optionalBoolean(source.disabled, `Firebase row ${row} disabled`) === true
  ) {
    throw new ImportSourceError(
      `Firebase row ${row} is disabled and cannot be imported as an active user.`,
    );
  }
  const externalId = optionalString(source.localId);
  if (!externalId) {
    throw new ImportSourceError(
      `Firebase row ${row} does not contain a stable localId.`,
    );
  }
  const email = optionalString(source.email);
  const phone = optionalString(source.phoneNumber);
  const password = firebasePassword(source, row, hashConfig);
  const externalAccounts = firebaseExternalAccounts(
    source.providerUserInfo,
    row,
  );
  const name = optionalString(source.displayName);
  const imageUrl = optionalString(source.photoUrl);
  const createdAt = optionalTimestamp(
    source.createdAt,
    `Firebase row ${row} createdAt`,
  );

  return {
    type: "user",
    external_id: externalId,
    ...(email
      ? {
          email,
          email_verified:
            optionalBoolean(
              source.emailVerified,
              `Firebase row ${row} emailVerified`,
            ) ?? false,
        }
      : {}),
    ...(phone ? { phone, phone_verified: true } : {}),
    ...(name ? { name } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(password ? { password } : {}),
    ...(externalAccounts.length > 0
      ? { external_accounts: externalAccounts }
      : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

async function* firebaseCsvRecords(
  filePath: string,
): AsyncGenerator<SourceRecord> {
  let row = 0;
  for await (const fields of readCsvRows(filePath)) {
    row += 1;
    if (row === 1 && /^(uid|localid)$/i.test(fields[0] ?? "")) continue;
    if (fields.length !== 26) {
      throw new ImportSourceError(
        `Firebase CSV row ${row} must contain the documented 26 columns.`,
      );
    }
    yield {
      localId: fields[0],
      email: fields[1],
      emailVerified: fields[2],
      passwordHash: fields[3],
      salt: fields[4],
      displayName: fields[5],
      photoUrl: fields[6],
      providerUserInfo: [
        providerFromCsv("google.com", fields.slice(7, 11)),
        providerFromCsv("facebook.com", fields.slice(11, 15)),
        providerFromCsv("twitter.com", fields.slice(15, 19)),
        providerFromCsv("github.com", fields.slice(19, 23)),
      ].filter(isSourceRecord),
      createdAt: fields[23],
      lastSignedInAt: fields[24],
      phoneNumber: fields[25],
    };
  }
}

function providerFromCsv(
  providerId: string,
  fields: string[],
): SourceRecord | undefined {
  const rawId = optionalString(fields[0]);
  if (!rawId) return undefined;
  return {
    providerId,
    rawId,
    email: fields[1],
    displayName: fields[2],
    photoUrl: fields[3],
  };
}

function firebasePassword(
  source: SourceRecord,
  row: number,
  hashConfig: FirebaseHashConfig | undefined,
): CanonicalPasswordEnvelope | undefined {
  const hash = optionalString(source.passwordHash);
  const salt = optionalString(source.salt);
  if (!hash && !salt) return undefined;
  if (!hash || !salt) {
    throw new ImportSourceError(
      `Firebase row ${row} must include both passwordHash and salt.`,
    );
  }
  if (!hashConfig) {
    throw new ImportSourceError(
      "Firebase password users require --firebase-hash-config with the project's password hash parameters.",
    );
  }
  return {
    scheme: "firebase-scrypt",
    hash,
    parameters: {
      salt,
      salt_separator: hashConfig.saltSeparator,
      signer_key: hashConfig.signerKey,
      rounds: hashConfig.rounds,
      mem_cost: hashConfig.memCost,
    },
  };
}

function firebaseExternalAccounts(
  value: unknown,
  row: number,
): CanonicalExternalAccount[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ImportSourceError(
      `Firebase row ${row} has malformed providerUserInfo.`,
    );
  }
  return value.map((account, index) => {
    if (!isRecord(account)) {
      throw new ImportSourceError(
        `Firebase row ${row} provider ${index + 1} is not an object.`,
      );
    }
    const rawProvider = optionalString(account.providerId);
    const providerUserId = optionalString(account.rawId);
    if (!rawProvider || !providerUserId) {
      throw new ImportSourceError(
        `Firebase row ${row} provider ${index + 1} lacks providerId or rawId.`,
      );
    }
    const provider = normalizedScheme(rawProvider.replace(/\.com$/i, ""));
    const accountEmail = optionalString(account.email);
    return {
      provider,
      provider_user_id: providerUserId,
      ...(accountEmail ? { email: accountEmail } : {}),
    };
  });
}

async function readFirebaseHashConfig(
  filePath: string,
): Promise<FirebaseHashConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new ImportSourceError(
      "The Firebase hash config must be a readable JSON file.",
    );
  }
  const value =
    isRecord(parsed) && isRecord(parsed.hash_config)
      ? parsed.hash_config
      : parsed;
  if (!isRecord(value)) {
    throw new ImportSourceError(
      "The Firebase hash config must contain an object.",
    );
  }
  const signerKey = optionalString(value.base64_signer_key ?? value.signer_key);
  const saltSeparatorValue =
    value.base64_salt_separator ?? value.salt_separator;
  const saltSeparator =
    typeof saltSeparatorValue === "string"
      ? saltSeparatorValue.trim()
      : undefined;
  const rounds = numericInteger(value.rounds);
  const memCost = numericInteger(value.mem_cost ?? value.memCost);
  const algorithm = optionalString(value.algorithm);
  if (algorithm && algorithm.toUpperCase() !== "SCRYPT") {
    throw new ImportSourceError(
      "The Firebase hash config algorithm must be SCRYPT.",
    );
  }
  if (!signerKey || saltSeparator === undefined || !rounds || !memCost) {
    throw new ImportSourceError(
      "The Firebase hash config requires base64_signer_key, base64_salt_separator, rounds, and mem_cost.",
    );
  }
  return { signerKey, saltSeparator, rounds, memCost };
}

function numericInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function isSourceRecord(
  value: SourceRecord | undefined,
): value is SourceRecord {
  return value !== undefined;
}
