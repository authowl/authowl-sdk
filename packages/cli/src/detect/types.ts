export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export type Framework =
  | "next-app"
  | "next-pages"
  | "next-hybrid"
  | "next-unknown"
  | "vite-react"
  | "react-scripts"
  | "react-manual"
  | "unknown";

export type ProjectSnapshot = {
  root: string;
  packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  packageManagerContext: {
    root: string | null;
    declared: string | undefined;
    lockfiles: string[];
  };
  existingPaths: Set<string>;
  dirtyWorktree: boolean | null;
  configSources: Record<string, string>;
};

export type ProjectDetection = {
  root: string;
  framework: Framework;
  frameworkVersion: string | null;
  packageManager: PackageManager;
  packageManagerRoot: string | null;
  packageManagerEvidence: string[];
  sourceRoot: "." | "src" | null;
  typescript: boolean;
  ports: number[];
  dirtyWorktree: boolean | null;
  safeToGenerate: boolean;
  guidance: string[];
};
