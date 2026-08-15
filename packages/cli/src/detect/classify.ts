import type {
  Framework,
  PackageManager,
  ProjectDetection,
  ProjectSnapshot,
} from "./types";

const LOCKFILES: Record<string, PackageManager> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

export function classifyProject(snapshot: ProjectSnapshot): ProjectDetection {
  const dependencies = {
    ...snapshot.packageJson.devDependencies,
    ...snapshot.packageJson.dependencies,
  };
  const framework = detectFramework(dependencies, snapshot.existingPaths);
  const packageManagerResult = detectPackageManager(snapshot);
  const sourceRoot = detectSourceRoot(framework, snapshot.existingPaths);
  const typescript =
    snapshot.existingPaths.has("tsconfig.json") ||
    [...snapshot.existingPaths].some((path) => /\.(?:ts|tsx|mts)$/.test(path));
  const ports = detectPorts(snapshot, framework);
  const guidance = guidanceFor(framework, packageManagerResult.manager);
  const safeFramework = framework === "next-app" || framework === "vite-react";

  return {
    root: snapshot.root,
    framework,
    frameworkVersion: frameworkVersion(framework, dependencies),
    packageManager: packageManagerResult.manager,
    packageManagerRoot: snapshot.packageManagerContext.root,
    packageManagerEvidence: packageManagerResult.evidence,
    sourceRoot,
    typescript,
    ports,
    dirtyWorktree: snapshot.dirtyWorktree,
    safeToGenerate:
      safeFramework &&
      sourceRoot !== null &&
      packageManagerResult.manager !== "unknown",
    guidance,
  };
}

function detectFramework(
  dependencies: Record<string, string>,
  paths: Set<string>,
): Framework {
  if (dependencies.next) {
    const app = paths.has("app") || paths.has("src/app");
    const pages = paths.has("pages") || paths.has("src/pages");
    if (app && pages) return "next-hybrid";
    if (app) return "next-app";
    if (pages) return "next-pages";
    return "next-unknown";
  }
  if (dependencies.vite && dependencies.react) return "vite-react";
  if (dependencies["react-scripts"] && dependencies.react)
    return "react-scripts";
  if (dependencies.react) return "react-manual";
  return "unknown";
}

function detectPackageManager(snapshot: ProjectSnapshot): {
  manager: PackageManager;
  evidence: string[];
} {
  const declared = declaredPackageManager(
    snapshot.packageManagerContext.declared,
  );
  const evidence = Object.entries(LOCKFILES)
    .filter(([path]) => snapshot.packageManagerContext.lockfiles.includes(path))
    .map(([path, manager]) => `${path}:${manager}`);
  if (declared)
    return {
      manager: declared,
      evidence: [`packageManager:${declared}`, ...evidence],
    };
  const managers = new Set(
    evidence.map((item) => item.split(":")[1] as PackageManager),
  );
  if (managers.size === 1) return { manager: [...managers][0]!, evidence };
  return { manager: "unknown", evidence };
}

function declaredPackageManager(
  value: string | undefined,
): PackageManager | null {
  const name = value?.split("@")[0];
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun"
    ? name
    : null;
}

function detectSourceRoot(
  framework: Framework,
  paths: Set<string>,
): "." | "src" | null {
  if (framework.startsWith("next")) {
    if (paths.has("src/app") || paths.has("src/pages")) return "src";
    if (paths.has("app") || paths.has("pages")) return ".";
    return null;
  }
  if (
    framework === "vite-react" ||
    framework === "react-scripts" ||
    framework === "react-manual"
  ) {
    if ([...paths].some((path) => path.startsWith("src/main."))) return "src";
    return null;
  }
  return null;
}

function detectPorts(
  snapshot: ProjectSnapshot,
  framework: Framework,
): number[] {
  const found = new Set<number>();
  for (const [name, script] of Object.entries(
    snapshot.packageJson.scripts ?? {},
  )) {
    if (!/^(?:dev|start|serve)(?::|$)/.test(name)) continue;
    for (const match of script.matchAll(
      /(?:--port(?:=|\s+)|(?:^|\s)-p\s+)(\d{2,5})\b/g,
    )) {
      addPort(found, Number(match[1]));
    }
  }
  for (const source of Object.values(snapshot.configSources)) {
    for (const match of source.matchAll(/\bport\s*:\s*(\d{2,5})\b/g)) {
      addPort(found, Number(match[1]));
    }
  }
  if (found.size === 0 && framework.startsWith("next")) found.add(3000);
  if (found.size === 0 && framework === "vite-react") found.add(5173);
  return [...found].sort((left, right) => left - right);
}

function addPort(ports: Set<number>, port: number): void {
  if (Number.isInteger(port) && port >= 1 && port <= 65_535) ports.add(port);
}

function frameworkVersion(
  framework: Framework,
  dependencies: Record<string, string>,
): string | null {
  if (framework.startsWith("next")) return dependencies.next ?? null;
  if (framework === "vite-react") return dependencies.vite ?? null;
  if (framework === "react-scripts")
    return dependencies["react-scripts"] ?? null;
  return dependencies.react ?? null;
}

function guidanceFor(
  framework: Framework,
  packageManager: PackageManager,
): string[] {
  const guidance: string[] = [];
  if (packageManager === "unknown") {
    guidance.push(
      "Choose a package manager explicitly; lockfiles are missing or ambiguous.",
    );
  }
  if (framework === "next-pages") {
    guidance.push(
      "Next.js Pages Router is detected. Use the manual integration guide.",
    );
  } else if (framework === "next-hybrid") {
    guidance.push(
      "Both App Router and Pages Router are present. Automatic edits are disabled.",
    );
  } else if (framework === "next-unknown") {
    guidance.push(
      "Next.js is installed, but no app or pages directory was found.",
    );
  } else if (framework === "react-scripts") {
    guidance.push(
      "Create React App is detected. Use the manual React integration guide.",
    );
  } else if (framework === "react-manual") {
    guidance.push(
      "React is detected without a supported generator. Use the manual integration guide.",
    );
  } else if (framework === "unknown") {
    guidance.push(
      "No supported Next.js or Vite React application was detected.",
    );
  }
  return guidance;
}
