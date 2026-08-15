import { parseArgs } from "node:util";
import { deleteCredential } from "./credentials";
import { detectProject, type ProjectDetection } from "./detect";
import { runDocsCommand, type DocsDependencies } from "./docs";
import {
  DeviceLoginError,
  loginWithDevice,
  type DeviceLoginDependencies,
} from "./device-login";
import { CLI_VERSION } from "./metadata";
import { GeneratorValidationError } from "./generate/next-generator";
import { GeneratorConflictError } from "./generate/next-plan";
import { runInit, type InitOptions } from "./init";
import {
  isRemoteCommand,
  runRemoteCommand,
  type RemoteCommandDependencies,
} from "./remote-commands";
import {
  runImport,
  type RunImportDependencies,
  type RunImportOptions,
} from "./import/run-import";
import { parseImportCliOptions } from "./import/cli-options";

export type CliDependencies = {
  cwd?: string;
  deleteCredential?: () => Promise<boolean>;
  detectProject?: (directory: string) => Promise<ProjectDetection>;
  device?: DeviceLoginDependencies;
  docs?: DocsDependencies;
  init?: (options: InitOptions) => Promise<unknown>;
  import?: (options: RunImportOptions) => Promise<string>;
  importDependencies?: RunImportDependencies;
  remote?: RemoteCommandDependencies;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
};

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {},
  signal?: AbortSignal,
): Promise<number> {
  const output =
    dependencies.stdout ?? ((message) => process.stdout.write(`${message}\n`));
  const errorOutput =
    dependencies.stderr ?? ((message) => process.stderr.write(`${message}\n`));
  let parsed: {
    values: {
      "api-url"?: string;
      "auth-methods"?: string;
      cwd?: string;
      "dry-run"?: boolean;
      "firebase-hash-config"?: string;
      from?: string;
      help?: boolean;
      json?: boolean;
      "no-open"?: boolean;
      project?: string;
      "project-id"?: string;
      "project-name"?: string;
      resume?: boolean;
      "source-namespace"?: string;
      undo?: boolean;
      version?: boolean;
      yes?: boolean;
    };
    positionals: string[];
  };
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        "api-url": { type: "string" },
        "auth-methods": { type: "string" },
        cwd: { type: "string" },
        "dry-run": { type: "boolean" },
        "firebase-hash-config": { type: "string" },
        from: { type: "string" },
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        "no-open": { type: "boolean" },
        project: { type: "string" },
        "project-id": { type: "string" },
        "project-name": { type: "string" },
        resume: { type: "boolean" },
        "source-namespace": { type: "string" },
        undo: { type: "boolean" },
        version: { type: "boolean", short: "v" },
        yes: { type: "boolean", short: "y" },
      },
    });
  } catch (error) {
    errorOutput(
      error instanceof Error ? error.message : "Invalid CLI arguments",
    );
    return 2;
  }

  if (parsed.values.version) {
    output(CLI_VERSION);
    return 0;
  }
  const command = parsed.positionals[0];
  if (parsed.values.help || !command) {
    output(helpText());
    return parsed.values.help ? 0 : 2;
  }
  if (command !== "import" && parsed.positionals.length > 1) {
    errorOutput(`Unexpected argument: ${parsed.positionals[1]}`);
    return 2;
  }

  try {
    if (command === "login") {
      await loginWithDevice(
        { apiUrl: parsed.values["api-url"], signal },
        {
          ...dependencies.device,
          ...(parsed.values["no-open"]
            ? { openBrowser: async () => false }
            : {}),
          write: output,
        },
      );
      return 0;
    }
    if (command === "logout") {
      const remove =
        dependencies.deleteCredential ?? (() => deleteCredential());
      output(
        (await remove())
          ? "Local CLI credentials removed."
          : "No local CLI credentials found.",
      );
      return 0;
    }
    if (isRemoteCommand(command)) {
      output(
        await runRemoteCommand(
          command,
          {
            apiUrl: parsed.values["api-url"],
            json: parsed.values.json,
            projectId: parsed.values["project-id"],
          },
          { ...dependencies.remote, signal },
        ),
      );
      return 0;
    }
    if (command === "docs") {
      output(
        await runDocsCommand(
          parsed.values["no-open"] ?? false,
          dependencies.docs,
        ),
      );
      return 0;
    }
    if (command === "detect") {
      const detector =
        dependencies.detectProject ?? ((directory) => detectProject(directory));
      const detection = await detector(
        parsed.values.cwd ?? dependencies.cwd ?? process.cwd(),
      );
      output(
        parsed.values.json
          ? JSON.stringify(detection, null, 2)
          : formatDetection(detection),
      );
      return detection.safeToGenerate ? 0 : 3;
    }
    if (command === "init") {
      const initialize =
        dependencies.init ??
        ((options: InitOptions) =>
          runInit(options, {
            device: dependencies.device,
            write: output,
          }));
      await initialize({
        apiUrl: parsed.values["api-url"],
        authMethods: parsed.values["auth-methods"],
        cwd: parsed.values.cwd ?? dependencies.cwd,
        noOpen: parsed.values["no-open"],
        projectId: parsed.values["project-id"],
        projectName: parsed.values["project-name"],
        signal,
        undo: parsed.values.undo,
        yes: parsed.values.yes,
      });
      return 0;
    }
    if (command === "import") {
      const executeImport =
        dependencies.import ??
        ((options: RunImportOptions) =>
          runImport(options, {
            ...dependencies.importDependencies,
            signal,
          }));
      output(
        await executeImport(
          parseImportCliOptions(parsed.positionals, parsed.values, signal),
        ),
      );
      return 0;
    }
    errorOutput(`Unknown command: ${command}`);
    errorOutput(helpText());
    return 2;
  } catch (error) {
    if (error instanceof GeneratorValidationError) {
      errorOutput(error.message);
      if (error.diagnostics) errorOutput(error.diagnostics);
      if (error.patch) errorOutput(`Proposed patch:\n${error.patch}`);
      return 1;
    }
    if (error instanceof GeneratorConflictError) {
      errorOutput(error.message);
      for (const line of error.guidance) errorOutput(`- ${line}`);
      return 1;
    }
    if (error instanceof DeviceLoginError) {
      errorOutput(error.message);
      return 1;
    }
    errorOutput(
      error instanceof Error
        ? error.message
        : "AuthOwl CLI failed unexpectedly",
    );
    return 1;
  }
}

export function formatDetection(detection: ProjectDetection): string {
  const rows = [
    `Project: ${detection.root}`,
    `Framework: ${detection.framework}${detection.frameworkVersion ? ` (${detection.frameworkVersion})` : ""}`,
    `Package manager: ${detection.packageManager}${
      detection.packageManagerRoot ? ` (${detection.packageManagerRoot})` : ""
    }`,
    `Source root: ${detection.sourceRoot ?? "not detected"}`,
    `TypeScript: ${detection.typescript ? "yes" : "no"}`,
    `Ports: ${detection.ports.length > 0 ? detection.ports.join(", ") : "not detected"}`,
    `Git worktree: ${
      detection.dirtyWorktree === null
        ? "not available"
        : detection.dirtyWorktree
          ? "has changes"
          : "clean"
    }`,
    `Automatic generator: ${detection.safeToGenerate ? "supported" : "manual guidance only"}`,
  ];
  if (detection.guidance.length > 0) {
    rows.push("", ...detection.guidance.map((line) => `- ${line}`));
  }
  return rows.join("\n");
}

function helpText(): string {
  return [
    "AuthOwl CLI",
    "",
    "Usage: authowl <command> [options]",
    "",
    "Commands:",
    "  login     Connect this machine through browser device authorization",
    "  logout    Remove local CLI credentials",
    "  whoami    Show the connected user and workspace",
    "  projects  List projects available to the connected user",
    "  keys      List publishable-key metadata for a project",
    "  docs      Open the AuthOwl documentation",
    "  detect    Inspect the current application without modifying files",
    "  init      Configure a supported Next.js or Vite React application",
    "  import    Convert a provider export locally and upload canonical NDJSON",
    "",
    "Options:",
    "  --api-url <url>       AuthOwl API origin",
    "  --auth-methods <list> Comma-separated methods for a new project",
    "  --from <provider>     clerk, auth0, firebase, supabase, better-auth, authowl, custom",
    "  --firebase-hash-config <file> Firebase password hash parameters JSON",
    "  --dry-run             Validate an import without writing users",
    "  --no-open             Print the approval URL without opening a browser",
    "  --project <id>        Destination project for import",
    "  --project-id <id>     Project for init, keys, or import",
    "  --project-name <name> Name a newly created AuthOwl project",
    "  --resume              Resume a matching interrupted import checkpoint",
    "  --source-namespace <id> Stable source instance or tenant identifier",
    "  --cwd <path>          Application directory (detect/init)",
    "  --json                Print machine-readable JSON where supported",
    "  --undo               Restore the last AuthOwl init change set",
    "  -y, --yes            Accept safe init defaults",
    "  -h, --help            Show help",
    "  -v, --version         Show version",
  ].join("\n");
}
