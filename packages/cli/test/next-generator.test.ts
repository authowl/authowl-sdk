import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetection } from "../src/detect";
import {
  generateNextApp,
  GeneratorValidationError,
  undoNextApp,
} from "../src/generate/next-generator";
import { AUTHOWL_NEXT_VERSION, AUTHOWL_REACT_VERSION } from "../src/metadata";
import type { ProcessRunner } from "../src/process-runner";

const roots: string[] = [];
const key = "pk_live_00000000-0000-4000-8000-000000000000_generatorkey";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Next.js generator", () => {
  it("installs exact SDK versions, validates, and supports exact undo", async () => {
    const root = await nextApplication();
    const before = await originals(root);
    const runner = installingRunner(root);

    const result = await generateNextApp(
      {
        detection: detection(root),
        publishableKey: key,
        apiUrl: "https://api.authowl.test",
      },
      { runner },
    );

    expect(result.route).toBe("http://localhost:3010/sign-in");
    expect(runner).toHaveBeenNthCalledWith(
      1,
      "npm",
      [
        "install",
        "--save-exact",
        `@authowl/react@${AUTHOWL_REACT_VERSION}`,
        `@authowl/next@${AUTHOWL_NEXT_VERSION}`,
      ],
      { cwd: root },
    );
    expect(runner).toHaveBeenCalledWith("npm", ["run", "typecheck"], {
      cwd: root,
    });
    expect(runner).toHaveBeenCalledWith("npm", ["run", "build"], {
      cwd: root,
    });
    expect(await readFile(join(root, ".env.local"), "utf8")).toContain(key);

    const sync = vi.fn<ProcessRunner>(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));
    const undone = await undoNextApp(detection(root), sync);
    expect(undone.dependencySyncOk).toBe(true);
    expect(sync).toHaveBeenCalledWith("npm", ["ci"], { cwd: root });
    await expectOriginals(root, before);
    await expect(
      readFile(join(root, "app/sign-in/[[...sign-in]]/page.tsx")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores source, environment, manifest, and lockfile after validation failure", async () => {
    const root = await nextApplication();
    const before = await originals(root);
    const runner = installingRunner(root, true);

    let failure: GeneratorValidationError | undefined;
    try {
      await generateNextApp(
        {
          detection: detection(root),
          publishableKey: key,
          apiUrl: "https://api.authowl.test",
        },
        { runner },
      );
    } catch (error) {
      failure = error as GeneratorValidationError;
    }
    expect(failure).toBeInstanceOf(GeneratorValidationError);
    expect(failure?.patch).toContain("[publishable-key]");
    expect(failure?.patch).not.toContain(key);
    expect(failure?.patch).not.toContain("preexisting-secret");
    expect(failure?.diagnostics).toContain("[publishable-key]");
    expect(failure?.diagnostics).not.toContain(key);
    await expectOriginals(root, before);
    await expect(readFile(join(root, ".gitignore"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, ".authowl/undo/manifest.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(root, "next-env.d.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, ".next/cache/value")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("tracks application writes and workspace lockfiles from a monorepo root", async () => {
    const workspace = await temporaryRoot();
    const root = join(workspace, "apps/web");
    await mkdir(join(root, "src/app"), { recursive: true });
    await writeFile(
      join(workspace, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    await writeFile(join(workspace, "package.json"), '{"private":true}\n');
    await writeFile(
      join(root, "package.json"),
      '{"dependencies":{"next":"15","react":"19"}}\n',
    );
    await writeFile(join(root, "src/app/layout.tsx"), layout);
    const project = detection(root, {
      packageManager: "pnpm",
      packageManagerRoot: workspace,
      sourceRoot: "src",
    });
    const runner = vi.fn<ProcessRunner>(async (command, args) => {
      if (command === "pnpm" && args[0] === "add") {
        await writeFile(
          join(root, "package.json"),
          '{"dependencies":{"@authowl/react":"0.1.0","@authowl/next":"0.1.0","next":"15","react":"19"}}\n',
        );
        await writeFile(
          join(workspace, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\nchanged: true\n",
        );
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const generated = await generateNextApp(
      {
        detection: project,
        publishableKey: key,
        apiUrl: "https://api.authowl.test",
      },
      { runner },
    );
    expect(generated.files).toContain("apps/web/src/app/layout.tsx");
    expect(generated.files).toContain(".gitignore");
    expect(
      await readFile(join(workspace, ".authowl/undo/manifest.json"), "utf8"),
    ).toContain("apps/web/package.json");
  });
});

const layout =
  "export default function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <html>\n      <body>\n        {children}\n      </body>\n    </html>\n  );\n}\n";

async function nextApplication(): Promise<string> {
  const root = await temporaryRoot();
  await mkdir(join(root, "app"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        dependencies: { next: "15", react: "19" },
        scripts: { typecheck: "tsc --noEmit", build: "next build" },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(root, "package-lock.json"), "original-lock\n");
  await writeFile(join(root, "app/layout.tsx"), layout, { mode: 0o640 });
  await writeFile(
    join(root, ".env.local"),
    "DATABASE_URL=preexisting-secret\n",
    { mode: 0o600 },
  );
  return root;
}

function installingRunner(root: string, failTypecheck = false) {
  return vi.fn<ProcessRunner>(async (command, args) => {
    if (command === "npm" && args[0] === "install") {
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      manifest.dependencies["@authowl/react"] = AUTHOWL_REACT_VERSION;
      manifest.dependencies["@authowl/next"] = AUTHOWL_NEXT_VERSION;
      await writeFile(
        join(root, "package.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await writeFile(join(root, "package-lock.json"), "generated-lock\n");
    }
    if (args[0] === "run" && args[1] === "typecheck" && failTypecheck) {
      await writeFile(join(root, "next-env.d.ts"), "generated\n");
      await mkdir(join(root, ".next/cache"), { recursive: true });
      await writeFile(join(root, ".next/cache/value"), "generated\n");
      return {
        code: 1,
        stdout: "",
        stderr: `Type error involving ${key}`,
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
}

async function originals(root: string) {
  return {
    manifest: await readFile(join(root, "package.json")),
    lockfile: await readFile(join(root, "package-lock.json")),
    layout: await readFile(join(root, "app/layout.tsx")),
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
  expect(await readFile(join(root, "app/layout.tsx"))).toEqual(before.layout);
  expect(await readFile(join(root, ".env.local"))).toEqual(before.env);
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "authowl-next-generator-"));
  roots.push(root);
  return root;
}

function detection(
  root: string,
  overrides: Partial<ProjectDetection> = {},
): ProjectDetection {
  return {
    root,
    framework: "next-app",
    frameworkVersion: "15.5.0",
    packageManager: "npm",
    packageManagerRoot: root,
    packageManagerEvidence: ["package-lock.json:npm"],
    sourceRoot: ".",
    typescript: true,
    ports: [3010],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
    ...overrides,
  };
}
