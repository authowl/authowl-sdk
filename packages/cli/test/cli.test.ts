import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import { runCli } from "../src/run-cli";
import type { ProjectDetection } from "../src/detect";
import { GeneratorValidationError } from "../src/generate/next-generator";
import { GeneratorConflictError } from "../src/generate/next-plan";

const detection: ProjectDetection = {
  root: "/workspace/app",
  framework: "next-app",
  frameworkVersion: "15.5.0",
  packageManager: "pnpm",
  packageManagerRoot: "/workspace",
  packageManagerEvidence: ["pnpm-lock.yaml:pnpm"],
  sourceRoot: "src",
  typescript: true,
  ports: [3000],
  dirtyWorktree: false,
  safeToGenerate: true,
  guidance: [],
};

describe("CLI command routing", () => {
  it("reports the package version", async () => {
    const stdout: string[] = [];
    expect(
      await runCli(["--version"], { stdout: (line) => stdout.push(line) }),
    ).toBe(0);
    expect(stdout).toEqual([packageMetadata.version]);
  });

  it("prints help without making changes when no command is supplied", async () => {
    const stdout: string[] = [];
    expect(await runCli([], { stdout: (line) => stdout.push(line) })).toBe(2);
    expect(stdout.join("\n")).toContain("authowl <command>");
    expect(stdout.join("\n")).toContain("init");
    expect(stdout.join("\n")).toContain("Vite React");
    expect(await runCli(["--help"], { stdout: () => undefined })).toBe(0);
  });

  it("prints human and JSON detector output", async () => {
    const detector = vi.fn(async () => detection);
    const human: string[] = [];
    expect(
      await runCli(["detect", "--cwd", "/workspace/app"], {
        detectProject: detector,
        stdout: (line) => human.push(line),
      }),
    ).toBe(0);
    expect(detector).toHaveBeenCalledWith("/workspace/app");
    expect(human.join("\n")).toContain("Framework: next-app (15.5.0)");

    const json: string[] = [];
    expect(
      await runCli(["detect", "--json"], {
        detectProject: detector,
        stdout: (line) => json.push(line),
      }),
    ).toBe(0);
    expect(JSON.parse(json[0]!)).toEqual(detection);
  });

  it("returns a distinct manual-guidance status for unsupported layouts", async () => {
    const stdout: string[] = [];
    expect(
      await runCli(["detect"], {
        detectProject: async () => ({
          ...detection,
          framework: "next-hybrid",
          safeToGenerate: false,
          guidance: ["Automatic edits are disabled."],
        }),
        stdout: (line) => stdout.push(line),
      }),
    ).toBe(3);
    expect(stdout.join("\n")).toContain("manual guidance only");
  });

  it("deletes credentials idempotently through logout", async () => {
    const stdout: string[] = [];
    expect(
      await runCli(["logout"], {
        deleteCredential: async () => false,
        stdout: (line) => stdout.push(line),
      }),
    ).toBe(0);
    expect(stdout).toEqual(["No local CLI credentials found."]);
  });

  it("routes the authenticated account commands", async () => {
    const stdout: string[] = [];
    const readCredential = async () => ({
      apiUrl: "https://authowl.dev",
      accessToken: `aoc_${"t".repeat(43)}`,
      scopes: ["projects:read"],
      createdAt: "2026-07-14T00:00:00.000Z",
      expiresAt: "2026-07-14T01:00:00.000Z",
    });
    const remote = {
      readCredential,
      getIdentity: vi.fn(async () => ({
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "owner@example.com",
        },
        workspace: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Cairo Shop",
        },
      })),
      listProjects: vi.fn(async () => []),
      listPublishableKeys: vi.fn(async () => []),
    };
    expect(
      await runCli(["whoami"], {
        remote,
        stdout: (line) => stdout.push(line),
      }),
    ).toBe(0);
    expect(
      await runCli(["projects", "--json"], { remote, stdout: () => undefined }),
    ).toBe(0);
    expect(
      await runCli(
        ["keys", "--project-id", "11111111-1111-4111-8111-111111111111"],
        { remote, stdout: () => undefined },
      ),
    ).toBe(0);
    expect(stdout.join("\n")).toContain("owner@example.com");
    expect(remote.getIdentity).toHaveBeenCalledOnce();
    expect(remote.listProjects).toHaveBeenCalledOnce();
    expect(remote.listPublishableKeys).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ readCredential }),
    );
  });

  it("opens docs or prints the stable URL", async () => {
    const stdout: string[] = [];
    const openBrowser = vi.fn(async () => true);
    expect(
      await runCli(["docs"], {
        docs: { openBrowser },
        stdout: (line) => stdout.push(line),
      }),
    ).toBe(0);
    expect(openBrowser).toHaveBeenCalledWith("https://authowl.dev");
    expect(stdout[0]).toContain("Opened AuthOwl docs");

    openBrowser.mockClear();
    expect(
      await runCli(["docs", "--no-open"], {
        docs: { openBrowser },
        stdout: (line) => stdout.push(line),
      }),
    ).toBe(0);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(stdout.at(-1)).toBe("AuthOwl docs: https://authowl.dev");
  });

  it("routes init options without exposing implementation details", async () => {
    const initialize = vi.fn(async () => undefined);
    expect(
      await runCli(
        [
          "init",
          "--cwd",
          "/workspace/app",
          "--api-url",
          "https://api.authowl.test",
          "--auth-methods",
          "password,passkey",
          "--project-id",
          "project-id",
          "--project-name",
          "Cairo Shop",
          "--no-open",
          "--yes",
        ],
        { init: initialize },
      ),
    ).toBe(0);
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "https://api.authowl.test",
        authMethods: "password,passkey",
        cwd: "/workspace/app",
        noOpen: true,
        projectId: "project-id",
        projectName: "Cairo Shop",
        yes: true,
      }),
    );
  });

  it("routes init undo and reports safe generator guidance", async () => {
    const undo = vi.fn(async () => undefined);
    expect(await runCli(["init", "--undo"], { init: undo })).toBe(0);
    expect(undo).toHaveBeenCalledWith(expect.objectContaining({ undo: true }));

    const conflict: string[] = [];
    expect(
      await runCli(["init"], {
        init: async () => {
          throw new GeneratorConflictError("Existing middleware", [
            "Merge it manually.",
          ]);
        },
        stderr: (line) => conflict.push(line),
      }),
    ).toBe(1);
    expect(conflict).toEqual(["Existing middleware", "- Merge it manually."]);

    const failure: string[] = [];
    expect(
      await runCli(["init"], {
        init: async () => {
          throw new GeneratorValidationError(
            "Files restored",
            "safe patch",
            "typecheck failed",
          );
        },
        stderr: (line) => failure.push(line),
      }),
    ).toBe(1);
    expect(failure.join("\n")).toContain("safe patch");
    expect(failure.join("\n")).toContain("typecheck failed");
  });

  it("routes provider imports with explicit source identity and local Firebase config", async () => {
    const executeImport = vi.fn(async () => "Import dry run completed.");
    const stdout: string[] = [];
    expect(
      await runCli(
        [
          "import",
          "./users.csv",
          "--from",
          "clerk",
          "--project",
          "11111111-1111-4111-8111-111111111111",
          "--source-namespace",
          "ins_synthetic",
          "--dry-run",
          "--resume",
        ],
        {
          import: executeImport,
          stdout: (line) => stdout.push(line),
        },
      ),
    ).toBe(0);
    expect(executeImport).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        filePath: "./users.csv",
        from: "clerk",
        projectId: "11111111-1111-4111-8111-111111111111",
        resume: true,
        sourceNamespace: "ins_synthetic",
      }),
    );
    expect(stdout).toEqual(["Import dry run completed."]);

    executeImport.mockClear();
    expect(
      await runCli(
        [
          "import",
          "./firebase-users.json",
          "--from",
          "firebase",
          "--firebase-hash-config",
          "./firebase-hash-config.json",
          "--project",
          "11111111-1111-4111-8111-111111111111",
          "--source-namespace",
          "firebase-project-synthetic",
        ],
        { import: executeImport, stdout: () => undefined },
      ),
    ).toBe(0);
    expect(executeImport).toHaveBeenCalledWith(
      expect.objectContaining({
        firebaseHashConfigPath: "./firebase-hash-config.json",
        from: "firebase",
        sourceNamespace: "firebase-project-synthetic",
      }),
    );
  });

  it("rejects ambiguous import destinations and missing source identity", async () => {
    const errors: string[] = [];
    expect(
      await runCli(
        [
          "import",
          "./users.ndjson",
          "--from",
          "auth0",
          "--project",
          "11111111-1111-4111-8111-111111111111",
        ],
        { stderr: (line) => errors.push(line) },
      ),
    ).toBe(1);
    expect(errors.at(-1)).toContain("--source-namespace");

    errors.length = 0;
    expect(
      await runCli(
        [
          "import",
          "./users.ndjson",
          "--from",
          "auth0",
          "--project",
          "11111111-1111-4111-8111-111111111111",
          "--project-id",
          "22222222-2222-4222-8222-222222222222",
          "--source-namespace",
          "tenant-synthetic",
        ],
        { stderr: (line) => errors.push(line) },
      ),
    ).toBe(1);
    expect(errors.at(-1)).toContain("same project");

    errors.length = 0;
    expect(
      await runCli(
        [
          "import",
          "./users.csv",
          "--from",
          "supabase",
          "--firebase-hash-config",
          "./firebase.json",
          "--project",
          "11111111-1111-4111-8111-111111111111",
          "--source-namespace",
          "supabase-synthetic",
        ],
        { stderr: (line) => errors.push(line) },
      ),
    ).toBe(1);
    expect(errors.at(-1)).toContain("only with --from firebase");
  });

  it("rejects unknown commands and extra positionals", async () => {
    expect(await runCli(["unknown"], { stderr: () => undefined })).toBe(2);
    expect(await runCli(["detect", "extra"], { stderr: () => undefined })).toBe(
      2,
    );
  });
});
