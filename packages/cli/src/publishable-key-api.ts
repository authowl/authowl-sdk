import {
  invalidCliResponse,
  isIsoDate,
  isNullableIsoDate,
  isRecord,
  isUuid,
  requestCliApi,
  type CliApiDependencies,
} from "./cli-api";
import type { CliCredential } from "./credentials";

export type CliPublishableKey = {
  id: string;
  name: string;
  prefix: "pk_live" | "pk_test";
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function issueCliPublishableKey(
  credential: CliCredential,
  input: { projectId: string; name?: string },
  dependencies: CliApiDependencies = {},
): Promise<string> {
  if (!isUuid(input.projectId)) throw new Error("Invalid AuthOwl project id");
  const body = await requestCliApi(
    credential,
    `/api/cli/projects/${input.projectId}/publishable-keys`,
    {
      method: "POST",
      body: JSON.stringify(input.name ? { name: input.name } : {}),
    },
    dependencies,
  );
  const key = body.publishable_key;
  const prefixes = [
    `pk_live_${input.projectId}_`,
    `pk_test_${input.projectId}_`,
  ];
  if (typeof key !== "string") throw invalidCliResponse();
  const prefix = prefixes.find((candidate) => key.startsWith(candidate));
  if (!prefix || !/^[A-Za-z0-9]+$/.test(key.slice(prefix.length))) {
    throw invalidCliResponse();
  }
  return key;
}

export async function listCliPublishableKeys(
  credential: CliCredential,
  projectId: string,
  dependencies: CliApiDependencies = {},
): Promise<CliPublishableKey[]> {
  if (!isUuid(projectId)) throw new Error("Invalid AuthOwl project id");
  const body = await requestCliApi(
    credential,
    `/api/cli/projects/${projectId}/publishable-keys`,
    {},
    dependencies,
  );
  if (!Array.isArray(body.keys)) throw invalidCliResponse();
  return body.keys.map(parsePublishableKey);
}

function parsePublishableKey(value: unknown): CliPublishableKey {
  if (!isRecord(value)) throw invalidCliResponse();
  if (
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    typeof value.name !== "string" ||
    !value.name ||
    (value.prefix !== "pk_live" && value.prefix !== "pk_test") ||
    typeof value.last4 !== "string" ||
    !/^[A-Za-z0-9]{4}$/.test(value.last4) ||
    typeof value.created_at !== "string" ||
    !isIsoDate(value.created_at) ||
    !isNullableIsoDate(value.last_used_at)
  ) {
    throw invalidCliResponse();
  }
  return {
    id: value.id,
    name: value.name,
    prefix: value.prefix,
    last4: value.last4,
    createdAt: value.created_at,
    lastUsedAt:
      typeof value.last_used_at === "string" ? value.last_used_at : null,
  };
}
