export const DEFAULT_AUTHOWL_API_URL = "https://authowl.dev";

export function resolveApiUrl(input?: string): string {
  const value = (
    input ??
    process.env.AUTHOWL_API_URL ??
    DEFAULT_AUTHOWL_API_URL
  ).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid AuthOwl API URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "AuthOwl API URL cannot contain credentials, a query, or a fragment",
    );
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("AuthOwl API URL must use HTTPS, except on localhost");
  }
  return url.origin;
}
