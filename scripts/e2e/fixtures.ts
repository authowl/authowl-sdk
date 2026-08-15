import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { checked, cleanEnvironment, executablePath } from "./process";

export type Framework = "next" | "vite";
export type Fixture = {
  application: string;
  envFile: string;
  framework: Framework;
  origin: string;
  runner: string;
};
export type FreshMachineWorkspace = {
  cliArchive: string;
  npmPath: string;
  npxPath: string;
  packageArchives: Record<string, string>;
  root: string;
};

export async function prepareWorkspace(
  repository: string,
): Promise<FreshMachineWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "authowl-fresh-machine-"));
  const npmPath = await executablePath("npm", repository);
  const npxPath = await executablePath("npx", repository);
  const tarballs = join(root, "tarballs");
  await mkdir(tarballs);
  for (const directory of ["auth-core", "auth-react", "auth-next", "cli"]) {
    await checked(
      "pnpm",
      ["pack", "--pack-destination", tarballs],
      join(repository, "packages", directory),
    );
  }
  const archives = (await readdir(tarballs)).map((file) =>
    join(tarballs, file),
  );
  return {
    root,
    npmPath,
    npxPath,
    packageArchives: {
      "@authowl/core": archive(archives, "authowl-core-"),
      "@authowl/react": archive(archives, "authowl-react-"),
      "@authowl/next": archive(archives, "authowl-next-"),
    },
    cliArchive: archive(archives, "authowl-0.1.0"),
  };
}

export async function createFixture(
  workspace: FreshMachineWorkspace,
  framework: Framework,
  port: number,
): Promise<Fixture> {
  const root = join(workspace.root, `${framework}-${randomUUID()}`);
  const application = join(root, "application");
  const runner = join(root, "runner");
  await mkdir(application, { recursive: true });
  await mkdir(runner);
  const origin = `http://localhost:${port}`;
  if (framework === "next") await writeNextFixture(application, port);
  else await writeViteFixture(application, port);
  await checked(
    workspace.npmPath,
    ["install", "--ignore-scripts"],
    application,
  );
  await writeFile(
    join(runner, "package.json"),
    '{"name":"authowl-e2e-runner","private":true}\n',
  );
  await checked(
    workspace.npmPath,
    ["install", "--ignore-scripts", workspace.cliArchive],
    runner,
  );
  return {
    application,
    envFile: join(application, ".env.local"),
    framework,
    origin,
    runner,
  };
}

export async function e2eEnvironment(
  workspace: FreshMachineWorkspace,
  fixture: Fixture,
): Promise<NodeJS.ProcessEnv> {
  const bin = join(workspace.root, `bin-${fixture.framework}-${randomUUID()}`);
  await mkdir(bin);
  const wrapper = join(bin, "npm");
  await writeFile(wrapper, npmWrapperSource());
  await chmod(wrapper, 0o755);
  const home = join(
    workspace.root,
    `home-${fixture.framework}-${randomUUID()}`,
  );
  await mkdir(home);
  return {
    ...cleanEnvironment(),
    AUTHOWL_CONFIG_HOME: join(home, "authowl-config"),
    AUTHOWL_E2E_ARCHIVES: JSON.stringify(workspace.packageArchives),
    AUTHOWL_E2E_NPM: workspace.npmPath,
    AUTHOWL_E2E_PATH: process.env.PATH,
    HOME: home,
    NODE_ENV: undefined,
    PATH: `${bin}:${process.env.PATH}`,
  };
}

async function writeNextFixture(
  application: string,
  port: number,
): Promise<void> {
  await mkdir(join(application, "app"));
  await writeJson(join(application, "package.json"), {
    name: "authowl-fresh-next",
    private: true,
    packageManager: "npm@10.9.2",
    scripts: {
      dev: `next dev -p ${port}`,
      typecheck: "tsc --noEmit",
      build: "next build",
    },
    dependencies: {
      next: "15.5.0",
      react: "19.0.0",
      "react-dom": "19.0.0",
    },
    devDependencies: {
      "@types/node": "22.10.2",
      "@types/react": "19.0.2",
      "@types/react-dom": "19.0.2",
      typescript: "5.7.2",
    },
  });
  await writeFile(
    join(application, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <html>\n      <body>\n        {children}\n      </body>\n    </html>\n  );\n}\n",
  );
  await writeFile(
    join(application, "app/page.tsx"),
    "export default function Home() { return <main>Home</main>; }\n",
  );
  await writeJson(join(application, "tsconfig.json"), {
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
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  });
}

async function writeViteFixture(
  application: string,
  port: number,
): Promise<void> {
  await mkdir(join(application, "src"));
  await writeJson(join(application, "package.json"), {
    name: "authowl-fresh-vite",
    private: true,
    packageManager: "npm@10.9.2",
    scripts: {
      dev: `vite --port ${port} --host 127.0.0.1`,
      typecheck: "tsc --noEmit",
      build: "vite build",
    },
    dependencies: { react: "19.0.0", "react-dom": "19.0.0" },
    devDependencies: {
      "@types/react": "19.0.2",
      "@types/react-dom": "19.0.2",
      typescript: "5.7.2",
      vite: "7.0.0",
    },
  });
  await writeFile(
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
  await writeJson(join(application, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["vite/client"],
    },
    include: ["src"],
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function archive(archives: string[], prefix: string): string {
  const found = archives.find((candidate) =>
    basename(candidate).startsWith(prefix),
  );
  if (!found) throw new Error(`Missing packed ${prefix} archive`);
  return found;
}

function npmWrapperSource(): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const original = process.env.AUTHOWL_E2E_NPM;
const archives = JSON.parse(process.env.AUTHOWL_E2E_ARCHIVES || "{}");
const input = process.argv.slice(2);
const hasAuthOwlInstall = input[0] === "install" && input.some((arg) => arg.startsWith("@authowl/"));
const requested = input.filter((arg) => arg.startsWith("@authowl/")).map((arg) => arg.slice(0, arg.lastIndexOf("@")));
const localPackages = hasAuthOwlInstall ? ["@authowl/core", ...requested].filter((name, index, all) => all.indexOf(name) === index).map((name) => archives[name]) : [];
const args = hasAuthOwlInstall ? [...input.filter((arg) => !arg.startsWith("@authowl/")), ...localPackages] : input;
const result = spawnSync(original, args, { env: { ...process.env, PATH: process.env.AUTHOWL_E2E_PATH }, stdio: "inherit" });
process.exit(result.status ?? 1);
`;
}
