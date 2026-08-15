import type { PackageManager } from "../detect";

export type PackageCommand = { command: string; args: string[] };

export function installExactCommand(
  manager: PackageManager,
  packages: string[],
): PackageCommand {
  if (manager === "npm") {
    return { command: "npm", args: ["install", "--save-exact", ...packages] };
  }
  if (manager === "pnpm") {
    return { command: "pnpm", args: ["add", "--save-exact", ...packages] };
  }
  if (manager === "yarn") {
    return { command: "yarn", args: ["add", "--exact", ...packages] };
  }
  if (manager === "bun") {
    return { command: "bun", args: ["add", "--exact", ...packages] };
  }
  throw new Error("Unsupported package manager");
}

export function frozenSyncCommand(manager: PackageManager): PackageCommand {
  if (manager === "npm") return { command: "npm", args: ["ci"] };
  if (manager === "pnpm" || manager === "yarn" || manager === "bun") {
    return { command: manager, args: ["install", "--frozen-lockfile"] };
  }
  throw new Error("Unsupported package manager");
}

export function formatCommand(
  manager: PackageManager,
  files: string[],
): PackageCommand {
  if (manager === "pnpm" || manager === "yarn") {
    return {
      command: manager,
      args: ["exec", "prettier", "--write", ...files],
    };
  }
  if (manager === "bun") {
    return {
      command: "bunx",
      args: ["--no-install", "prettier", "--write", ...files],
    };
  }
  if (manager === "npm") {
    return {
      command: "npm",
      args: ["exec", "--offline", "--", "prettier", "--write", ...files],
    };
  }
  throw new Error("Unsupported package manager");
}
