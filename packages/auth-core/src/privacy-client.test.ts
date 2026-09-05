import { describe, expect, it, vi } from 'vitest';
import { createAuthOwlClient } from './client';
import { resolveConfig } from './config';
import { PRIVACY_RIGHT_TYPES, offeredRightTypes } from './privacy-client';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PK = `pk_live_${PROJECT_ID}_abcdefghij0123456789`;
const PURPOSE_ID = '22222222-2222-4222-8222-222222222222';
const PURPOSE_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const NOTICE_VERSION_ID = '44444444-4444-4444-8444-444444444444';

function clientWith(fetchImpl: typeof fetch) {
  return createAuthOwlClient(resolveConfig({
    publishableKey: PK,
    apiUrl: 'https://auth.example.test',
    fetch: fetchImpl,
  }));
}

describe('privacy client', () => {
  it('uses the authenticated project privacy routes and decodes dates', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/privacy/consent-decisions') && init?.method === 'POST') {
        return Response.json({
          recorded: true,
          decision: 'granted',
          decidedAt: '2026-08-27T10:00:00.000Z',
        });
      }
      if (url.endsWith('/privacy/consent-decisions')) {
        return Response.json({ preferences: [{
          purposeId: PURPOSE_ID,
          purposeVersionId: PURPOSE_VERSION_ID,
          code: 'product_research',
          state: null,
          updatedAt: null,
          decidedAt: null,
        }] });
      }
      const request = {
        id: '55555555-5555-4555-8555-555555555555',
        rightType: 'access',
        state: 'in_progress',
        locale: 'en',
        receivedAt: '2026-08-27T10:00:00.000Z',
        acknowledgedAt: '2026-08-27T10:00:00.000Z',
        fulfilmentDeadline: '2026-09-27T10:00:00.000Z',
        completedAt: null,
      };
      return Response.json(init?.method === 'POST' ? { request } : { requests: [request] });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const privacy = clientWith(fetchImpl).privacy;

    await expect(privacy.listConsentPreferences()).resolves.toMatchObject({
      data: { preferences: [{ code: 'product_research', state: null }] },
      error: null,
    });
    const recorded = await privacy.recordConsent({
      purposeCode: 'product_research',
      purposeVersionId: PURPOSE_VERSION_ID,
      noticeVersionId: NOTICE_VERSION_ID,
      decision: 'granted',
      locale: 'en',
    });
    expect(recorded.data?.decidedAt).toBeInstanceOf(Date);
    const listed = await privacy.listRightsRequests();
    expect(listed.data?.requests[0]?.receivedAt).toBeInstanceOf(Date);
    await expect(privacy.createRightsRequest({ rightType: 'access', locale: 'en' }))
      .resolves.toMatchObject({ data: { request: { state: 'in_progress' } }, error: null });

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe('include');
      expect(new Headers(init?.headers).get('x-publishable-key')).toBe(PK);
    }
    const consentBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      correlationId: string;
    };
    expect(consentBody.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails closed on malformed privacy data', async () => {
    const fetchImpl = vi.fn(
      async () => Response.json({ preferences: [{ state: 'yes' }] }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).privacy.listConsentPreferences()).resolves.toMatchObject({
      data: null,
      error: { status: 0 },
    });
  });
});

describe('offeredRightTypes', () => {
  it('offers everything when the server cannot report availability', () => {
    // The compatibility rule the whole feature rests on. Reading `undefined` as
    // "none" would blank the privacy tab of every app on an older deployment.
    expect(offeredRightTypes(undefined)).toEqual([...PRIVACY_RIGHT_TYPES]);
  });

  it('offers nothing when the project accepts none', () => {
    // Different from undefined, and the state that produced the live report:
    // an unapproved compliance profile refuses every right.
    expect(offeredRightTypes([])).toEqual([]);
  });

  it('offers exactly what is advertised, in the canonical order', () => {
    expect(offeredRightTypes(['portability', 'access'])).toEqual(['access', 'portability']);
  });

  it('ignores a right this build has no button for', () => {
    // The server's set can grow. An unknown entry must not crash a published
    // SDK, and must not smuggle a right this build cannot render.
    expect(offeredRightTypes(['access', 'telepathy'])).toEqual(['access']);
  });

  it('is unmoved by duplicates', () => {
    expect(offeredRightTypes(['access', 'access'])).toEqual(['access']);
  });
});
