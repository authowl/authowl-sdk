export const CLI_SCOPES = [
  "projects:read",
  "projects:create",
  "keys:publishable:issue",
] as const;

export type CliScope = (typeof CLI_SCOPES)[number];
