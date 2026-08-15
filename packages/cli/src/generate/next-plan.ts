import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectDetection } from "../detect";
import type { PlannedWrite } from "../mutation/transaction";
import { GeneratorConflictError } from "./conflict";
import {
  appendEnvironment,
  existingPaths,
  firstExisting,
  readOptionalText,
} from "./planner-files";

const LAYOUT_FILES = [
  "layout.tsx",
  "layout.jsx",
  "layout.ts",
  "layout.js",
] as const;
const MIDDLEWARE_FILES = [
  "middleware.ts",
  "middleware.js",
  "middleware.mts",
  "middleware.mjs",
  "src/middleware.ts",
  "src/middleware.js",
  "src/middleware.mts",
  "src/middleware.mjs",
] as const;

export { GeneratorConflictError } from "./conflict";

export async function planNextWrites(input: {
  detection: ProjectDetection;
  publishableKey: string;
  apiUrl: string;
}): Promise<PlannedWrite[]> {
  const { detection } = input;
  if (detection.framework !== "next-app" || detection.sourceRoot === null) {
    throw new GeneratorConflictError(
      "Automatic Next.js setup requires an App Router project",
      ["Use the manual Next.js guide for Pages Router or hybrid applications."],
    );
  }

  const appDirectory = detection.sourceRoot === "src" ? "src/app" : "app";
  const layoutPaths = await existingPaths(
    detection.root,
    LAYOUT_FILES.map((file) => `${appDirectory}/${file}`),
  );
  if (layoutPaths.length === 0) {
    throw new GeneratorConflictError(
      "The App Router root layout was not found",
      [`Create ${appDirectory}/layout.tsx, then run authowl init again.`],
    );
  }
  if (layoutPaths.length > 1) {
    throw new GeneratorConflictError(
      "Multiple App Router root layouts were found",
      [
        `Keep one recognized root layout in ${appDirectory}, then run authowl init again.`,
      ],
    );
  }
  const layoutPath = layoutPaths[0]!;
  const middleware = await firstExisting(detection.root, [...MIDDLEWARE_FILES]);
  if (middleware) {
    throw new GeneratorConflictError(
      "Existing middleware requires a manual merge",
      [
        `Keep ${middleware} and compose createAuthRedirectMiddleware from @authowl/next/middleware manually.`,
      ],
    );
  }

  const layout = await readFile(join(detection.root, layoutPath), "utf8");
  const envPath = ".env.local";
  const env = await readOptionalText(join(detection.root, envPath));
  if (/^AUTHOWL_(?:PUBLISHABLE_KEY|API_URL)\s*=/m.test(env)) {
    throw new GeneratorConflictError(
      "AuthOwl environment values already exist",
      [
        "AuthOwl never overwrites an existing environment value. Reconcile .env.local manually.",
      ],
    );
  }

  const generatedExtension = detection.typescript ? "tsx" : "jsx";
  const middlewareExtension = detection.typescript ? "ts" : "js";
  const signInPath = `${appDirectory}/sign-in/[[...sign-in]]/page.${generatedExtension}`;
  const signIn = signInPage();
  const existingSignInPaths = await existingPaths(
    detection.root,
    ["tsx", "jsx", "ts", "js"].map(
      (extension) => `${appDirectory}/sign-in/[[...sign-in]]/page.${extension}`,
    ),
  );
  if (existingSignInPaths.length > 1) {
    throw new GeneratorConflictError(
      "Multiple sign-in route files were found",
      [
        `Keep one page file under ${appDirectory}/sign-in/[[...sign-in]], then run authowl init again.`,
      ],
    );
  }
  const existingSignInPath = existingSignInPaths[0] ?? null;
  const existingSignIn = existingSignInPath
    ? await readFile(join(detection.root, existingSignInPath), "utf8")
    : "";
  if (
    existingSignInPath &&
    (existingSignInPath !== signInPath || existingSignIn !== signIn)
  ) {
    throw new GeneratorConflictError(
      "The generated sign-in route already exists with other code",
      [
        `Keep ${existingSignInPath} and render <SignIn /> from @authowl/react there manually.`,
      ],
    );
  }

  const writes: PlannedWrite[] = [
    {
      relativePath: layoutPath,
      content: wrapRootLayout(layout, layoutPath),
    },
    {
      relativePath: envPath,
      content: appendEnvironment(env, [
        ["AUTHOWL_PUBLISHABLE_KEY", input.publishableKey],
        ["AUTHOWL_API_URL", input.apiUrl],
      ]),
      mode: 0o600,
      sensitiveAppend: true,
    },
    {
      relativePath: signInPath,
      content: signIn,
    },
    {
      relativePath:
        detection.sourceRoot === "src"
          ? `src/middleware.${middlewareExtension}`
          : `middleware.${middlewareExtension}`,
      content: middlewareFile(detection.typescript),
    },
  ];

  return writes.filter((write) => {
    if (
      write.relativePath === signInPath &&
      existingSignInPath === signInPath &&
      existingSignIn === signIn
    ) {
      return false;
    }
    return true;
  });
}

export function wrapRootLayout(source: string, path = "layout.tsx"): string {
  if (
    /^[\s\S]*["']use client["'];?/m.test(source.split(/\bimport\b/, 1)[0] ?? "")
  ) {
    throw new GeneratorConflictError(
      "A client root layout cannot safely read server environment values",
      [
        `Move the client-only logic in ${path} into a child component, then run authowl init again.`,
      ],
    );
  }
  if (/\bAuthOwlProvider\b/.test(source)) {
    throw new GeneratorConflictError(
      "AuthOwlProvider is already present in the root layout",
      [
        `Review ${path} and .env.local instead of generating a second provider.`,
      ],
    );
  }
  const matches = [...source.matchAll(/^(\s*)\{children\}\s*$/gm)];
  if (matches.length !== 1) {
    throw new GeneratorConflictError(
      "The root layout children anchor is ambiguous",
      [
        `Wrap the single {children} slot in ${path} with AuthOwlProvider manually.`,
      ],
    );
  }
  const indent = matches[0]![1] ?? "";
  const assertion = /\.tsx?$/.test(path) ? "!" : "";
  const wrapped = [
    `${indent}<AuthOwlProvider`,
    `${indent}  publishableKey={process.env.AUTHOWL_PUBLISHABLE_KEY${assertion}}`,
    `${indent}  apiUrl={process.env.AUTHOWL_API_URL${assertion}}`,
    `${indent}>`,
    `${indent}  {children}`,
    `${indent}</AuthOwlProvider>`,
  ].join("\n");
  const withProvider = source.replace(matches[0]![0], wrapped);
  const directive =
    /^(?:\s*["'][^"']+["'];?\s*)*/.exec(withProvider)?.[0] ?? "";
  const imports = [
    `import { AuthOwlProvider } from "@authowl/react";`,
    `import "@authowl/react/styles.css";`,
    "",
  ].join("\n");
  return `${directive}${imports}${withProvider.slice(directive.length)}`;
}

function signInPage(): string {
  return `'use client';\n\nimport { SignIn } from "@authowl/react";\n\nexport default function AuthOwlSignInPage() {\n  return <SignIn />;\n}\n`;
}

function middlewareFile(typescript: boolean): string {
  const assertion = typescript ? "!" : "";
  return `import { createAuthRedirectMiddleware } from "@authowl/next/middleware";\n\nexport default createAuthRedirectMiddleware({\n  publishableKey: process.env.AUTHOWL_PUBLISHABLE_KEY${assertion},\n  loginPath: "/sign-in",\n});\n`;
}
