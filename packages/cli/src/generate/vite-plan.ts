import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectDetection } from "../detect";
import type { PlannedWrite } from "../mutation/transaction";
import { GeneratorConflictError } from "./conflict";
import {
  appendEnvironment,
  existingPaths,
  readOptionalText,
} from "./planner-files";

const ENTRY_FILES = [
  "src/main.tsx",
  "src/main.jsx",
  "src/main.ts",
  "src/main.js",
] as const;

export async function planViteWrites(input: {
  detection: ProjectDetection;
  publishableKey: string;
  apiUrl: string;
}): Promise<PlannedWrite[]> {
  const { detection } = input;
  if (detection.framework !== "vite-react" || detection.sourceRoot !== "src") {
    throw new GeneratorConflictError(
      "Automatic Vite setup requires a recognized React entrypoint",
      ["Use the manual React guide for custom Vite application roots."],
    );
  }
  const entryPaths = await existingPaths(detection.root, [...ENTRY_FILES]);
  if (entryPaths.length === 0) {
    throw new GeneratorConflictError(
      "The Vite React entrypoint was not found",
      ["Create src/main.tsx or src/main.jsx, then run authowl init again."],
    );
  }
  if (entryPaths.length > 1) {
    throw new GeneratorConflictError(
      "Multiple Vite React entrypoints were found",
      ["Keep one recognized src/main file, then run authowl init again."],
    );
  }
  const entryPath = entryPaths[0]!;
  const entry = await readFile(join(detection.root, entryPath), "utf8");
  const envPath = ".env.local";
  const env = await readOptionalText(join(detection.root, envPath));
  if (/^VITE_AUTHOWL_(?:PUBLISHABLE_KEY|API_URL)\s*=/m.test(env)) {
    throw new GeneratorConflictError(
      "AuthOwl environment values already exist",
      [
        "AuthOwl never overwrites an existing environment value. Reconcile .env.local manually.",
      ],
    );
  }

  const rootPath = `src/authowl-root.${detection.typescript ? "tsx" : "jsx"}`;
  const root = authOwlRoot(detection.typescript);
  const existingRootPaths = await existingPaths(detection.root, [
    "src/authowl-root.tsx",
    "src/authowl-root.jsx",
  ]);
  if (existingRootPaths.length > 1) {
    throw new GeneratorConflictError("Multiple AuthOwl Vite roots were found", [
      "Keep one generated AuthOwl root, then run authowl init again.",
    ]);
  }
  const existingRootPath = existingRootPaths[0] ?? null;
  const existingRoot = existingRootPath
    ? await readFile(join(detection.root, existingRootPath), "utf8")
    : "";
  if (
    existingRootPath &&
    (existingRootPath !== rootPath || existingRoot !== root)
  ) {
    throw new GeneratorConflictError(
      "The AuthOwl Vite root already contains other code",
      [
        `Keep ${existingRootPath} and compose AuthOwlProvider and SignIn manually.`,
      ],
    );
  }

  const writes: PlannedWrite[] = [
    { relativePath: entryPath, content: wrapViteEntry(entry, entryPath) },
    {
      relativePath: envPath,
      content: appendEnvironment(env, [
        ["VITE_AUTHOWL_PUBLISHABLE_KEY", input.publishableKey],
        ["VITE_AUTHOWL_API_URL", input.apiUrl],
      ]),
      mode: 0o600,
      sensitiveAppend: true,
    },
    { relativePath: rootPath, content: root },
  ];
  return writes.filter(
    (write) =>
      write.relativePath !== rootPath ||
      existingRootPath !== rootPath ||
      existingRoot !== root,
  );
}

export function wrapViteEntry(source: string, path = "src/main.tsx"): string {
  if (/\bAuthOwlRoot\b/.test(source)) {
    throw new GeneratorConflictError(
      "AuthOwlRoot is already present in the Vite entrypoint",
      [`Review ${path} and .env.local instead of generating a second root.`],
    );
  }
  const matches = [...source.matchAll(/^(\s*)<App\s*\/>\s*$/gm)];
  if (matches.length !== 1) {
    throw new GeneratorConflictError(
      "The Vite App render anchor is ambiguous",
      [`Wrap the single <App /> render in ${path} with AuthOwlRoot manually.`],
    );
  }
  const indent = matches[0]![1] ?? "";
  const wrapped = [
    `${indent}<AuthOwlRoot>`,
    `${indent}  <App />`,
    `${indent}</AuthOwlRoot>`,
  ].join("\n");
  const withRoot = source.replace(matches[0]![0], wrapped);
  const directive = /^(?:\s*["'][^"']+["'];?\s*)*/.exec(withRoot)?.[0] ?? "";
  return `${directive}import { AuthOwlRoot } from "./authowl-root";\n${withRoot.slice(directive.length)}`;
}

function authOwlRoot(typescript: boolean): string {
  const typeImport = typescript
    ? 'import type { ReactNode } from "react";\n'
    : "";
  const props = typescript ? ": { children: ReactNode }" : "";
  return `${typeImport}import { AuthOwlProvider, SignIn } from "@authowl/react";\nimport "@authowl/react/styles.css";\n\nexport function AuthOwlRoot({ children }${props}) {\n  const content = window.location.pathname === "/sign-in" ? <SignIn /> : children;\n\n  return (\n    <AuthOwlProvider\n      publishableKey={import.meta.env.VITE_AUTHOWL_PUBLISHABLE_KEY}\n      apiUrl={import.meta.env.VITE_AUTHOWL_API_URL}\n    >\n      {content}\n    </AuthOwlProvider>\n  );\n}\n`;
}
