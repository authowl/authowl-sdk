import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveApiUrl } from "./api-url";
import { readCredential, type CliCredential } from "./credentials";
import { detectProject, type ProjectDetection } from "./detect";
import { loginWithDevice, type DeviceLoginDependencies } from "./device-login";
import {
  generatorFor,
  type ApplicationGenerator,
  type ApplicationGeneratorDependencies,
  type ApplicationUndo,
} from "./generate/registry";
import {
  createCliProject,
  listCliProjects,
  PROJECT_AUTH_METHODS,
  waitForCliProjectActivation,
  type CliProject,
  type ProjectApiDependencies,
  type ProjectAuthMethod,
} from "./project-api";
import { issueCliPublishableKey } from "./publishable-key-api";
import { terminalPrompt, type CliPrompt } from "./prompt";
import type { ProcessRunner } from "./process-runner";

const PREFLIGHT_KEY =
  "pk_live_00000000-0000-4000-8000-000000000000_PrefLightOnly";

export type InitOptions = {
  apiUrl?: string;
  authMethods?: string;
  cwd?: string;
  noOpen?: boolean;
  projectId?: string;
  projectName?: string;
  signal?: AbortSignal;
  undo?: boolean;
  yes?: boolean;
};

export type InitDependencies = {
  api?: ProjectApiDependencies;
  detect?: (directory: string) => Promise<ProjectDetection>;
  device?: DeviceLoginDependencies;
  generate?: ApplicationGenerator;
  generator?: ApplicationGeneratorDependencies;
  login?: typeof loginWithDevice;
  now?: () => Date;
  prompt?: CliPrompt;
  readCredential?: typeof readCredential;
  runner?: ProcessRunner;
  undo?: ApplicationUndo;
  write?: (message: string) => void;
};

export async function runInit(
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<{ route?: string; files: string[] }> {
  const write =
    dependencies.write ?? ((message) => process.stdout.write(`${message}\n`));
  const detection = await (
    dependencies.detect ?? ((directory) => detectProject(directory))
  )(options.cwd ?? process.cwd());
  const adapter = generatorFor(detection.framework);
  if (options.undo) {
    if (!adapter) throw new Error("No AuthOwl generator is available for undo");
    const result = await (dependencies.undo ?? adapter.undo)(
      detection,
      dependencies.runner,
      options.signal,
    );
    write(`Restored ${result.files.length} files from the last AuthOwl init.`);
    if (!result.dependencySyncOk) {
      write(
        "Files were restored, but dependency sync failed. Run your package manager install command.",
      );
    }
    return { files: result.files };
  }
  if (!adapter || !detection.safeToGenerate) {
    throw new Error(
      detection.guidance.join(" ") ||
        "This project is not safe for automatic setup",
    );
  }
  const prompt = dependencies.prompt ?? terminalPrompt();
  if (detection.dirtyWorktree && !options.yes) {
    if (
      !(await prompt.confirm(
        "The git worktree has changes. Continue with transactional setup?",
      ))
    ) {
      throw new Error("AuthOwl init cancelled");
    }
  }

  await (dependencies.generator?.plan ?? adapter.plan)({
    detection,
    publishableKey: PREFLIGHT_KEY,
    apiUrl: options.apiUrl ?? "https://authowl.dev",
  });
  const credential = await usableCredential(options, dependencies, write);
  const origin = `http://localhost:${detection.ports[0] ?? 3000}`;
  const apiDependencies: ProjectApiDependencies = {
    ...dependencies.api,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const projects = await listCliProjects(credential, apiDependencies);
  const project = await chooseProject(
    { options, detection, origin, projects, credential },
    { prompt, api: apiDependencies },
  );
  const publishableKey = await issueCliPublishableKey(
    credential,
    {
      projectId: project.id,
      name: `AuthOwl CLI - ${basename(detection.root)}`,
    },
    apiDependencies,
  );
  const generated = await (dependencies.generate ?? adapter.generate)(
    {
      detection,
      publishableKey,
      apiUrl: credential.apiUrl,
      signal: options.signal,
    },
    {
      ...dependencies.generator,
      ...(dependencies.runner ? { runner: dependencies.runner } : {}),
    },
  );
  write(`AuthOwl is ready. Open ${generated.route}`);
  write(
    "Run `authowl init --undo` before other edits to restore this change set.",
  );
  write("Waiting for the first signed-in user...");
  const firstSessionAt = await waitForCliProjectActivation(
    credential,
    project.id,
    apiDependencies,
  );
  write(
    firstSessionAt
      ? "First signed-in user detected. Your project is active."
      : "No signed-in user was detected within five minutes. Setup remains ready.",
  );
  return generated;
}

async function usableCredential(
  options: InitOptions,
  dependencies: InitDependencies,
  write: (message: string) => void,
): Promise<CliCredential> {
  const existing = await (dependencies.readCredential ?? readCredential)();
  const requestedApiUrl = options.apiUrl ? resolveApiUrl(options.apiUrl) : null;
  const unexpired =
    existing &&
    new Date(existing.expiresAt).getTime() >
      (dependencies.now ?? (() => new Date()))().getTime();
  if (unexpired && (!requestedApiUrl || existing.apiUrl === requestedApiUrl)) {
    return existing;
  }
  return (dependencies.login ?? loginWithDevice)(
    { apiUrl: options.apiUrl, signal: options.signal },
    {
      ...dependencies.device,
      ...(options.noOpen ? { openBrowser: async () => false } : {}),
      write,
    },
  );
}

async function chooseProject(
  context: {
    options: InitOptions;
    detection: ProjectDetection;
    origin: string;
    projects: CliProject[];
    credential: CliCredential;
  },
  dependencies: { prompt: CliPrompt; api?: ProjectApiDependencies },
): Promise<CliProject> {
  if (context.options.projectId) {
    const selected = context.projects.find(
      (project) => project.id === context.options.projectId,
    );
    if (!selected)
      throw new Error("The requested AuthOwl project was not found");
    if (!selected.allowedOrigins.includes(context.origin)) {
      throw new Error(`The selected project does not allow ${context.origin}`);
    }
    return selected;
  }
  const eligible = context.projects.filter((project) =>
    project.allowedOrigins.includes(context.origin),
  );
  if (eligible.length === 1) return eligible[0]!;
  if (eligible.length > 1) {
    if (context.options.yes) {
      throw new Error(
        "Multiple AuthOwl projects allow this origin. Pass --project-id with --yes.",
      );
    }
    const id = await dependencies.prompt.select(
      `Choose the project already allowing ${context.origin}:`,
      eligible.map((project) => ({ label: project.name, value: project.id })),
    );
    return eligible.find((project) => project.id === id)!;
  }

  const manifest = JSON.parse(
    await readFile(join(context.detection.root, "package.json"), "utf8"),
  ) as {
    name?: unknown;
  };
  const defaultName =
    typeof manifest.name === "string" && manifest.name.trim()
      ? manifest.name.trim()
      : basename(context.detection.root);
  const name =
    context.options.projectName ??
    (context.options.yes
      ? defaultName
      : await dependencies.prompt.input(
          "New AuthOwl project name",
          defaultName,
        ));
  const authMethods = parseAuthMethods(
    context.options.authMethods ??
      (context.options.yes
        ? "password"
        : await dependencies.prompt.input(
            "Auth methods (comma-separated: password, magic_link, email_otp, passkey)",
            "password",
          )),
  );
  if (!name.trim()) throw new Error("The AuthOwl project name cannot be empty");
  return createCliProject(
    context.credential,
    { name: name.trim(), allowedOrigin: context.origin, authMethods },
    dependencies.api,
  );
}

export function parseAuthMethods(input: string): ProjectAuthMethod[] {
  const methods = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    methods.length === 0 ||
    new Set(methods).size !== methods.length ||
    methods.some(
      (method) => !PROJECT_AUTH_METHODS.includes(method as ProjectAuthMethod),
    ) ||
    (methods.length === 1 && methods[0] === "passkey")
  ) {
    throw new Error(
      "Choose unique supported auth methods; passkey cannot be the only method",
    );
  }
  return methods as ProjectAuthMethod[];
}
