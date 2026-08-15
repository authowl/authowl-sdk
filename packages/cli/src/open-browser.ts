import { spawn } from "node:child_process";

type Launch = {
  command: string;
  args: string[];
};

export function browserLaunch(
  url: string,
  platform = process.platform,
): Launch {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  return { command: "xdg-open", args: [url] };
}

/** Launch a URL without involving a shell on macOS/Linux. */
export async function openBrowser(url: string): Promise<boolean> {
  const launch = browserLaunch(url);
  return new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
