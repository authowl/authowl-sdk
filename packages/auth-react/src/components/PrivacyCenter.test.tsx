// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listConsentPreferences: vi.fn(async () => ({
    data: { preferences: [{
      purposeId: '33333333-3333-4333-8333-333333333333',
      purposeVersionId: '44444444-4444-4444-8444-444444444444',
      code: 'research',
      state: 'granted',
      updatedAt: new Date('2026-08-27T10:00:00.000Z'),
      decidedAt: new Date('2026-08-27T10:00:00.000Z'),
    }] },
    error: null,
  })),
  listRightsRequests: vi.fn(async () => ({ data: { requests: [] }, error: null })),
  recordConsent: vi.fn(async () => ({
    data: { recorded: true, decision: 'withdrawn', decidedAt: new Date() },
    error: null,
  })),
  createRightsRequest: vi.fn(async () => ({ data: { request: {} }, error: null })),
  t: (key: string) => key,
  toServerError: (_error: unknown, fallback: string) => fallback,
}));

const privacy = {
  notices: [{
    noticeId: '11111111-1111-4111-8111-111111111111',
    noticeVersionId: '22222222-2222-4222-8222-222222222222',
    code: 'privacy_notice',
    version: 1,
    title: { en: 'Privacy notice', ar: 'إشعار الخصوصية' },
    body: { en: 'Notice body', ar: 'نص الإشعار' },
    digest: { en: 'a'.repeat(64), ar: 'b'.repeat(64) },
    activityCodes: ['research'],
    purposeCodes: ['research'],
    effectiveFrom: '2026-08-27T10:00:00.000Z',
  }],
  consentPurposes: [{
    purposeId: '33333333-3333-4333-8333-333333333333',
    purposeVersionId: '44444444-4444-4444-8444-444444444444',
    code: 'research',
    version: 1,
    title: { en: 'Product research', ar: 'أبحاث المنتج' },
    description: { en: 'Optional research', ar: 'أبحاث اختيارية' },
    digest: { en: 'c'.repeat(64), ar: 'd'.repeat(64) },
    activityCodes: ['research'],
    dataCategories: ['usage'],
  }],
};

vi.mock('../hooks', () => {
  const client = { privacy: mocks };
  return {
    useAuthClient: () => client,
    usePublicConfig: () => ({ config: { privacy } }),
    useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: 'user-1' } }),
  };
});
vi.mock('../i18n', () => ({
  useLocale: () => 'en',
  useServerError: () => mocks.toServerError,
  useT: () => mocks.t,
}));

import { PrivacyCenter } from './PrivacyCenter';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PrivacyCenter', () => {
  it('withdraws a granted purpose against the exact current notice', async () => {
    render(<PrivacyCenter />);
    const toggle = await screen.findByRole('switch', { name: 'Product research' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.recordConsent).toHaveBeenCalledWith({
      purposeCode: 'research',
      purposeVersionId: '44444444-4444-4444-8444-444444444444',
      noticeVersionId: '22222222-2222-4222-8222-222222222222',
      decision: 'withdrawn',
      locale: 'en',
    }));
  });

  it('submits an authenticated rights request and refreshes history', async () => {
    render(<PrivacyCenter />);
    const access = await screen.findByRole('button', { name: 'privacy.right.access' });
    fireEvent.click(access);
    await waitFor(() => expect(mocks.createRightsRequest).toHaveBeenCalledWith({
      rightType: 'access',
      locale: 'en',
    }));
    expect(mocks.listRightsRequests).toHaveBeenCalledTimes(2);
  });
});
