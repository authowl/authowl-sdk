import type { CliCredential } from "./credentials";
import {
  CliApiError,
  invalidCliResponse,
  isIsoDate,
  isNullableIsoDate,
  isUuid,
  requestCliApi,
  type CliApiDependencies,
} from "./cli-api";

export const PROJECT_AUTH_METHODS = [
  "password",
  "magic_link",
  "email_otp",
  "passkey",
] as const;
export type ProjectAuthMethod = (typeof PROJECT_AUTH_METHODS)[number];
export type ProjectEnvironmentType = "development" | "production";

export type CliProject = {
  id: string;
  applicationId: string;
  environmentType: ProjectEnvironmentType;
  authBaseUrl: string;
  name: string;
  slug: string;
  allowedOrigins: string[];
  authMethods: ProjectAuthMethod[];
  createdAt?: string;
  firstSessionAt?: string | null;
};

export type ProjectApiDependencies = CliApiDependencies;

const ACTIVATION_POLL_INTERVAL_MS = 2_000;
const ACTIVATION_TIMEOUT_MS = 5 * 60_000;

export async function listCliProjects(
  credential: CliCredential,
  dependencies: ProjectApiDependencies = {},
): Promise<CliProject[]> {
  const body = await requestCliApi(
    credential,
    "/api/cli/projects",
    {},
    dependencies,
  );
  if (!Array.isArray(body.projects)) throw invalidCliResponse();
  return body.projects.map((value) => parseProject(value, true));
}

export async function createCliProject(
  credential: CliCredential,
  input: {
    name: string;
    allowedOrigin: string;
    authMethods: ProjectAuthMethod[];
  },
  dependencies: ProjectApiDependencies = {},
): Promise<CliProject> {
  const body = await requestCliApi(
    credential,
    "/api/cli/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        allowed_origin: input.allowedOrigin,
        auth_methods: input.authMethods,
      }),
    },
    dependencies,
  );
  return parseProject(body.project, false);
}

export async function waitForCliProjectActivation(
  credential: CliCredential,
  projectId: string,
  dependencies: ProjectApiDependencies = {},
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  if (!isUuid(projectId)) throw new Error("Invalid AuthOwl project id");
  const intervalMs = options.intervalMs ?? ACTIVATION_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? ACTIVATION_TIMEOUT_MS;
  if (intervalMs <= 0 || timeoutMs <= 0) {
    throw new Error("Invalid AuthOwl activation wait duration");
  }
  const clock = dependencies.clock ?? Date.now;
  const deadline = clock() + timeoutMs;
  const wait = dependencies.sleep ?? sleep;
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () =>
      timeoutController.abort(new Error("AuthOwl activation wait timed out")),
    timeoutMs,
  );
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    while (clock() < deadline) {
      const projects = await listCliProjects(credential, {
        ...dependencies,
        signal,
      });
      if (clock() >= deadline) return null;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new CliApiError("not_found", 404);
      if (project.firstSessionAt) return project.firstSessionAt;
      const remaining = deadline - clock();
      if (remaining <= 0) return null;
      await wait(Math.min(intervalMs, remaining), signal);
    }
    return null;
  } catch (error) {
    if (
      !dependencies.signal?.aborted &&
      (timeoutController.signal.aborted || clock() >= deadline)
    ) {
      return null;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseProject(value: unknown, requireCreatedAt: boolean): CliProject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalidCliResponse();
  const row = value as Record<string, unknown>;
  const id = row.id;
  const applicationId = row.application_id;
  const environmentType = row.environment_type;
  const allowedOrigins = stringArray(row.allowed_origins);
  const authMethods = stringArray(row.auth_methods);
  const authBaseUrl = canonicalAuthBaseUrl(
    row.auth_base_url,
    typeof id === "string" ? id : "",
  );
  if (
    typeof id !== "string" ||
    !isUuid(id) ||
    typeof applicationId !== "string" ||
    !isUuid(applicationId) ||
    (environmentType !== "development" && environmentType !== "production") ||
    !authBaseUrl ||
    typeof row.name !== "string" ||
    !row.name ||
    typeof row.slug !== "string" ||
    !row.slug ||
    !allowedOrigins ||
    !authMethods ||
    authMethods.length === 0 ||
    new Set(authMethods).size !== authMethods.length ||
    authMethods.some(
      (method) => !PROJECT_AUTH_METHODS.includes(method as ProjectAuthMethod),
    ) ||
    (requireCreatedAt &&
      (typeof row.created_at !== "string" ||
        !isIsoDate(row.created_at) ||
        !isNullableIsoDate(row.first_end_user_session_at)))
  ) {
    throw invalidCliResponse();
  }
  return {
    id,
    applicationId,
    environmentType,
    authBaseUrl,
    name: row.name,
    slug: row.slug,
    allowedOrigins,
    authMethods: authMethods as ProjectAuthMethod[],
    ...(typeof row.created_at === "string"
      ? { createdAt: row.created_at }
      : {}),
    ...(requireCreatedAt
      ? {
          firstSessionAt:
            typeof row.first_end_user_session_at === "string"
              ? row.first_end_user_session_at
              : null,
        }
      : {}),
  };
}

function canonicalAuthBaseUrl(value: unknown, projectId: string): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.endsWith(".localhost");
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin === "null" ||
    url.pathname.replace(/\/$/, "") !== `/api/projects/${projectId}/auth`
  ) {
    return null;
  }
  return url.href.replace(/\/$/, "");
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

async function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("AuthOwl activation wait aborted"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}
