import { resolveAuthTarget, type AuthConfig } from '@authowl/core/server';

export type AuthOwlNextServerConfig = AuthConfig & Readonly<{
  secretKey?: string;
}>;

export type ServerAuthConfig = Readonly<{
  publishableKey: string;
  apiUrl: string;
  projectId: string;
  secretKey?: string;
}>;

function serverConfig(config: AuthOwlNextServerConfig): ServerAuthConfig {
  const resolved = resolveAuthTarget(config);
  const secretKey = config.secretKey ?? process.env.AUTHOWL_SECRET_KEY;
  return {
    publishableKey: resolved.publishableKey,
    apiUrl: resolved.apiUrl,
    projectId: resolved.decoded.projectId,
    ...(secretKey ? { secretKey } : {}),
  };
}

let cachedConfig: ServerAuthConfig | null = null;

export function initAuthConfig(config: AuthOwlNextServerConfig): void {
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

export function resolveAuthConfig(config?: AuthOwlNextServerConfig): ServerAuthConfig {
  if (!config) return getAuthConfig();
  return serverConfig(config);
}
