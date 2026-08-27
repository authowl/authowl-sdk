// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const privacy = vi.hoisted(() => ({
  listConsentPreferences: vi.fn(),
  listRightsRequests: vi.fn(),
  recordConsent: vi.fn(),
  createRightsRequest: vi.fn(),
}));

vi.mock('../provider', () => ({
  useAuthOwlClient: () => ({ privacy }),
  useAuthOwlLocale: () => 'en',
  usePublicConfig: () => ({
    data: {
      privacy: {
        notices: [{
          noticeVersionId: 'notice_version_1',
          title: { en: 'Privacy notice', ar: 'إشعار الخصوصية' },
          body: { en: 'Notice body', ar: 'نص الإشعار' },
          purposeCodes: ['research'],
        }],
        consentPurposes: [{
          purposeVersionId: 'purpose_version_1',
          code: 'research',
          title: { en: 'Optional research', ar: 'أبحاث اختيارية' },
          description: { en: 'Help improve the app.', ar: 'المساعدة في تحسين التطبيق.' },
        }],
      },
    },
    isLoading: false,
  }),
  useSession: () => ({
    data: { user: { id: 'user_1' }, session: { id: 'session_1' } },
    error: null,
    isPending: false,
  }),
}));

import { PrivacyCenter } from './PrivacyCenter';

afterEach(cleanup);

describe('<PrivacyCenter />', () => {
  beforeEach(() => {
    for (const method of Object.values(privacy)) method.mockReset();
    privacy.listConsentPreferences.mockResolvedValue({
      data: {
        preferences: [{
          purposeId: 'purpose_1',
          purposeVersionId: 'purpose_version_1',
          code: 'research',
          state: 'granted',
          updatedAt: new Date('2026-08-27T10:00:00.000Z'),
          decidedAt: new Date('2026-08-27T10:00:00.000Z'),
        }],
      },
      error: null,
    });
    privacy.listRightsRequests.mockResolvedValue({
      data: {
        requests: [{
          id: 'request_1',
          rightType: 'access',
          state: 'received',
          locale: 'en',
          receivedAt: new Date('2026-08-27T10:00:00.000Z'),
          acknowledgedAt: null,
          fulfilmentDeadline: new Date('2026-09-27T10:00:00.000Z'),
          completedAt: null,
        }],
      },
      error: null,
    });
    privacy.recordConsent.mockResolvedValue({
      data: { recorded: true, decision: 'withdrawn', decidedAt: new Date() },
      error: null,
    });
    privacy.createRightsRequest.mockResolvedValue({
      data: { request: { id: 'request_2' } },
      error: null,
    });
  });

  it('loads choices and records an exact-version withdrawal', async () => {
    render(<PrivacyCenter />);

    await waitFor(() => expect(screen.getByText('Optional research')).toBeTruthy());
    const toggle = screen.getByTestId('authowl-privacy-purpose-research');
    fireEvent.click(toggle);

    await waitFor(() => expect(privacy.recordConsent).toHaveBeenCalledWith({
      purposeCode: 'research',
      purposeVersionId: 'purpose_version_1',
      noticeVersionId: 'notice_version_1',
      decision: 'withdrawn',
      locale: 'en',
    }));
  });

  it('renders request history and submits the selected right', async () => {
    render(<PrivacyCenter />);

    await waitFor(() => expect(screen.getByText('Received')).toBeTruthy());
    fireEvent.click(screen.getByTestId('authowl-privacy-right-erasure'));

    await waitFor(() => expect(privacy.createRightsRequest).toHaveBeenCalledWith({
      rightType: 'erasure',
      locale: 'en',
    }));
  });
});
