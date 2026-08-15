import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectDetection } from "../src/detect";
import { planNextWrites } from "../src/generate/next-plan";

const roots: string[] = [];
const key = "pk_live_00000000-0000-4000-8000-000000000000_example";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Next.js write planner", () => {
  it("emits JavaScript syntax and extensions for JavaScript projects", async () => {
    const root = await nextRoot(".");
    await rename(join(root, "app/layout.tsx"), join(root, "app/layout.jsx"));
    const writes = await planNextWrites({
      detection: { ...detection(root, "."), typescript: false },
      publishableKey: key,
      apiUrl: "https://api.authowl.test",
    });
    expect(writes.map((write) => write.relativePath)).toContain(
      "app/sign-in/[[...sign-in]]/page.jsx",
    );
    expect(writes.map((write) => write.relativePath)).toContain(
      "middleware.js",
    );
    expect(
      writes.find((write) => write.relativePath === "app/layout.jsx")?.content,
    ).not.toContain("PUBLISHABLE_KEY!");
    expect(
      writes.find((write) => write.relativePath === "middleware.js")?.content,
    ).not.toContain("PUBLISHABLE_KEY!");
  });

  it.each([".", "src"] as const)(
    "plans a %s App Router application",
    async (sourceRoot) => {
      const root = await nextRoot(sourceRoot);
      const writes = await planNextWrites({
        detection: detection(root, sourceRoot),
        publishableKey: key,
        apiUrl: "https://api.authowl.test",
      });
      expect(writes.map((write) => write.relativePath)).toEqual([
        `${sourceRoot === "src" ? "src/" : ""}app/layout.tsx`,
        ".env.local",
        `${sourceRoot === "src" ? "src/" : ""}app/sign-in/[[...sign-in]]/page.tsx`,
        sourceRoot === "src" ? "src/middleware.ts" : "middleware.ts",
      ]);
      expect(writes[0]!.content).toContain("<AuthOwlProvider");
      expect(writes[1]).toMatchObject({
        sensitiveAppend: true,
        mode: 0o600,
      });
      expect(writes[2]!.content).toContain("'use client';");
    },
  );

  it("refuses known conflicts instead of guessing", async () => {
    const cases: Array<[(root: string) => Promise<unknown>, string]> = [
      [
        (root) =>
          writeFile(join(root, "app/layout.jsx"), "export default null;\n"),
        "Multiple App Router root layouts",
      ],
      [
        (root) =>
          writeFile(join(root, "middleware.ts"), "export default null\n"),
        "Existing middleware",
      ],
      [
        (root) =>
          writeFile(
            join(root, "app/layout.tsx"),
            `'use client';\nexport default ({ children }: any) => (\n  <>{children}</>\n);\n`,
          ),
        "client root layout",
      ],
      [
        (root) =>
          writeFile(
            join(root, "app/layout.tsx"),
            "export default ({ children }: any) => <>{children}</>;\n",
          ),
        "children anchor",
      ],
      [
        (root) =>
          writeFile(
            join(root, ".env.local"),
            "AUTHOWL_API_URL=https://existing.test\n",
          ),
        "environment values",
      ],
      [
        async (root) => {
          await mkdir(join(root, "app/sign-in/[[...sign-in]]"), {
            recursive: true,
          });
          await writeFile(
            join(root, "app/sign-in/[[...sign-in]]/page.tsx"),
            "export default function Other() {}\n",
          );
        },
        "sign-in route",
      ],
    ];
    for (const [arrange, message] of cases) {
      const root = await nextRoot(".");
      await arrange(root);
      await expect(
        planNextWrites({
          detection: detection(root, "."),
          publishableKey: key,
          apiUrl: "https://api.authowl.test",
        }),
      ).rejects.toThrow(message);
    }
  });

  it("never mutates files during planning", async () => {
    const root = await nextRoot(".");
    const before = await readFile(join(root, "app/layout.tsx"), "utf8");
    await planNextWrites({
      detection: detection(root, "."),
      publishableKey: key,
      apiUrl: "https://api.authowl.test",
    });
    expect(await readFile(join(root, "app/layout.tsx"), "utf8")).toBe(before);
  });
});

async function nextRoot(sourceRoot: "." | "src"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "authowl-next-plan-"));
  roots.push(root);
  const app = join(root, sourceRoot === "src" ? "src/app" : "app");
  await mkdir(app, { recursive: true });
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(
    join(app, "layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <html>\n      <body>\n        {children}\n      </body>\n    </html>\n  );\n}\n",
  );
  return root;
}

function detection(root: string, sourceRoot: "." | "src"): ProjectDetection {
  return {
    root,
    framework: "next-app",
    frameworkVersion: "15.5.0",
    packageManager: "npm",
    packageManagerRoot: root,
    packageManagerEvidence: ["package-lock.json:npm"],
    sourceRoot,
    typescript: true,
    ports: [3010],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
  };
}
