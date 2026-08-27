/**
 * What an MCP server owes a client, so it can be authenticated by AuthOwl.
 *
 * An MCP server is a RESOURCE server, not an authorization server. AuthOwl
 * issues the tokens; these three things are the resource server's own side of
 * the protocol, and without them an agent cannot begin - it has no way to find
 * out who issues tokens for you.
 *
 * All pure. Nothing here talks to AuthOwl or reads a token; verification is
 * `verifyProjectToken`, which already checks the audience.
 */

/** RFC 9728 §3. */
const WELL_KNOWN_SUFFIX = '/.well-known/oauth-protected-resource';

export type McpProtectedResourceMetadata = Readonly<{
  resource: string;
  authorization_servers: readonly string[];
  scopes_supported?: readonly string[];
  resource_name?: string;
  bearer_methods_supported?: readonly string[];
}>;

/**
 * Where a client will look for your metadata.
 *
 * RFC 9728 §3 inserts the well-known suffix between the host and the resource's
 * path - the same construction RFC 8414 uses for an authorization server, and
 * NOT the OpenID-style append. A resource at `https://mcp.example.com/mcp`
 * publishes at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`.
 *
 * Getting this wrong is silent: the document exists, the client looks elsewhere,
 * and the agent reports only that it could not authenticate.
 */
export function mcpProtectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  // A terminating slash on the host is removed before inserting, so a bare
  // origin publishes at the suffix alone rather than at `.../` with an empty
  // segment after it.
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}${WELL_KNOWN_SUFFIX}${path}${url.search}`;
}

/**
 * The metadata document to serve at that URL.
 *
 * `resource` is the only field RFC 9728 requires. `authorization_servers` is
 * optional there and MANDATORY under MCP - a client uses it to find who issues
 * tokens - so it is required here rather than optional, because an MCP server
 * that omits it is one no agent can use.
 */
export function mcpProtectedResourceMetadata(input: {
  /** Your canonical resource URI - the same string clients send as `resource`. */
  resource: string;
  /** Your AuthOwl issuer: `<authHost>/api/projects/<projectId>/auth`. */
  authorizationServers: readonly string[];
  scopesSupported?: readonly string[];
  resourceName?: string;
}): McpProtectedResourceMetadata {
  if (input.authorizationServers.length === 0) {
    throw new Error(
      'An MCP server must name at least one authorization server, or no client can authenticate to it.',
    );
  }
  return Object.freeze({
    resource: input.resource,
    authorization_servers: Object.freeze([...input.authorizationServers]),
    // Declared because a client should not have to guess how to present a
    // token, and AuthOwl issues bearer tokens for the Authorization header.
    bearer_methods_supported: Object.freeze(['header'] as const),
    ...(input.scopesSupported ? { scopes_supported: Object.freeze([...input.scopesSupported]) } : {}),
    ...(input.resourceName ? { resource_name: input.resourceName } : {}),
  });
}

/**
 * The `WWW-Authenticate` value for a 401 from your MCP server.
 *
 * This header is where an agent's whole discovery starts: it names the metadata
 * URL, which names the authorization server, which is how the client learns
 * where to get a token. A 401 without it leaves the agent with nowhere to go,
 * and MCP requires it for that reason.
 *
 * Pass `error` when a token WAS presented and rejected - `invalid_token` for one
 * that is expired, malformed, or issued for another resource. Omit it for a
 * request that carried no token at all, which is not an error so much as a
 * conversation starting.
 */
export function mcpUnauthorizedChallenge(input: {
  resource: string;
  error?: 'invalid_token' | 'insufficient_scope';
  errorDescription?: string;
}): string {
  const parts = [`resource_metadata="${mcpProtectedResourceMetadataUrl(input.resource)}"`];
  if (input.error) parts.push(`error="${input.error}"`);
  if (input.errorDescription) {
    // Quoted-string, so anything that would end the quote early is dropped
    // rather than escaped - a description is a courtesy and not worth a header
    // injection.
    parts.push(`error_description="${input.errorDescription.replace(/["\\\r\n]/g, '')}"`);
  }
  return `Bearer ${parts.join(', ')}`;
}
