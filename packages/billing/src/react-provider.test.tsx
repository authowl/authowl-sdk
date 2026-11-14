// @vitest-environment jsdom
import { act } from 'react';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthOwlProvider } from '@authowl/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Protect, useEntitlements } from './react';
import { ALLOWED_LIST } from './test-fixtures';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const PUBLISHABLE_KEY = ['pk_test', PROJECT_ID, 'billingproviderfixture'].join('_');
const API_URL = 'https://auth.example.test';

afterEach(async () => {
  cleanup();
  await act(async () => Promise.resolve());
  vi.restoreAllMocks();
});

function Probe() {
  const { reason } = useEntitlements();
  return (
    <>
      <output>{reason ?? 'pending'}</output>
      <Protect feature="reports" fallback={<p>fallback</p>}>
        <p>children</p>
      </Protect>
    </>
  );
}

describe('billing React provider integration', () => {
  it.each([
    ['allowed', true, 'children', 'fallback'],
    ['denied', false, 'fallback', 'children'],
  ] as const)('uses the real core seam for an %s list', async (
    _name,
    allowed,
    expected,
    hidden,
  ) => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/public-config')) return Response.json(publicConfig());
      if (path.endsWith('/get-session')) return Response.json(sessionData());
      if (path.endsWith('/billing/entitlements')) {
        return Response.json(allowed
          ? ALLOWED_LIST
          : { ...ALLOWED_LIST, entitlements: [] });
      }
      return Response.json({ status: true, success: true });
    });
    render(
      <AuthOwlProvider publishableKey={PUBLISHABLE_KEY} apiUrl={API_URL} fetch={fetchImpl}>
        <Probe />
      </AuthOwlProvider>,
    );

    await screen.findByText('ok', { selector: 'output' });
    expect(screen.queryByText(expected)).not.toBeNull();
    expect(screen.queryByText(hidden)).toBeNull();
    const billingCall = fetchImpl.mock.calls.find(([input]) =>
      String(input) === `${API_URL}/api/projects/${PROJECT_ID}/billing/entitlements`);
    expect(billingCall).toBeDefined();
    expect(new Headers(billingCall?.[1]?.headers).get('x-publishable-key')).toBe(PUBLISHABLE_KEY);
  });
});

function publicConfig() {
  return {
    applicationId: '00000000-0000-4000-8000-000000000010',
    environmentId: PROJECT_ID,
    environmentType: 'development',
    authBaseUrl: `${API_URL}/api/projects/${PROJECT_ID}/auth`,
    signUp: { mode: 'open' },
    authentication: {
      email: { signUp: true, signIn: ['password'] },
      phone: { signUp: false, signIn: false },
      password: { signUp: true, add: true, minLength: 8, maxLength: 128 },
      passkey: { signIn: false, add: false },
      username: { collectOnSignUp: false, signIn: false },
    },
    emailVerification: { required: false, method: 'link' },
    userModel: {
      requireEmail: false, firstLastName: false, emailChange: true, accountDeletion: false,
    },
    mfa: { totp: false, required: false, backupCodes: false },
    branding: {},
    enabledMethods: ['password'],
    socialProviders: [],
    socialProviderClientIds: {},
    requireEmailVerification: false,
    legal: { version: 1, required: false },
    twoFactor: false,
    mfaRequired: false,
    accountDeletion: false,
    organizations: false,
    sso: false,
    jwtIssuer: null,
    captcha: null,
    turnstileSiteKey: null,
    authTurnstileSiteKey: null,
    locale: 'en',
    badge: true,
    configVersion: 1,
  };
}

function sessionData() {
  return {
    user: {
      id: 'user-provider',
      email: 'provider@example.test',
      emailVerified: true,
      name: 'Provider User',
      image: null,
      twoFactorEnabled: false,
      createdAt: '2026-11-14T08:00:00.000Z',
      updatedAt: '2026-11-14T08:00:00.000Z',
    },
    session: {
      id: 'session-provider',
      userId: 'user-provider',
      token: 'provider-session-token',
      activeOrganizationId: null,
      pendingMfaEnrollment: false,
      expiresAt: '2026-11-21T08:00:00.000Z',
    },
  };
}
