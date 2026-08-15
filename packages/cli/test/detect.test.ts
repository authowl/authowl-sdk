import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyProject,
  collectProjectSnapshot,
  detectProject,
} from "../src/detect";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

const corpus = [
  ["next-root-app", "next-app", "npm", ".", true, [3010]],
  ["next-src-app", "next-app", "pnpm", "src", true, [3000]],
  ["next-pages", "next-pages", "yarn", ".", false, [3000]],
  ["next-hybrid", "next-hybrid", "bun", ".", false, [3000]],
  ["vite-ts", "vite-react", "npm", "src", true, [4173]],
  ["cra", "react-scripts", "npm", "src", false, []],
  ["react-manual", "react-manual", "yarn", "src", false, []],
  ["ambiguous-lockfiles", "next-app", "unknown", ".", false, [3000]],
  ["unknown", "unknown", "npm", null, false, [8080]],
] as const;

describe("project detection fixture corpus", () => {
  it.each(corpus)(
    "classifies %s without modifying it",
    async (
      name,
      framework,
      packageManager,
      sourceRoot,
      safeToGenerate,
      ports,
    ) => {
      const root = join(fixtures, name);
      const before = await treeDigest(root);
      const detection = await detectProject(root, { includeGit: false });
      const after = await treeDigest(root);

      expect(detection).toMatchObject({
        root,
        framework,
        packageManager,
        sourceRoot,
        safeToGenerate,
        ports: [...ports],
        dirtyWorktree: null,
      });
      expect(detection.packageManagerRoot).toBe(root);
      expect(after).toBe(before);
    },
  );

  it("walks up from a nested application directory to package.json", async () => {
    const root = join(fixtures, "next-root-app");
    const snapshot = await collectProjectSnapshot(join(root, "app"), {
      includeGit: false,
    });
    expect(snapshot.root).toBe(root);
  });

  it("trusts an explicit packageManager field while retaining lockfile evidence", () => {
    const detection = classifyProject({
      root: "/fixture",
      packageJson: {
        dependencies: { next: "15", react: "19" },
      },
      packageManagerContext: {
        root: "/fixture",
        declared: "pnpm@9.15.0",
        lockfiles: ["package-lock.json", "pnpm-lock.yaml"],
      },
      existingPaths: new Set(["app"]),
      dirtyWorktree: false,
      configSources: {},
    });
    expect(detection.packageManager).toBe("pnpm");
    expect(detection.packageManagerEvidence).toEqual([
      "packageManager:pnpm",
      "package-lock.json:npm",
      "pnpm-lock.yaml:pnpm",
    ]);
    expect(detection.safeToGenerate).toBe(true);
  });

  it("refuses Vite generation when the entry root is not recognizable", () => {
    const detection = classifyProject({
      root: "/fixture",
      packageJson: {
        dependencies: { react: "19" },
        devDependencies: { vite: "7" },
      },
      packageManagerContext: {
        root: "/fixture",
        declared: undefined,
        lockfiles: ["package-lock.json"],
      },
      existingPaths: new Set(["vite.config.ts"]),
      dirtyWorktree: false,
      configSources: { "vite.config.ts": "export default {}" },
    });
    expect(detection).toMatchObject({
      framework: "vite-react",
      sourceRoot: null,
      safeToGenerate: false,
    });
  });

  it("finds the workspace package manager above a nested application", async () => {
    const workspace = join(fixtures, "monorepo");
    const application = join(workspace, "apps", "web");
    const before = await treeDigest(workspace);
    const detection = await detectProject(join(application, "src"), {
      includeGit: false,
    });
    expect(detection).toMatchObject({
      root: application,
      framework: "next-app",
      packageManager: "pnpm",
      packageManagerRoot: workspace,
      sourceRoot: "src",
      safeToGenerate: true,
    });
    expect(await treeDigest(workspace)).toBe(before);
  });

  it("rejects malformed manifest shapes without changing the fixture", async () => {
    const root = join(fixtures, "malformed-package");
    const before = await treeDigest(root);
    await expect(detectProject(root, { includeGit: false })).rejects.toThrow(
      "package.json dependencies must contain an object",
    );
    expect(await treeDigest(root)).toBe(before);
  });
});

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await filesUnder(root);
  for (const path of files) {
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().sort();
}
