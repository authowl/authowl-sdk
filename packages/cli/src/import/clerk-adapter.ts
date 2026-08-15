import type { CanonicalUserRecord } from "./contracts";
import {
  readCsvRecords,
  readJsonArrayRecords,
  ImportSourceError,
  sniffSourceFormat,
  type SourceRecord,
} from "./source-reader";
import {
  directPassword,
  joinedName,
  optionalObject,
  optionalString,
  stringList,
} from "./shared";

export const CLERK_SOURCE_VERSION = "dashboard-export-2026-07";

export async function* adaptClerkExport(
  filePath: string,
): AsyncGenerator<CanonicalUserRecord> {
  const format = await sniffSourceFormat(filePath);
  if (format === "ndjson") {
    throw new ImportSourceError(
      "Clerk imports accept the Dashboard CSV export or a JSON array export.",
    );
  }
  const records =
    format === "csv"
      ? readCsvRecords(filePath)
      : readJsonArrayRecords(filePath);
  let row = 0;
  for await (const record of records) {
    row += 1;
    yield adaptClerkUser(record, row);
  }
}

export function adaptClerkUser(
  source: SourceRecord,
  row: number,
): CanonicalUserRecord {
  const externalId = optionalString(source.id);
  if (!externalId) {
    throw new ImportSourceError(
      `Clerk row ${row} does not contain a stable id.`,
    );
  }

  const verifiedEmails = stringList(source.verified_email_addresses);
  const unverifiedEmails = stringList(source.unverified_email_addresses);
  const generalEmails = stringList(source.email_addresses);
  const primaryEmail =
    optionalString(source.primary_email_address) ??
    verifiedEmails[0] ??
    generalEmails[0] ??
    unverifiedEmails[0];
  const emailVerified = primaryEmail
    ? verifiedEmails.includes(primaryEmail) ||
      (verifiedEmails.length === 0 &&
        unverifiedEmails.length === 0 &&
        generalEmails.includes(primaryEmail))
    : undefined;

  const verifiedPhones = stringList(source.verified_phone_numbers);
  const unverifiedPhones = stringList(source.unverified_phone_numbers);
  const generalPhones = stringList(source.phone_numbers);
  const primaryPhone =
    optionalString(source.primary_phone_number) ??
    verifiedPhones[0] ??
    generalPhones[0] ??
    unverifiedPhones[0];
  const phoneVerified = primaryPhone
    ? verifiedPhones.includes(primaryPhone) ||
      (verifiedPhones.length === 0 &&
        unverifiedPhones.length === 0 &&
        generalPhones.includes(primaryPhone))
    : undefined;

  const name =
    joinedName(source.first_name, source.last_name) ??
    optionalString(source.username);
  const password = directPassword(
    source.password_digest,
    source.password_hasher,
  );
  const publicMetadata = optionalObject(
    source.public_metadata,
    `Clerk row ${row} public_metadata`,
  );
  const privateMetadata = optionalObject(
    source.private_metadata,
    `Clerk row ${row} private_metadata`,
  );
  const unsafeMetadata = optionalObject(
    source.unsafe_metadata,
    `Clerk row ${row} unsafe_metadata`,
  );
  const imageUrl = optionalString(source.image_url);
  const createdAt = optionalString(source.created_at);

  return {
    type: "user",
    external_id: externalId,
    ...(primaryEmail
      ? { email: primaryEmail, email_verified: emailVerified ?? false }
      : {}),
    ...(primaryPhone
      ? { phone: primaryPhone, phone_verified: phoneVerified ?? false }
      : {}),
    ...(name ? { name } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(password ? { password } : {}),
    ...(publicMetadata ? { public_metadata: publicMetadata } : {}),
    ...(privateMetadata ? { private_metadata: privateMetadata } : {}),
    ...(unsafeMetadata ? { unsafe_metadata: unsafeMetadata } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}
