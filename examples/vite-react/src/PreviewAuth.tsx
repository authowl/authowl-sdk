import React from 'react';
import { AuthOwlProvider } from '@authowl/react';

const PREVIEW_PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';

const user = {
  id: 'user-preview',
  email: 'mona@cairo-studio.example',
  emailVerified: true,
  name: 'Mona Ali',
  image: null,
  twoFactorEnabled: true,
  createdAt: '2026-07-10T08:00:00.000Z',
  updatedAt: '2026-07-14T08:00:00.000Z',
};

const session = {
  id: 'session-current',
  userId: user.id,
  token: 'preview-current-session-token',
  activeOrganizationId: 'org-cairo',
  expiresAt: '2026-07-21T08:00:00.000Z',
};

const teammate = {
  id: 'member-youssef',
  organizationId: 'org-cairo',
  userId: 'user-youssef',
  role: 'member',
  createdAt: '2026-07-11T08:00:00.000Z',
  user: { id: 'user-youssef', name: 'Youssef Ali', email: 'youssef@cairo-studio.example', image: null },
};

const owner = {
  id: 'member-mona',
  organizationId: 'org-cairo',
  userId: user.id,
  role: 'owner',
  createdAt: '2026-07-10T08:00:00.000Z',
  user: { id: user.id, name: user.name, email: user.email, image: null },
};

const invitation = {
  id: 'invitation-preview',
  organizationId: 'org-cairo',
  email: 'salma@example.test',
  role: 'member',
  status: 'pending',
  inviterId: user.id,
  expiresAt: '2026-07-21T08:00:00.000Z',
  createdAt: '2026-07-14T08:00:00.000Z',
};

const organizations = [
  { id: 'org-cairo', name: 'Cairo Studio', slug: 'cairo-studio', logo: null, metadata: null, createdAt: '2026-07-10T08:00:00.000Z' },
  { id: 'org-alex', name: 'Alexandria Labs', slug: 'alexandria-labs', logo: null, metadata: null, createdAt: '2026-07-12T08:00:00.000Z' },
];

const privacy = {
  notices: [{
    noticeId: '33333333-3333-4333-8333-333333333333',
    noticeVersionId: '44444444-4444-4444-8444-444444444444',
    code: 'service_privacy',
    version: 3,
    title: { en: 'How Cairo Studio uses your data', ar: 'كيفية استخدام استوديو القاهرة لبياناتك' },
    body: {
      en: 'We use account data to provide secure access. Product research is optional and can be withdrawn at any time.',
      ar: 'نستخدم بيانات الحساب لتوفير وصول آمن. أبحاث المنتج اختيارية ويمكن سحب الموافقة في أي وقت.',
    },
    digest: { en: 'a'.repeat(64), ar: 'b'.repeat(64) },
    activityCodes: ['tenant_authentication', 'product_research'],
    purposeCodes: ['product_research'],
    effectiveFrom: '2026-08-27T10:00:00.000Z',
  }],
  consentPurposes: [{
    purposeId: '55555555-5555-4555-8555-555555555555',
    purposeVersionId: '66666666-6666-4666-8666-666666666666',
    code: 'product_research',
    version: 2,
    title: { en: 'Product research', ar: 'أبحاث المنتج' },
    description: {
      en: 'Share pseudonymous usage patterns to improve the product.',
      ar: 'مشاركة أنماط استخدام مستعارة لتحسين المنتج.',
    },
    digest: { en: 'c'.repeat(64), ar: 'd'.repeat(64) },
    activityCodes: ['product_research'],
    dataCategories: ['usage'],
  }],
};

function createPreviewFetch(
  signedIn: boolean,
  consentRequired: boolean,
  primaryColor: string,
  configUnavailable: boolean,
  privacyEnabled: boolean,
): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path.endsWith('/public-config')) {
      if (configUnavailable) throw new TypeError('preview public config unavailable');
      return Response.json({
        applicationId: '22222222-2222-4222-8222-222222222222',
        environmentId: '11111111-1111-1111-1111-111111111111',
        environmentType: 'production',
        authBaseUrl:
          'https://auth.preview.test/api/projects/11111111-1111-1111-1111-111111111111/auth',
        branding: { appName: 'Cairo Studio', theme: 'light', primaryColor },
        enabledMethods: ['password', 'magic_link', 'passkey'],
        socialProviders: ['google', 'github'],
        socialProviderClientIds: { google: 'preview-google-client-id.apps.googleusercontent.com' },
        requireEmailVerification: true,
        legal: {
          version: consentRequired ? 7 : 1,
          required: consentRequired,
          ...(consentRequired
            ? {
                termsUrl: 'https://authowl.dev/terms',
                privacyUrl: 'https://authowl.dev/privacy',
              }
            : {}),
        },
        twoFactor: true,
        mfaRequired: true,
        accountDeletion: true,
        organizations: true,
        sso: false,
        jwtIssuer: null,
        turnstileSiteKey: null,
        authTurnstileSiteKey: null,
        locale: 'en',
        badge: false,
        configVersion: 1,
        ...(privacyEnabled ? { privacy } : {}),
      });
    }
    if (path.endsWith('/privacy/consent-decisions')) {
      return Response.json({
        preferences: [{
          purposeId: privacy.consentPurposes[0]!.purposeId,
          purposeVersionId: privacy.consentPurposes[0]!.purposeVersionId,
          code: privacy.consentPurposes[0]!.code,
          state: 'granted',
          updatedAt: '2026-08-27T10:00:00.000Z',
          decidedAt: '2026-08-27T10:00:00.000Z',
        }],
      });
    }
    if (path.endsWith('/privacy/rights')) {
      return Response.json({
        requests: [{
          id: '77777777-7777-4777-8777-777777777777',
          rightType: 'access',
          state: 'in_progress',
          locale: 'en',
          receivedAt: '2026-08-25T10:00:00.000Z',
          acknowledgedAt: '2026-08-25T11:00:00.000Z',
          fulfilmentDeadline: '2026-09-24T10:00:00.000Z',
          completedAt: null,
        }],
      });
    }
    if (path.endsWith('/get-session')) return Response.json(signedIn ? { user, session } : null);
    if (path.endsWith('/organization/list')) return Response.json(organizations);
    if (path.endsWith('/organization/get-full-organization')) {
      const id = url.searchParams.get('organizationId');
      const organization = organizations.find((candidate) => candidate.id === id) ?? organizations[0]!;
      return Response.json({ ...organization, members: [owner, teammate], invitations: [invitation] });
    }
    if (path.endsWith('/organization/list-user-invitations')) {
      return Response.json([{ ...invitation, id: 'invitation-user-preview', organizationName: 'Delta Commerce' }]);
    }
    if (path.endsWith('/list-accounts')) {
      return Response.json([
        { id: 'account-credential', userId: user.id, providerId: 'credential', accountId: user.id, scopes: [], createdAt: '2026-07-10T08:00:00.000Z', updatedAt: '2026-07-10T08:00:00.000Z' },
        { id: 'account-google', userId: user.id, providerId: 'google', accountId: 'google-preview', scopes: ['openid', 'email'], createdAt: '2026-07-10T08:00:00.000Z', updatedAt: '2026-07-10T08:00:00.000Z' },
      ]);
    }
    if (path.endsWith('/list-sessions')) {
      return Response.json([
        { ...session, createdAt: '2026-07-14T08:00:00.000Z', updatedAt: '2026-07-14T12:00:00.000Z', ipAddress: '197.50.1.2', userAgent: 'Chrome on MacBook Pro' },
        { id: 'session-phone', userId: user.id, token: 'preview-phone-session-token', createdAt: '2026-07-12T08:00:00.000Z', updatedAt: '2026-07-13T19:45:00.000Z', expiresAt: '2026-07-20T08:00:00.000Z', ipAddress: '156.200.1.2', userAgent: 'Safari on iPhone' },
      ]);
    }
    if (path.endsWith('/passkey/list-user-passkeys')) {
      return Response.json([{ id: 'passkey-macbook', name: 'MacBook Touch ID', publicKey: 'cHVibGljLWtleS1tYXRlcmlhbA==', userId: user.id, credentialID: 'Y3JlZGVudGlhbC0xMjM', counter: 4, deviceType: 'multiDevice', backedUp: true, transports: 'internal', createdAt: '2026-07-11T08:00:00.000Z' }]);
    }
    return Response.json({ status: true, success: true });
  };
}

export function PreviewAuth({ locale, dark, signedIn = true, consentRequired = false, primaryColor = '#F5B84C', configUnavailable = false, privacyEnabled = false, children }: { locale: 'en' | 'ar'; dark: boolean; signedIn?: boolean; consentRequired?: boolean; primaryColor?: string; configUnavailable?: boolean; privacyEnabled?: boolean; children: React.ReactNode }) {
  const previewFetch = React.useMemo(
    () => createPreviewFetch(signedIn, consentRequired, primaryColor, configUnavailable, privacyEnabled),
    [configUnavailable, consentRequired, primaryColor, privacyEnabled, signedIn],
  );
  return (
    <AuthOwlProvider
      publishableKey={PREVIEW_PK}
      apiUrl="https://auth.preview.test"
      fetch={previewFetch}
      locale={locale}
      appearance={{ theme: dark ? 'dark' : 'light', primaryColor }}
    >
      {children}
    </AuthOwlProvider>
  );
}
