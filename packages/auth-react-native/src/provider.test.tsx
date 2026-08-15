// @vitest-environment jsdom

import { render } from '@testing-library/react';
import type { NativeAuthClient } from '@authowl/core/native';
import { describe, expect, it, vi } from 'vitest';

import { AuthOwlProvider } from './provider';
import { MemoryStorage } from './storage';

const { createAuthOwlNative } = vi.hoisted(() => ({
  createAuthOwlNative: vi.fn(),
}));

vi.mock('./client', () => ({ createAuthOwlNative }));

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';

describe('AuthOwlProvider configuration', () => {
  it('rebuilds when the injected transport or mutation callback changes', () => {
    const storage = new MemoryStorage();
    const fetchA = vi.fn() as unknown as typeof fetch;
    const fetchB = vi.fn() as unknown as typeof fetch;
    const mutationA = vi.fn();
    const mutationB = vi.fn();
    createAuthOwlNative.mockReturnValue({
      client: {} as NativeAuthClient,
      projectId: '11111111-1111-1111-1111-111111111111',
      getPublicConfig: vi.fn().mockResolvedValue(null),
    });

    const view = render(
      <AuthOwlProvider
        publishableKey={PK}
        apiUrl="https://auth.example.test"
        storage={storage}
        fetchImpl={fetchA}
        onSessionMutation={mutationA}
      />,
    );

    expect(createAuthOwlNative).toHaveBeenCalledTimes(1);
    view.rerender(
      <AuthOwlProvider
        publishableKey={PK}
        apiUrl="https://auth.example.test"
        storage={storage}
        fetchImpl={fetchB}
        onSessionMutation={mutationA}
      />,
    );
    expect(createAuthOwlNative).toHaveBeenCalledTimes(2);
    expect(createAuthOwlNative).toHaveBeenLastCalledWith(expect.objectContaining({
      fetchImpl: fetchB,
      onSessionMutation: mutationA,
    }));

    view.rerender(
      <AuthOwlProvider
        publishableKey={PK}
        apiUrl="https://auth.example.test"
        storage={storage}
        fetchImpl={fetchB}
        onSessionMutation={mutationB}
      />,
    );
    expect(createAuthOwlNative).toHaveBeenCalledTimes(3);
    expect(createAuthOwlNative).toHaveBeenLastCalledWith(expect.objectContaining({
      fetchImpl: fetchB,
      onSessionMutation: mutationB,
    }));
  });
});
