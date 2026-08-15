import { resolveAuthTarget, type AuthConfig } from '@authowl/core/server';

export type ServerAuthConfig = Readonly<{
  publishableKey: string;
  apiUrl: string;
  projectId: string;
}>;

function serverConfig(config: AuthConfig): ServerAuthConfig {
  const resolved = resolveAuthTarget(config);
  return {
    publishableKey: resolved.publishableKey,
    apiUrl: resolved.apiUrl,
    projectId: resolved.decoded.projectId,
  };
}

let cachedConfig: ServerAuthConfig | null = null;

export function initAuthConfig(config: AuthConfig): void {
  cachedConfig = serverConfig(config);
}

export function getAuthConfig(): ServerAuthConfig {
  if (cachedConfig) return cachedConfig;

  const publishableKey = process.env.AUTHOWL_PUBLISHABLE_KEY;
  const apiUrl = process.env.AUTHOWL_API_URL;
  if (publishableKey && apiUrl) {
    cachedConfig = serverConfig({ publishableKey, apiUrl });
    return cachedConfig;
  }

  throw new Error(
    'AuthOwl is not configured. Set AUTHOWL_PUBLISHABLE_KEY and AUTHOWL_API_URL, or call initAuth({ publishableKey, apiUrl }).',
  );
}

export function resolveAuthConfig(config?: AuthConfig): ServerAuthConfig {
  if (!config) return getAuthConfig();
  return serverConfig(config);
}
