import { spawn, type ChildProcessByStdio } from "node:child_process";
import { basename } from "node:path";
import type { Readable } from "node:stream";

export type TrackedChild = ChildProcessByStdio<null, Readable, Readable>;
export type CapturedProcess = ReturnType<typeof capture>;

const children = new Set<TrackedChild>();

export function cleanupChildren(): void {
  for (const child of children) child.kill("SIGTERM");
}

export function trackedSpawn(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): TrackedChild {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

export function capture(child: TrackedChild) {
  let value = "";
  const listeners = new Set<() => void>();
  const append = (chunk: Buffer) => {
    value += chunk.toString("utf8");
    for (const listener of listeners) listener();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const safe = () => redact(value);
  return {
    text: () => value,
    safe,
    waitFor(pattern: RegExp, timeoutMs: number): Promise<RegExpMatchArray> {
      return new Promise((resolvePromise, reject) => {
        const inspect = () => {
          const match = value.match(pattern);
          if (match) finish(() => resolvePromise(match));
        };
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(new Error(`Timed out waiting for ${pattern}\n${safe()}`)),
            ),
          timeoutMs,
        );
        const exited = () =>
          finish(() =>
            reject(new Error(`Process exited before ${pattern}\n${safe()}`)),
          );
        const finish = (complete: () => void) => {
          clearTimeout(timer);
          listeners.delete(inspect);
          child.off("exit", exited);
          complete();
        };
        listeners.add(inspect);
        child.once("exit", exited);
        inspect();
      });
    },
    exit(timeoutMs: number): Promise<number | null> {
      if (child.exitCode !== null) return Promise.resolve(child.exitCode);
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Process did not exit\n${safe()}`));
        }, timeoutMs);
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolvePromise(code);
        });
      });
    },
  };
}

export async function checked(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const child = trackedSpawn(command, args, { cwd });
  const output = capture(child);
  const code = await output.exit(180_000);
  if (code !== 0) {
    throw new Error(
      `${basename(command)} ${args.join(" ")} failed in ${basename(cwd)}\n${output.safe()}`,
    );
  }
}

export async function executablePath(
  command: string,
  cwd: string,
): Promise<string> {
  const child = trackedSpawn("which", [command], { cwd });
  const output = capture(child);
  if ((await output.exit(10_000)) !== 0) {
    throw new Error(`${command} is unavailable`);
  }
  return output.text().trim();
}

export async function waitForHttp(
  url: string,
  timeoutMs: number,
  output: CapturedProcess,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Application did not serve ${url}\n${output.safe()}`);
}

export function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toLowerCase().startsWith("npm_config_"),
    ),
  );
}

export function redact(value: string): string {
  return value
    .replaceAll(/aoc_[A-Za-z0-9_-]{12,}/g, "[cli-token]")
    .replaceAll(/pk_(?:live|test)_[A-Za-z0-9_-]{12,}/g, "[publishable-key]")
    .replaceAll(/sk_(?:live|test)_[A-Za-z0-9_-]{12,}/g, "[secret-key]")
    .replaceAll(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/g, "[device-code]");
}
