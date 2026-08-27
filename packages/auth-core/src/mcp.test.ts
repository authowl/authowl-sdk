import { describe, expect, it } from 'vitest';
import {
  mcpProtectedResourceMetadata,
  mcpProtectedResourceMetadataUrl,
  mcpUnauthorizedChallenge,
} from './mcp';

const issuer = 'https://auth.example.com/api/projects/p1/auth';

/**
 * RFC 9728 §3 inserts the well-known suffix between the host and the resource's
 * path - the same construction RFC 8414 uses, and NOT the OpenID-style append.
 * Getting it wrong is silent: the document exists, the client looks elsewhere,
 * and the agent only reports that it could not authenticate.
 */
describe('where a client looks for the metadata', () => {
  it.each([
    ['a bare origin', 'https://mcp.example.com', 'https://mcp.example.com/.well-known/oauth-protected-resource'],
    ['a path', 'https://mcp.example.com/mcp', 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'],
    ['a deeper path', 'https://mcp.example.com/server/mcp', 'https://mcp.example.com/.well-known/oauth-protected-resource/server/mcp'],
    ['a port', 'https://mcp.example.com:8443/mcp', 'https://mcp.example.com:8443/.well-known/oauth-protected-resource/mcp'],
  ])('inserts rather than appends, for %s', (_label, resource, expected) => {
    expect(mcpProtectedResourceMetadataUrl(resource)).toBe(expected);
  });

  it('never produces the OpenID-style appended form', () => {
    // The failure this whole function exists to avoid.
    const url = mcpProtectedResourceMetadataUrl('https://mcp.example.com/mcp');
    expect(url).not.toBe('https://mcp.example.com/mcp/.well-known/oauth-protected-resource');
    expect(url.endsWith('/.well-known/oauth-protected-resource')).toBe(false);
  });

  it('drops a terminating slash rather than leaving an empty segment', () => {
    expect(mcpProtectedResourceMetadataUrl('https://mcp.example.com/')).toBe(
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    );
  });
});

describe('the metadata document', () => {
  it('names the resource and who issues tokens for it', () => {
    expect(
      mcpProtectedResourceMetadata({
        resource: 'https://mcp.example.com/mcp',
        authorizationServers: [issuer],
      }),
    ).toEqual({
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    });
  });

  /**
   * `authorization_servers` is optional in RFC 9728 and mandatory under MCP,
   * because it is how a client finds the token issuer. An MCP server without
   * one is a server no agent can use, so this refuses rather than emitting a
   * document that looks valid and leads nowhere.
   */
  it('refuses a document no agent could act on', () => {
    expect(() =>
      mcpProtectedResourceMetadata({
        resource: 'https://mcp.example.com/mcp',
        authorizationServers: [],
      }),
    ).toThrow(/at least one authorization server/);
  });

  it('carries the optional fields only when given', () => {
    const full = mcpProtectedResourceMetadata({
      resource: 'https://mcp.example.com/mcp',
      authorizationServers: [issuer],
      scopesSupported: ['openid'],
      resourceName: 'Acme MCP',
    });
    expect(full.scopes_supported).toEqual(['openid']);
    expect(full.resource_name).toBe('Acme MCP');
  });
});

describe('the 401 that starts a connection', () => {
  it('points at the metadata, which is the whole point of the header', () => {
    expect(mcpUnauthorizedChallenge({ resource: 'https://mcp.example.com/mcp' })).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('says a token was rejected, when one was', () => {
    const header = mcpUnauthorizedChallenge({
      resource: 'https://mcp.example.com/mcp',
      error: 'invalid_token',
      errorDescription: 'Issued for another resource',
    });
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('error_description="Issued for another resource"');
  });

  /**
   * A description is a courtesy. It is not worth letting a value that reached it
   * from a token or a request end the quoted string early and append a header
   * of its own.
   */
  it('cannot be used to inject a second header', () => {
    const header = mcpUnauthorizedChallenge({
      resource: 'https://mcp.example.com/mcp',
      error: 'invalid_token',
      errorDescription: 'bad"\r\nX-Injected: yes',
    });
    // The guarantee is that the header cannot be SPLIT and its quoting cannot
    // be broken - not that the text is scrubbed of anything alarming-looking.
    // Residual characters inside a quoted string are inert.
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header.split('\n')).toHaveLength(1);
    expect(header.match(/"/g)?.length).toBe(6);
    // Exactly three quoted values, each opened and closed.
    expect(header.match(/=\"[^\"]*\"/g)).toHaveLength(3);
  });
});
