import {
  SESSION_TRANSPORT_BEARER,
  SESSION_TRANSPORT_HEADER,
  resolveAuthTarget,
  type AuthConfig,
} from '@authowl/core/server';
import { AUTHOWL_SECRET_KEY_HEADER } from './bridge-contract';

export type AuthOwlNextServerConfig = AuthConfig & Readonly<{
  secretKey?: string;
}>;

export type ServerAuthConfig = Readonly<{
  publishableKey: string;
  apiUrl: string;
  projectId: string;
  secretKey?: string;
}>;

/** A server config that can speak for the application: the secret key is present. */
export type ConfiguredBridgeConfig = ServerAuthConfig & Readonly<{ secretKey: string }>;

export function configuredBridge(config: ServerAuthConfig): ConfiguredBridgeConfig | null {
  return config.secretKey ? { ...config, secretKey: config.secretKey } : null;
}

/**
 * The headers of a server-side session read that presents an app bridge token:
 * the paired bearer transport plus the project secret key. The key is required
 * by the type, not checked at the call site, because an unkeyed read is not a
 * weaker version of this request - the auth server judges it as a browser that
 * is not the user's and warns the user their session was used somewhere else.
 */
export function bearerSessionHeaders(
  config: ConfiguredBridgeConfig,
  token: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    [SESSION_TRANSPORT_HEADER]: SESSION_TRANSPORT_BEARER,
    [AUTHOWL_SECRET_KEY_HEADER]: config.secretKey,
  };
}

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
