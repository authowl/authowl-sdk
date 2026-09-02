/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import {
  sessionTransportIntegration,
  withSessionTransportIntegration,
  type SessionTransportIntegration,
} from './session-integration';

describe('framework session transport integration', () => {
  it('attaches a non-enumerable integration to only the decorated fetch', () => {
    const base = vi.fn() as unknown as typeof fetch;
    const integration: SessionTransportIntegration = {
      connect: vi.fn(),
      sessionEstablished: vi.fn(async () => undefined),
      sessionEnded: vi.fn(async () => undefined),
    };

    const decorated = withSessionTransportIntegration(base, integration);

    expect(decorated).toBe(base);
    expect(sessionTransportIntegration(decorated)).toBe(integration);
    expect(Object.getOwnPropertyDescriptor(
      decorated,
      Symbol.for('authowl.session-transport-integration.v1'),
    )).toMatchObject({ enumerable: false });
    expect(sessionTransportIntegration(globalThis.fetch)).toBeNull();
  });
});
