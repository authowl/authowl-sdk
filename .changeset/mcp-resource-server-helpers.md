---
'@authowl/core': minor
---

**Helpers for serving an MCP server's own side of the protocol.**

An MCP server is a *resource* server: AuthOwl issues the tokens, but the
protected-resource metadata and the `401` that points at it are yours to serve,
and without them an agent has no way to discover who issues tokens for you.

```ts
import {
  mcpProtectedResourceMetadata,
  mcpProtectedResourceMetadataUrl,
  mcpUnauthorizedChallenge,
} from '@authowl/core/server';
```

`mcpProtectedResourceMetadataUrl()` is the one worth reading twice. RFC 9728
**inserts** the well-known suffix between the host and your resource's path
rather than appending it — so `https://mcp.example.com/mcp` publishes at
`https://mcp.example.com/.well-known/oauth-protected-resource/mcp`. Getting that
wrong fails silently: your document exists, the client looks elsewhere, and the
agent reports only that it could not authenticate.

`mcpUnauthorizedChallenge()` builds the `WWW-Authenticate` value. Pass `error`
when a token was presented and rejected; omit it when none was sent.

Audience validation is already `verifyProjectToken` — pass your resource URI as
`audience` instead of the project id.
