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
  generateViteApp,
  GeneratorValidationError,
} from "../../packages/cli/src/generate/vite-generator";
import { AUTHOWL_REACT_VERSION } from "../../packages/cli/src/metadata";
import {
  runProcess,
  type ProcessRunner,
} from "../../packages/cli/src/process-runner";

const repository = resolve(import.meta.dirname, "../..");
const consumerFixture = resolve(
  repository,
  "scripts/ci/fixtures/vite-consumer/package.json",
);
const consumerTemporaryRoot =
  process.env.AUTHOWL_CONSUMER_TMPDIR ?? tmpdir();
let work: string | undefined;

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

it("builds a fresh Vite React consumer from packed AuthOwl SDKs", async () => {
  work = await mkdtemp(join(consumerTemporaryRoot, "authowl-vite-check-"));
  const tarballs = join(work, "tarballs");
  const application = join(work, "application");
  await mkdir(join(application, "src"), { recursive: true });
  await mkdir(tarballs);

  for (const packageDirectory of ["auth-core", "auth-react"]) {
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
  const localPackages = [archive("authowl-core-"), archive("authowl-react-")];

  await writeFile(join(application, "package.json"), await readFile(consumerFixture));
  // `application` is a test-owned temporary directory and the HTML is a fixed fixture.
  await writeFile(
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
    join(application, "index.html"),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
  );
  await writeFile(
    join(application, "src/App.tsx"),
    "export function App() { return <main>Home</main>; }\n",
  );
  await writeFile(
    join(application, "src/main.tsx"),
    'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport { App } from "./App";\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n',
  );
  await writeFile(
    join(application, "tsconfig.json"),
    '{"compilerOptions":{"target":"ES2022","lib":["ES2022","DOM","DOM.Iterable"],"module":"ESNext","moduleResolution":"bundler","jsx":"react-jsx","strict":true,"noEmit":true,"skipLibCheck":true,"types":["vite/client"]},"include":["src"]}\n',
  );

  const runner: ProcessRunner = async (command, args, options) => {
    if (command === "npm" && args[0] === "install") {
      const expectedReact = `@authowl/react@${AUTHOWL_REACT_VERSION}`;
      if (!args.includes(expectedReact)) {
        return {
          code: 1,
          stdout: "",
          stderr: "Generator did not request the exact React SDK version.\n",
        };
      }
      return runProcess(
        "npm",
        [
          ...args.map((argument) =>
            argument === expectedReact ? localPackages[1] : argument,
          ),
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
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnvironment;
    }
  };
  const detection: ProjectDetection = {
    root: application,
    framework: "vite-react",
    frameworkVersion: "7.3.6",
    packageManager: "npm",
    packageManagerRoot: application,
    packageManagerEvidence: ["packageManager:npm"],
    sourceRoot: "src",
    typescript: true,
    ports: [5173],
    dirtyWorktree: false,
    safeToGenerate: true,
    guidance: [],
  };

  let generated: Awaited<ReturnType<typeof generateViteApp>>;
  try {
    generated = await generateViteApp(
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

  expect(generated.route).toBe("http://localhost:5173/sign-in");
  expect(
    await readFile(join(application, "dist/index.html"), "utf8"),
  ).toContain('<div id="root"></div>');
  expect(
    await readFile(join(application, "src/authowl-root.tsx"), "utf8"),
  ).toContain("<SignIn />");
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
