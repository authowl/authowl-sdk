import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetection } from "../src/detect";
import {
  generateViteApp,
  GeneratorValidationError,
  undoViteApp,
} from "../src/generate/vite-generator";
import { AUTHOWL_REACT_VERSION } from "../src/metadata";
import type { ProcessRunner } from "../src/process-runner";

const roots: string[] = [];
const key = "pk_live_00000000-0000-4000-8000-000000000000_vitegenerator";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Vite React generator", () => {
  it("installs React SDK exactly, validates, and supports undo", async () => {
    const root = await application();
    const before = await originals(root);
    const runner = installingRunner(root);
    const generated = await generateViteApp(
      {
        detection: detection(root),
        publishableKey: key,
        apiUrl: "https://api.authowl.test",
      },
      { runner },
    );

    expect(generated.route).toBe("http://localhost:4173/sign-in");
    expect(runner).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "--save-exact", `@authowl/react@${AUTHOWL_REACT_VERSION}`],
      { cwd: root },
    );
    expect(runner).toHaveBeenCalledWith("npm", ["run", "build"], {
      cwd: root,
    });

    await undoViteApp(
      detection(root),
      vi.fn<ProcessRunner>(async () => ({ code: 0, stdout: "", stderr: "" })),
    );
    await expectOriginals(root, before);
    await expect(
      readFile(join(root, "src/authowl-root.tsx")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores every setup file and removes a failed dist build", async () => {
    const root = await application();
    const before = await originals(root);
    let failure: GeneratorValidationError | undefined;
    try {
      await generateViteApp(
        {
          detection: detection(root),
          publishableKey: key,
          apiUrl: "https://api.authowl.test",
        },
        { runner: installingRunner(root, true) },
      );
    } catch (error) {
      failure = error as GeneratorValidationError;
    }
    expect(failure).toBeInstanceOf(GeneratorValidationError);
    expect(failure?.patch).not.toContain(key);
    expect(failure?.diagnostics).not.toContain(key);
    await expectOriginals(root, before);
    await expect(readFile(join(root, "dist/index.html"))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
  });
});

async function application(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "authowl-vite-generator-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "package.json"),
    '{"dependencies":{"react":"19"},"devDependencies":{"vite":"7"},"scripts":{"build":"vite build"}}\n',
  );
  await writeFile(join(root, "package-lock.json"), "original-lock\n");
  await writeFile(
    join(root, "src/main.tsx"),
    'import { App } from "./App";\n\ncreateRoot(node).render(\n  <App />\n);\n',
  );
  await writeFile(join(root, ".env.local"), "OTHER_SECRET=private\n", {
    mode: 0o600,
  });
  return root;
}

function installingRunner(root: string, fail = false) {
  return vi.fn<ProcessRunner>(async (command, args) => {
    if (command === "npm" && args[0] === "install") {
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      manifest.dependencies["@authowl/react"] = AUTHOWL_REACT_VERSION;
      await writeFile(
        join(root, "package.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await writeFile(join(root, "package-lock.json"), "generated-lock\n");
    }
    if (args[0] === "run" && args[1] === "build" && fail) {
      await mkdir(join(root, "dist"));
      await writeFile(join(root, "dist/index.html"), key);
      return { code: 1, stdout: "", stderr: `build failed ${key}` };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
}

async function originals(root: string) {
  return {
    manifest: await readFile(join(root, "package.json")),
    lockfile: await readFile(join(root, "package-lock.json")),
    entry: await readFile(join(root, "src/main.tsx")),
    env: await readFile(join(root, ".env.local")),
  };
}

async function expectOriginals(
  root: string,
  before: Awaited<ReturnType<typeof originals>>,
) {
  expect(await readFile(join(root, "package.json"))).toEqual(before.manifest);
  expect(await readFile(join(root, "package-lock.json"))).toEqual(
    before.lockfile,
  );
  expect(await readFile(join(root, "src/main.tsx"))).toEqual(before.entry);
  expect(await readFile(join(root, ".env.local"))).toEqual(before.env);
}

function detection(root: string): ProjectDetection {
  return {
    root,
    framework: "vite-react",
    frameworkVersion: "7.0.0",
    packageManager: "npm",
    packageManagerRoot: root,
    packageManagerEvidence: ["package-lock.json:npm"],
    sourceRoot: "src",
    typescript: true,
    ports: [4173],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
  };
}
