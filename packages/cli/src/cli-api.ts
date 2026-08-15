import type { CliCredential } from "./credentials";
import { readJsonObject } from "./http-json";
import { CLI_USER_AGENT } from "./metadata";

const REQUEST_TIMEOUT_MS = 15_000;

export type CliApiDependencies = {
  clock?: () => number;
  fetch?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

export class CliApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(apiErrorMessage(code));
    this.name = "CliApiError";
  }
}

export async function requestCliApi(
  credential: CliCredential,
  path: string,
  init: RequestInit,
  dependencies: CliApiDependencies,
): Promise<Record<string, unknown>> {
  const now = dependencies.now?.() ?? new Date();
  if (new Date(credential.expiresAt).getTime() <= now.getTime()) {
    throw new CliApiError("token_expired", 401);
  }
  const response = await (dependencies.fetch ?? fetch)(
    `${credential.apiUrl}${path}`,
    {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
        "user-agent": CLI_USER_AGENT,
        ...init.headers,
      },
      signal: dependencies.signal
        ? AbortSignal.any([
            dependencies.signal,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(response);
  } catch {
    throw invalidCliResponse();
  }
  if (!response.ok) throw responseError(response, body);
  return body;
}

export function invalidCliResponse(): CliApiError {
  return new CliApiError("invalid_response", 502);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

export function isNullableIsoDate(value: unknown): boolean {
  return value === null || (typeof value === "string" && isIsoDate(value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function responseError(
  response: Response,
  body: Record<string, unknown>,
): CliApiError {
  const raw = typeof body.error === "string" ? body.error : "";
  const code = /^[a-z_]{1,64}$/.test(raw) ? raw : `http_${response.status}`;
  return new CliApiError(code, response.status);
}

function apiErrorMessage(code: string): string {
  const known: Record<string, string> = {
    insufficient_scope:
      "The CLI login does not have the required scope. Sign in again.",
    invalid_token: "The CLI login is no longer valid. Sign in again.",
    token_expired: "The CLI login expired. Sign in again.",
    project_limit_reached: "This workspace has reached its project limit.",
    not_found: "The AuthOwl project was not found.",
    invalid_request: "AuthOwl rejected the project configuration.",
    invalid_response: "AuthOwl returned an invalid response.",
  };
  return known[code] ?? `AuthOwl CLI request failed (${code})`;
}
