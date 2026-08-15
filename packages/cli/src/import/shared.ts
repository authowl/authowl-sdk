import type { CanonicalPasswordEnvelope, JsonObject } from "./contracts";
import { ImportSourceError, isRecord } from "./source-reader";

export function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function optionalNullableString(
  value: unknown,
  location: string,
): string | null | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ImportSourceError(`${location} must be a string or null.`);
  }
  const normalized = value.trim();
  return normalized || undefined;
}

export function optionalBoolean(
  value: unknown,
  location: string,
): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.toLowerCase() === "true") return true;
  if (typeof value === "string" && value.toLowerCase() === "false")
    return false;
  throw new ImportSourceError(`${location} must be a boolean.`);
}

export function optionalObject(
  value: unknown,
  location: string,
): JsonObject | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // The typed source error below owns the public diagnostic.
    }
  }
  throw new ImportSourceError(`${location} must be a JSON object.`);
}

export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return unique(value.flatMap((item) => optionalString(item) ?? []));
  }
  const raw = optionalString(value);
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return stringList(parsed);
    } catch {
      // Fall back to the documented CSV separators.
    }
  }
  return unique(
    raw
      .split(/[,|]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function strictStringList(
  value: unknown,
  location: string,
): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ImportSourceError(`${location} must be a JSON string array.`);
    }
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new ImportSourceError(`${location} must be a JSON string array.`);
  }
  return unique(parsed.map((item) => item.trim()));
}

export function joinedName(...values: unknown[]): string | undefined {
  const parts = values.flatMap((value) => optionalString(value) ?? []);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function normalizedScheme(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function optionalTimestamp(
  value: unknown,
  location: string,
): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ImportSourceError(`${location} must be a valid timestamp.`);
  }
  return date.toISOString();
}

export function directPassword(
  hashValue: unknown,
  schemeValue: unknown,
): CanonicalPasswordEnvelope | undefined {
  const hash = optionalString(hashValue);
  if (!hash) return undefined;
  const rawScheme = optionalString(schemeValue) ?? inferPasswordScheme(hash);
  const scheme = mapPasswordScheme(rawScheme, hash);
  return { scheme, hash };
}

export function mapPasswordScheme(rawScheme: string, hash: string): string {
  const normalized = normalizedScheme(rawScheme);
  if (normalized === "argon2" && hash.startsWith("$argon2id$")) {
    return "argon2id";
  }
  return normalized;
}

function inferPasswordScheme(hash: string): string {
  if (/^\$2[aby]\$/.test(hash)) return "bcrypt";
  if (hash.startsWith("$argon2id$")) return "argon2id";
  return "unknown";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
