import { describe, expect, it, vi } from 'vitest';
import { createAuthOwlClient } from './client';
import { resolveConfig } from './config';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PK = `pk_test_${PROJECT_ID}_abcdefghij0123456789`;

function clientWith(fetchImpl: typeof fetch) {
  return createAuthOwlClient(resolveConfig({
    publishableKey: PK,
    apiUrl: 'https://auth.example.com',
    fetch: fetchImpl,
  }));
}

describe('account metadata client', () => {
  it('reads browser-safe metadata and normalizes the wire contract', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      public_metadata: { locale: 'ar' },
      private_metadata: { operatorNote: 'must-be-dropped' },
      unsafe_metadata: { onboarding: { step: 2 } },
      metadata_version: 3,
    })) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).account.getMetadata();

    expect(result).toEqual({
      data: {
        publicMetadata: { locale: 'ar' },
        unsafeMetadata: { onboarding: { step: 2 } },
        metadataVersion: 3,
      },
      error: null,
    });
    expect(JSON.stringify(result)).not.toContain('operatorNote');
    expect(JSON.stringify(result)).not.toContain('must-be-dropped');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(
      `/api/projects/${PROJECT_ID}/auth/user/metadata`,
    );
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
  });

  it('keeps private metadata absent from the public SDK type', () => {
    const assertPrivateMetadataAbsent = (
      metadata: Awaited<
        ReturnType<ReturnType<typeof clientWith>['account']['getMetadata']>
      >,
    ) => {
      // @ts-expect-error private metadata has no browser SDK surface.
      void metadata.data?.privateMetadata;
    };
    void assertPrivateMetadataAbsent;
  });

  it('sends an unsafe-only merge patch with the expected version', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      public_metadata: {},
      unsafe_metadata: { theme: 'warm' },
      metadata_version: 5,
    })) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).account.updateUnsafeMetadata({
      expectedVersion: 4,
      unsafeMetadata: { theme: 'warm', obsolete: null },
    });

    expect(result.data?.metadataVersion).toBe(5);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe(
      `/api/projects/${PROJECT_ID}/auth/user/metadata`,
    );
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      expected_version: 4,
      unsafe_metadata: { theme: 'warm', obsolete: null },
    });
  });

  it('surfaces a stale write without fabricating metadata', async () => {
    const fetchImpl = vi.fn(async () => Response.json(
      {
        code: 'VERSION_CONFLICT',
        detail: 'Metadata changed since it was read.',
        current_version: 9,
      },
      { status: 409 },
    )) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).account.updateUnsafeMetadata({
      expectedVersion: 8,
      unsafeMetadata: { theme: 'cool' },
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      currentVersion: 9,
      message: 'Metadata changed since it was read.',
    });
  });

  it('rejects a malformed success instead of exposing a false metadata version', async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async () => Response.json({
      public_metadata: {},
      unsafe_metadata: [],
      metadata_version: 'not-a-version',
    })) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).account.getMetadata({
      onResponse: () => order.push('response'),
      onSuccess: () => order.push('success'),
      onError: () => order.push('error'),
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      statusText: 'INVALID_RESPONSE',
      code: 'INVALID_RESPONSE',
    });
    expect(order).toEqual(['error']);
  });

  it('rejects prototype-bearing and excessively deep metadata trees', async () => {
    const prototypeBearing = JSON.parse(
      '{"__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let depth = 0; depth < 22; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        public_metadata: prototypeBearing,
        unsafe_metadata: {},
        metadata_version: 1,
      }))
      .mockResolvedValueOnce(Response.json({
        public_metadata: {},
        unsafe_metadata: deep,
        metadata_version: 1,
      }));
    const client = clientWith(fetchImpl);

    await expect(client.account.getMetadata()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
    await expect(client.account.getMetadata()).resolves.toMatchObject({
      data: null,
      error: { code: 'INVALID_RESPONSE' },
    });
  });
});
