import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";

export async function atomicWrite(
  path: string,
  content: Buffer,
  mode: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temporary = join(
    dirname(path),
    `.authowl-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporary, content, { flag: "wx", mode });
    await rename(temporary, path);
    await chmod(path, mode).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function safeRelativePath(input: string): string {
  const portable = input.replaceAll("\\", "/");
  const segments = portable.split("/");
  if (
    segments.some((segment) => segment === ".." || segment === ".") ||
    /^[A-Za-z]:\//.test(portable)
  ) {
    throw new Error(`Unsafe generated path: ${input}`);
  }
  const value = normalize(portable).replaceAll("\\", "/");
  if (
    !value ||
    value === "." ||
    value.startsWith("../") ||
    value.includes("/../") ||
    isAbsolute(value)
  ) {
    throw new Error(`Unsafe generated path: ${input}`);
  }
  return value;
}

export function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function optionalRegularBuffer(
  path: string,
  label: string,
): Promise<Buffer | null> {
  try {
    await assertRegularFile(path, label);
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function ensureDirectory(
  path: string,
  mode: number,
): Promise<void> {
  try {
    await assertRegularDirectory(path, "AuthOwl state directory");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await mkdir(path, { recursive: true, mode });
      return;
    }
    throw error;
  }
}

export async function assertSafeParentDirectories(
  root: string,
  relativePath: string,
): Promise<void> {
  await assertRegularDirectory(root, "application root");
  let current = root;
  for (const segment of safeRelativePath(relativePath)
    .split("/")
    .slice(0, -1)) {
    current = join(current, segment);
    try {
      await assertRegularDirectory(current, "generated path parent");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }
}

export async function assertRegularDirectory(
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing unsafe ${label}: ${path}`);
  }
}

export async function assertRegularFile(
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing unsafe ${label}: ${path}`);
  }
}

export async function removeEmptyParents(
  root: string,
  start: string,
): Promise<void> {
  let current = start;
  while (relative(root, current) && !relative(root, current).startsWith("..")) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}
