import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "../src/api-url";
import { browserLaunch } from "../src/open-browser";

describe("CLI endpoint and browser launch safety", () => {
  it.each([
    ["https://authowl.dev/", "https://authowl.dev"],
    ["http://localhost:3010/path", "http://localhost:3010"],
    ["http://127.0.0.1:3010", "http://127.0.0.1:3010"],
  ])("normalizes %s", (input, expected) => {
    expect(resolveApiUrl(input)).toBe(expected);
  });

  it.each([
    "http://authowl.dev",
    "https://user:password@authowl.dev",
    "https://authowl.dev?redirect=https://attacker.example",
  ])("rejects unsafe API URL %s", (input) => {
    expect(() => resolveApiUrl(input)).toThrow();
  });

  it("does not reflect an invalid URL into terminal-facing errors", () => {
    const input = "\u001B[31mattacker-controlled";
    expect(() => resolveApiUrl(input)).toThrow("Invalid AuthOwl API URL");
    try {
      resolveApiUrl(input);
    } catch (error) {
      expect(String(error)).not.toContain(input);
    }
  });

  it("passes browser URLs as arguments without a shell", () => {
    const url = "https://authowl.dev/cli-auth?code=ABCD-2345&next=value";
    expect(browserLaunch(url, "darwin")).toEqual({
      command: "open",
      args: [url],
    });
    expect(browserLaunch(url, "linux")).toEqual({
      command: "xdg-open",
      args: [url],
    });
    expect(browserLaunch(url, "win32")).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    });
  });
});
