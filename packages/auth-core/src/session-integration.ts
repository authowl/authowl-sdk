import type { SessionStore } from './client';
import type { SessionLifecycleEvent } from './session-token';
import type { TransportFetch } from './transport';

/**
 * A framework adapter's supported view of the browser session transport.
 *
 * `authenticatedFetch` is the exact fetch owned by the resolved core client,
 * so out-of-band requests inherit the current cookie/bearer verdict and sender
 * proof. The lifecycle contains no credential or response data.
 */
export type SessionTransportConnection = Readonly<{
  authenticatedFetch: TransportFetch;
  sessionStore: SessionStore;
  subscribeLifecycle(listener: (event: SessionLifecycleEvent) => void): () => void;
}>;

export type SessionTransportIntegration = Readonly<{
  connect(connection: SessionTransportConnection): void;
  /** Project a newly established AuthOwl session before its action resolves. */
  sessionEstablished(): Promise<void>;
  /** Remove the framework-owned projection before sign-out resolves. */
  sessionEnded(): Promise<void>;
}>;

// Symbol.for keeps the handshake intact when a package manager installs a
// second physical copy of @authowl/core for a framework adapter. The value is
// held on the adapter-owned fetch, never on global fetch.
const SESSION_TRANSPORT_INTEGRATION = Symbol.for('authowl.session-transport-integration.v1');

type IntegratedFetch = typeof fetch & {
  [SESSION_TRANSPORT_INTEGRATION]?: SessionTransportIntegration;
};

/** Attach a framework integration to the fetch it asks the core client to use. */
export function withSessionTransportIntegration(
  fetchImpl: typeof fetch,
  integration: SessionTransportIntegration,
): typeof fetch {
  Object.defineProperty(fetchImpl, SESSION_TRANSPORT_INTEGRATION, {
    value: integration,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return fetchImpl;
}

/** @internal Read the adapter handshake without making its symbol public API. */
export function sessionTransportIntegration(
  fetchImpl: typeof fetch | undefined,
): SessionTransportIntegration | null {
  return fetchImpl
    ? (fetchImpl as IntegratedFetch)[SESSION_TRANSPORT_INTEGRATION] ?? null
    : null;
}
