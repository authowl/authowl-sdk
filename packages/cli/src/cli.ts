import { runCli } from "./run-cli";

async function main(): Promise<void> {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort(new Error("Interrupted")));
  process.exitCode = await runCli(process.argv.slice(2), {}, controller.signal);
}

void main();
