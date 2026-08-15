import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import type { ProjectDetection } from "../../packages/cli/src/detect";
import {
  generateNextApp,
  GeneratorValidationError,
} from "../../packages/cli/src/generate/next-generator";
import {
  AUTHOWL_NEXT_VERSION,
  AUTHOWL_REACT_VERSION,
} from "../../packages/cli/src/metadata";
import {
  runProcess,
  type ProcessRunner,
} from "../../packages/cli/src/process-runner";

const repository = resolve(import.meta.dirname, "../..");
const consumerFixture = resolve(
  repository,
  "scripts/ci/fixtures/next-consumer/package.json",
);
const consumerTemporaryRoot =
  process.env.AUTHOWL_CONSUMER_TMPDIR ?? tmpdir();
let work: string | undefined;

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

it("builds a fresh Next.js consumer from packed AuthOwl SDKs", async () => {
  work = await mkdtemp(join(consumerTemporaryRoot, "authowl-next-check-"));
  const tarballs = join(work, "tarballs");
  const application = join(work, "application");
  await mkdir(tarballs);

  for (const packageDirectory of ["auth-core", "auth-react", "auth-next"]) {
    await checked(
      "pnpm",
      ["pack", "--pack-destination", tarballs],
      join(repository, "packages", packageDirectory),
    );
  }
  const packed = await readdir(tarballs);
  const archive = (prefix: string) => {
    const filename = packed.find((entry) => entry.startsWith(prefix));
    if (!filename) throw new Error(`Missing packed ${prefix} archive`);
    return join(tarballs, filename);
  };
  const localPackages = [
    archive("authowl-core-"),
    archive("authowl-react-"),
    archive("authowl-next-"),
  ];
  await mkdir(join(application, "app"), { recursive: true });

  await writeFile(join(application, "package.json"), await readFile(consumerFixture));
  await writeFile(
    join(application, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <html>\n      <body>\n        {children}\n      </body>\n    </html>\n  );\n}\n",
  );
  await writeFile(
    join(application, "app/page.tsx"),
    "export default function Home() { return <main>Home</main>; }\n",
  );
  await writeFile(
    join(application, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
        },
        include: [
          "next-env.d.ts",
          "**/*.ts",
          "**/*.tsx",
          ".next/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      null,
      2,
    )}\n`,
  );

  const runner: ProcessRunner = async (command, args, options) => {
    if (command === "npm" && args[0] === "install") {
      const expectedReact = `@authowl/react@${AUTHOWL_REACT_VERSION}`;
      const expectedNext = `@authowl/next@${AUTHOWL_NEXT_VERSION}`;
      if (!args.includes(expectedReact) || !args.includes(expectedNext)) {
        return {
          code: 1,
          stdout: "",
          stderr: "Generator did not request both exact SDK versions.\n",
        };
      }
      return runProcess(
        "npm",
        [
          ...args.map((argument) => {
            if (argument === expectedReact) return localPackages[1];
            if (argument === expectedNext) return localPackages[2];
            return argument;
          }),
          localPackages[0],
        ],
        options,
      );
    }
    const previousNodeEnvironment = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      return await runProcess(command, args, options);
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }
  };
  const detection: ProjectDetection = {
    root: application,
    framework: "next-app",
    frameworkVersion: "16.2.12",
    packageManager: "npm",
    packageManagerRoot: application,
    packageManagerEvidence: ["packageManager:npm"],
    sourceRoot: ".",
    typescript: true,
    ports: [3000],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
  };

  let generated: Awaited<ReturnType<typeof generateNextApp>>;
  try {
    generated = await generateNextApp(
      {
        detection,
        publishableKey:
          "pk_live_11111111-1111-4111-8111-111111111111_abcdefghij0123456789",
        apiUrl: "https://api.authowl.test",
      },
      { runner },
    );
  } catch (error) {
    if (error instanceof GeneratorValidationError) {
      throw new Error(`${error.message}\n${error.diagnostics}`);
    }
    throw error;
  }

  expect(generated.route).toBe("http://localhost:3000/sign-in");
  expect(await readFile(join(application, ".next/BUILD_ID"), "utf8")).not.toBe(
    "",
  );
  expect(
    await readFile(
      join(application, "app/sign-in/[[...sign-in]]/page.tsx"),
      "utf8",
    ),
  ).toContain("<SignIn />");
  await checked(
    "node",
    ["--input-type=module", "--eval", "await import('@authowl/next/server');"],
    application,
  );
}, 180_000);

async function checked(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const result = await runProcess(command, args, { cwd });
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${basename(cwd)}\n${result.stdout}\n${result.stderr}`,
    );
  }
}
