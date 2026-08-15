import { describe, expect, it } from "vitest";
import {
  formatCommand,
  frozenSyncCommand,
  installExactCommand,
} from "../src/generate/package-manager";

describe("generator package manager commands", () => {
  it.each([
    ["npm", "npm", ["install", "--save-exact", "@authowl/react@0.1.0"]],
    ["pnpm", "pnpm", ["add", "--save-exact", "@authowl/react@0.1.0"]],
    ["yarn", "yarn", ["add", "--exact", "@authowl/react@0.1.0"]],
    ["bun", "bun", ["add", "--exact", "@authowl/react@0.1.0"]],
  ] as const)("installs exact packages with %s", (manager, command, args) => {
    expect(installExactCommand(manager, ["@authowl/react@0.1.0"])).toEqual({
      command,
      args: [...args],
    });
  });

  it.each([
    ["npm", "npm", ["ci"]],
    ["pnpm", "pnpm", ["install", "--frozen-lockfile"]],
    ["yarn", "yarn", ["install", "--frozen-lockfile"]],
    ["bun", "bun", ["install", "--frozen-lockfile"]],
  ] as const)(
    "uses a frozen dependency sync with %s",
    (manager, command, args) => {
      expect(frozenSyncCommand(manager)).toEqual({ command, args: [...args] });
    },
  );

  it("runs the declared local Prettier without downloading a package", () => {
    expect(formatCommand("npm", ["app/layout.tsx"])).toEqual({
      command: "npm",
      args: [
        "exec",
        "--offline",
        "--",
        "prettier",
        "--write",
        "app/layout.tsx",
      ],
    });
    expect(formatCommand("bun", ["src/main.tsx"])).toEqual({
      command: "bunx",
      args: ["--no-install", "prettier", "--write", "src/main.tsx"],
    });
  });
});
