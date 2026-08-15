import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectDetection } from "../src/detect";
import { planViteWrites } from "../src/generate/vite-plan";

const roots: string[] = [];
const key = "pk_live_00000000-0000-4000-8000-000000000000_viteexample";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Vite React write planner", () => {
  it.each([
    [true, "tsx"],
    [false, "jsx"],
  ] as const)("plans a native %s entrypoint", async (typescript, extension) => {
    const root = await viteRoot(extension);
    const writes = await planViteWrites({
      detection: detection(root, typescript),
      publishableKey: key,
      apiUrl: "https://api.authowl.test",
    });
    expect(writes.map((write) => write.relativePath)).toEqual([
      `src/main.${extension}`,
      ".env.local",
      `src/authowl-root.${extension}`,
    ]);
    expect(writes[0]!.content).toContain("<AuthOwlRoot>");
    expect(writes[1]).toMatchObject({
      mode: 0o600,
      sensitiveAppend: true,
    });
    expect(writes[1]!.content).toContain("VITE_AUTHOWL_PUBLISHABLE_KEY=");
    expect(writes[2]!.content).toContain(
      'window.location.pathname === "/sign-in"',
    );
    expect(writes[2]!.content.includes("ReactNode")).toBe(typescript);
  });

  it("refuses ambiguous renders, existing env values, and conflicting generated roots", async () => {
    const cases: Array<[(root: string) => Promise<unknown>, string]> = [
      [
        (root) =>
          writeFile(join(root, "src/main.jsx"), "export default null;\n"),
        "Multiple Vite React entrypoints",
      ],
      [
        (root) =>
          writeFile(
            join(root, "src/main.tsx"),
            "createRoot(node).render(<App />);\n",
          ),
        "render anchor",
      ],
      [
        (root) =>
          writeFile(
            join(root, ".env.local"),
            "VITE_AUTHOWL_API_URL=https://existing.test\n",
          ),
        "environment values",
      ],
      [
        (root) =>
          writeFile(
            join(root, "src/authowl-root.tsx"),
            "export const Other = null;\n",
          ),
        "already contains other code",
      ],
    ];
    for (const [arrange, message] of cases) {
      const root = await viteRoot("tsx");
      await arrange(root);
      await expect(
        planViteWrites({
          detection: detection(root, true),
          publishableKey: key,
          apiUrl: "https://api.authowl.test",
        }),
      ).rejects.toThrow(message);
    }
  });

  it("does not mutate the recognized entrypoint during planning", async () => {
    const root = await viteRoot("tsx");
    const before = await readFile(join(root, "src/main.tsx"), "utf8");
    await planViteWrites({
      detection: detection(root, true),
      publishableKey: key,
      apiUrl: "https://api.authowl.test",
    });
    expect(await readFile(join(root, "src/main.tsx"), "utf8")).toBe(before);
  });
});

async function viteRoot(extension: "tsx" | "jsx"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "authowl-vite-plan-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(
    join(root, `src/main.${extension}`),
    'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport { App } from "./App";\n\ncreateRoot(document.getElementById("root")).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n',
  );
  return root;
}

function detection(root: string, typescript: boolean): ProjectDetection {
  return {
    root,
    framework: "vite-react",
    frameworkVersion: "7.0.0",
    packageManager: "npm",
    packageManagerRoot: root,
    packageManagerEvidence: ["package-lock.json:npm"],
    sourceRoot: "src",
    typescript,
    ports: [4173],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
  };
}
