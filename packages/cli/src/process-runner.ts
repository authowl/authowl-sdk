import { spawn } from "node:child_process";

export type ProcessResult = { code: number; stdout: string; stderr: string };
export type ProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal },
) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      signal: options.signal,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
