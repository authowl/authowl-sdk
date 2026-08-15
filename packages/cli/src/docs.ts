import { openBrowser } from "./open-browser";

export const AUTHOWL_DOCS_URL = "https://authowl.dev";

export type DocsDependencies = {
  openBrowser?: (url: string) => Promise<boolean>;
};

export async function runDocsCommand(
  noOpen: boolean,
  dependencies: DocsDependencies = {},
): Promise<string> {
  if (noOpen) return `AuthOwl docs: ${AUTHOWL_DOCS_URL}`;
  const opened = await (dependencies.openBrowser ?? openBrowser)(
    AUTHOWL_DOCS_URL,
  );
  return opened
    ? `Opened AuthOwl docs: ${AUTHOWL_DOCS_URL}`
    : `Could not open a browser. AuthOwl docs: ${AUTHOWL_DOCS_URL}`;
}
