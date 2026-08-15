import { resolveApiUrl } from "./api-url";
import { CLI_SCOPES } from "./contract";
import { writeCredential, type CliCredential } from "./credentials";
import { readJsonObject } from "./http-json";
import { CLI_USER_AGENT } from "./metadata";
import { openBrowser } from "./open-browser";

const ALLOWED_SCOPES = new Set<string>(CLI_SCOPES);
const REQUEST_TIMEOUT_MS = 15_000;

type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

type TokenSuccess = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

export type DeviceLoginDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  openBrowser?: (url: string) => Promise<boolean>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  store?: (credential: CliCredential) => Promise<void>;
  write?: (message: string) => void;
};

export class DeviceLoginError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeviceLoginError";
  }
}

export async function loginWithDevice(
  options: { apiUrl?: string; signal?: AbortSignal } = {},
  dependencies: DeviceLoginDependencies = {},
): Promise<CliCredential> {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const output =
    dependencies.write ?? ((message) => process.stdout.write(`${message}\n`));
  const launch = dependencies.openBrowser ?? openBrowser;
  const wait = dependencies.sleep ?? sleep;
  const store = dependencies.store ?? writeCredential;

  const startedResponse = await request(`${apiUrl}/api/cli/device`, {
    method: "POST",
    headers: { accept: "application/json", "user-agent": CLI_USER_AGENT },
    signal: requestSignal(options.signal),
  });
  const startedBody = await deviceJson(startedResponse);
  if (!startedResponse.ok) throw responseError(startedResponse, startedBody);
  const started = parseDeviceStart(startedBody, apiUrl);

  output(`Device code: ${started.user_code}`);
  output(`Open: ${started.verification_uri_complete}`);
  if (!(await launch(started.verification_uri_complete))) {
    output(
      "The browser could not be opened automatically. Open the URL above.",
    );
  }

  const deadline = now().getTime() + started.expires_in * 1_000;
  let intervalSeconds = started.interval;
  while (now().getTime() < deadline) {
    await wait(intervalSeconds * 1_000, options.signal);
    const pollResponse = await request(`${apiUrl}/api/cli/device/poll`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": CLI_USER_AGENT,
      },
      body: JSON.stringify({ device_code: started.device_code }),
      signal: requestSignal(options.signal),
    });
    const pollBody = await deviceJson(pollResponse);
    if (pollResponse.ok) {
      const token = parseTokenSuccess(pollBody);
      const createdAt = now();
      const credential: CliCredential = {
        apiUrl,
        accessToken: token.access_token,
        scopes: token.scope.split(" ").filter(Boolean),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(
          createdAt.getTime() + token.expires_in * 1_000,
        ).toISOString(),
      };
      await store(credential);
      output("CLI connected successfully.");
      return credential;
    }

    const code = stringField(pollBody, "error");
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      const nextInterval = numberField(pollBody, "interval");
      if (nextInterval > intervalSeconds) intervalSeconds = nextInterval;
      continue;
    }
    throw responseError(pollResponse, pollBody);
  }
  throw new DeviceLoginError(
    "expired_token",
    "The device code expired before approval",
  );
}

function parseDeviceStart(
  value: Record<string, unknown>,
  apiUrl: string,
): DeviceStart {
  const parsed: DeviceStart = {
    device_code: stringField(value, "device_code"),
    user_code: stringField(value, "user_code"),
    verification_uri: stringField(value, "verification_uri"),
    verification_uri_complete: stringField(value, "verification_uri_complete"),
    expires_in: positiveNumberField(value, "expires_in"),
    interval: positiveNumberField(value, "interval"),
  };
  if (!/^aod_[A-Za-z0-9_-]{32,}$/.test(parsed.device_code)) {
    throw new DeviceLoginError(
      "invalid_response",
      "AuthOwl returned an invalid device code",
    );
  }
  if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(parsed.user_code)) {
    throw new DeviceLoginError(
      "invalid_response",
      "AuthOwl returned an invalid user code",
    );
  }
  const expectedOrigin = new URL(apiUrl).origin;
  for (const candidate of [
    parsed.verification_uri,
    parsed.verification_uri_complete,
  ]) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new DeviceLoginError(
        "invalid_response",
        "AuthOwl returned an invalid verification URL",
      );
    }
    if (url.origin !== expectedOrigin) {
      throw new DeviceLoginError(
        "invalid_response",
        "AuthOwl returned a verification URL on an unexpected origin",
      );
    }
  }
  return parsed;
}

function parseTokenSuccess(value: Record<string, unknown>): TokenSuccess {
  const tokenType = stringField(value, "token_type");
  const scope = stringField(value, "scope");
  const scopes = scope.split(" ").filter(Boolean);
  if (tokenType !== "Bearer") {
    throw new DeviceLoginError(
      "invalid_response",
      "AuthOwl returned an invalid token type",
    );
  }
  if (
    scopes.length !== CLI_SCOPES.length ||
    new Set(scopes).size !== CLI_SCOPES.length ||
    scopes.some((item) => !ALLOWED_SCOPES.has(item))
  ) {
    throw new DeviceLoginError(
      "invalid_response",
      "AuthOwl returned an unexpected CLI scope",
    );
  }
  const accessToken = stringField(value, "access_token");
  if (!/^aoc_[A-Za-z0-9_-]{32,}$/.test(accessToken)) {
    throw new DeviceLoginError(
      "invalid_response",
      "AuthOwl returned an invalid access token",
    );
  }
  return {
    access_token: accessToken,
    token_type: tokenType,
    expires_in: positiveNumberField(value, "expires_in"),
    scope,
  };
}

function responseError(
  response: Response,
  body: Record<string, unknown>,
): DeviceLoginError {
  const responseCode = typeof body.error === "string" ? body.error : "";
  const code = /^[a-z_]{1,64}$/.test(responseCode)
    ? responseCode
    : `http_${response.status}`;
  const messages: Record<string, string> = {
    access_denied: "Device authorization was denied",
    expired_token: "The device code expired",
    rate_limited: "Too many device login attempts. Wait and try again",
    temporarily_unavailable: "AuthOwl is temporarily unavailable",
  };
  return new DeviceLoginError(
    code,
    messages[code] ?? `AuthOwl device login failed (${code})`,
  );
}

async function deviceJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return await readJsonObject(response);
  } catch {
    throw new DeviceLoginError(
      "invalid_response",
      "AuthOwl returned invalid JSON",
    );
  }
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== "string" || !result) {
    throw new DeviceLoginError(
      "invalid_response",
      `AuthOwl response is missing ${field}`,
    );
  }
  return result;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const result = value[field];
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new DeviceLoginError(
      "invalid_response",
      `AuthOwl response is missing ${field}`,
    );
  }
  return result;
}

function positiveNumberField(
  value: Record<string, unknown>,
  field: string,
): number {
  const result = numberField(value, field);
  if (result <= 0) {
    throw new DeviceLoginError(
      "invalid_response",
      `AuthOwl response has invalid ${field}`,
    );
  }
  return result;
}

async function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Device login aborted");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Device login aborted"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
