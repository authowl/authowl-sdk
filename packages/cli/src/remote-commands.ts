import { resolveApiUrl } from "./api-url";
import { readCredential, type CliCredential } from "./credentials";
import { getCliIdentity, type CliIdentity } from "./identity-api";
import { listCliProjects, type CliProject } from "./project-api";
import {
  listCliPublishableKeys,
  type CliPublishableKey,
} from "./publishable-key-api";
import type { CliApiDependencies } from "./cli-api";
import { terminalText } from "./terminal";

export type RemoteCommandDependencies = CliApiDependencies & {
  readCredential?: () => Promise<CliCredential | null>;
  getIdentity?: typeof getCliIdentity;
  listProjects?: typeof listCliProjects;
  listPublishableKeys?: typeof listCliPublishableKeys;
};

type RemoteCommandOptions = {
  apiUrl?: string;
  json?: boolean;
  projectId?: string;
};

export type RemoteCommand = "whoami" | "projects" | "keys";

export function isRemoteCommand(value: string): value is RemoteCommand {
  return value === "whoami" || value === "projects" || value === "keys";
}

export async function runRemoteCommand(
  command: RemoteCommand,
  options: RemoteCommandOptions,
  dependencies: RemoteCommandDependencies = {},
): Promise<string> {
  if (command === "whoami") return runWhoamiCommand(options, dependencies);
  if (command === "projects") return runProjectsCommand(options, dependencies);
  return runKeysCommand(options, dependencies);
}

export async function runWhoamiCommand(
  options: RemoteCommandOptions,
  dependencies: RemoteCommandDependencies = {},
): Promise<string> {
  const credential = await requireCredential(options.apiUrl, dependencies);
  const identity = await (dependencies.getIdentity ?? getCliIdentity)(
    credential,
    dependencies,
  );
  return options.json
    ? JSON.stringify(
        {
          user: identity.user,
          workspace: identity.workspace,
          api_url: credential.apiUrl,
        },
        null,
        2,
      )
    : formatIdentity(identity, credential.apiUrl);
}

export async function runProjectsCommand(
  options: RemoteCommandOptions,
  dependencies: RemoteCommandDependencies = {},
): Promise<string> {
  const credential = await requireCredential(options.apiUrl, dependencies);
  const projects = await (dependencies.listProjects ?? listCliProjects)(
    credential,
    dependencies,
  );
  return options.json
    ? JSON.stringify({ projects }, null, 2)
    : formatProjects(projects);
}

export async function runKeysCommand(
  options: RemoteCommandOptions,
  dependencies: RemoteCommandDependencies = {},
): Promise<string> {
  if (!options.projectId) {
    throw new Error(
      "Missing --project-id. Run 'authowl projects' to find a project id.",
    );
  }
  const credential = await requireCredential(options.apiUrl, dependencies);
  const keys = await (
    dependencies.listPublishableKeys ?? listCliPublishableKeys
  )(credential, options.projectId, dependencies);
  return options.json
    ? JSON.stringify({ project_id: options.projectId, keys }, null, 2)
    : formatKeys(keys);
}

async function requireCredential(
  apiUrl: string | undefined,
  dependencies: RemoteCommandDependencies,
): Promise<CliCredential> {
  const credential = await (dependencies.readCredential ?? readCredential)();
  if (!credential) {
    throw new Error("Not logged in. Run 'authowl login' first.");
  }
  if (apiUrl) {
    const requestedApiUrl = resolveApiUrl(apiUrl);
    if (requestedApiUrl !== credential.apiUrl) {
      throw new Error(
        `This machine is logged in to ${credential.apiUrl}. Run 'authowl login --api-url ${requestedApiUrl}' to switch.`,
      );
    }
  }
  return credential;
}

function formatIdentity(identity: CliIdentity, apiUrl: string): string {
  return [
    `Email: ${terminalText(identity.user.email)}`,
    `Workspace: ${terminalText(identity.workspace.name)} (${identity.workspace.id})`,
    `API: ${apiUrl}`,
  ].join("\n");
}

function formatProjects(projects: CliProject[]): string {
  if (projects.length === 0) return "No AuthOwl projects found.";
  return table(
    ["NAME", "ENVIRONMENT", "PROJECT ID", "AUTH METHODS"],
    projects.map((project) => [
      terminalText(project.name),
      project.environmentType,
      project.id,
      project.authMethods.join(", "),
    ]),
  );
}

function formatKeys(keys: CliPublishableKey[]): string {
  if (keys.length === 0) return "No active publishable keys found.";
  return table(
    ["NAME", "KEY", "CREATED", "LAST USED"],
    keys.map((key) => [
      terminalText(key.name),
      `${key.prefix}_...${key.last4}`,
      key.createdAt,
      key.lastUsedAt ?? "never",
    ]),
  );
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  return [headers, ...rows]
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
