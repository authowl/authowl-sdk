/** Drop-in privacy choices and data-rights center for native applications. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type {
  PrivacyConsentPreference,
  PrivacyRightsRequest,
  PrivacyRightState,
  PrivacyRightType,
} from '@authowl/core/native';

import { useLocale, useServerError, useT, type MessageKey } from '../i18n';
import { useAuthOwlClient, usePublicConfig, useSession } from '../provider';
import { FormError } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

const RIGHT_KEYS: Record<PrivacyRightType, MessageKey> = {
  access: 'privacy.right.access',
  correction: 'privacy.right.correction',
  portability: 'privacy.right.portability',
  erasure: 'privacy.right.erasure',
  restriction: 'privacy.right.restriction',
  objection: 'privacy.right.objection',
  consent_withdrawal: 'privacy.right.consentWithdrawal',
};

const STATE_KEYS: Record<PrivacyRightState, MessageKey> = {
  received: 'privacy.state.received',
  identity_pending: 'privacy.state.identityPending',
  in_progress: 'privacy.state.inProgress',
  restricted: 'privacy.state.restricted',
  completed: 'privacy.state.completed',
  denied: 'privacy.state.denied',
  withdrawn: 'privacy.state.withdrawn',
};

export interface PrivacyCenterProps {
  theme?: AuthOwlTheme;
}

/** Manage optional consent and submit access, correction, export, or deletion requests. */
export function PrivacyCenter({ theme = defaultTheme }: PrivacyCenterProps = {}) {
  const t = useT();
  const { locale, direction } = useLocale();
  const toMessage = useServerError();
  const client = useAuthOwlClient();
  const config = usePublicConfig();
  const session = useSession();
  const [preferences, setPreferences] = useState<PrivacyConsentPreference[]>([]);
  const [requests, setRequests] = useState<PrivacyRightsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPurpose, setPendingPurpose] = useState<string | null>(null);
  const [pendingRight, setPendingRight] = useState<PrivacyRightType | null>(null);
  const signedIn = session.data !== null;

  const refresh = useCallback(async (showLoading = false) => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    const [consent, rights] = await Promise.all([
      client.privacy.listConsentPreferences(),
      client.privacy.listRightsRequests(),
    ]);
    const failure = consent.error ?? rights.error;
    if (failure) setError(toMessage(failure, 'privacy.error.load'));
    else {
      setPreferences(consent.data?.preferences ?? []);
      setRequests(rights.data?.requests ?? []);
      setError(null);
    }
    setLoading(false);
  }, [client, signedIn, toMessage]);

  useEffect(() => {
    if (!session.isPending) void refresh(true);
  }, [refresh, session.data?.user.id, session.isPending]);

  const preferencesByCode = useMemo(
    () => new Map(preferences.map((preference) => [preference.code, preference])),
    [preferences],
  );

  async function updateConsent(purposeCode: string, granted: boolean) {
    const privacy = config.data?.privacy;
    const purpose = privacy?.consentPurposes.find((item) => item.code === purposeCode);
    const notice = privacy?.notices.find((item) => item.purposeCodes.includes(purposeCode));
    if (!purpose || !notice) {
      setError(t('privacy.error.unavailable'));
      return;
    }
    setPendingPurpose(purposeCode);
    setError(null);
    const result = await client.privacy.recordConsent({
      purposeCode,
      purposeVersionId: purpose.purposeVersionId,
      noticeVersionId: notice.noticeVersionId,
      decision: granted ? 'granted' : 'withdrawn',
      locale,
    });
    if (result.error) setError(toMessage(result.error, 'privacy.error.save'));
    else await refresh();
    setPendingPurpose(null);
  }

  async function createRequest(rightType: PrivacyRightType) {
    setPendingRight(rightType);
    setError(null);
    const result = await client.privacy.createRightsRequest({ rightType, locale });
    if (result.error) setError(toMessage(result.error, 'privacy.error.request'));
    else await refresh();
    setPendingRight(null);
  }

  if (session.isPending || loading) {
    return <ActivityIndicator color={theme.accent} testID="authowl-privacy-loading" />;
  }
  if (!signedIn) return <Text style={{ color: theme.mutedText }}>{t('privacy.signedOut')}</Text>;

  const privacy = config.data?.privacy;
  // Only what the server says it can accept. Absent means an older server that
  // cannot tell us - offer everything, as this did before the field existed.
  const advertisedRights = privacy?.availableRightTypes;
  const allRights = Object.keys(RIGHT_KEYS) as PrivacyRightType[];
  const offeredRights = advertisedRights === undefined
    ? allRights
    : allRights.filter((right) => advertisedRights.includes(right));
  return (
    <View
      testID="authowl-privacy-center"
      style={{ gap: theme.spacing, backgroundColor: theme.background }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.mutedText, fontSize: 12, fontWeight: '700' }}>
          {t('privacy.dataUse')}
        </Text>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '600' }}>
          {t('privacy.title')}
        </Text>
        <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 20 }}>
          {t('privacy.description')}
        </Text>
      </View>
      <FormError message={error} theme={theme} testID="authowl-privacy-error" />

      <PrivacyBlock
        title={t('privacy.choices.title')}
        description={t('privacy.choices.description')}
        theme={theme}
      >
        {(privacy?.consentPurposes.length ?? 0) === 0 ? (
          <Text style={{ color: theme.mutedText }}>{t('privacy.choices.empty')}</Text>
        ) : privacy!.consentPurposes.map((purpose) => {
          const granted = preferencesByCode.get(purpose.code)?.state === 'granted';
          const pending = pendingPurpose === purpose.code;
          return (
            <View
              key={purpose.purposeVersionId}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: theme.text, fontWeight: '600', writingDirection: direction }}>
                  {purpose.title[locale]}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 18, writingDirection: direction }}>
                  {purpose.description[locale]}
                </Text>
              </View>
              <Pressable
                testID={`authowl-privacy-purpose-${purpose.code}`}
                accessibilityRole="switch"
                accessibilityLabel={purpose.title[locale]}
                accessibilityState={{ checked: granted, disabled: pending }}
                disabled={pending}
                onPress={() => void updateConsent(purpose.code, !granted)}
                style={{
                  minWidth: 58,
                  borderRadius: theme.radius,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  alignItems: 'center',
                  backgroundColor: granted ? theme.accent : theme.surface,
                  borderWidth: 1,
                  borderColor: granted ? theme.accent : theme.border,
                  opacity: pending ? 0.55 : 1,
                }}
              >
                <Text style={{ color: granted ? theme.accentText : theme.text, fontWeight: '600' }}>
                  {pending ? t('common.working') : t(granted ? 'privacy.on' : 'privacy.off')}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </PrivacyBlock>

      <PrivacyBlock
        title={t('privacy.rights.title')}
        description={t('privacy.rights.description')}
        theme={theme}
      >
        {offeredRights.length === 0 && (
          <Text style={{ color: theme.mutedText }}>{t('privacy.rights.unavailable')}</Text>
        )}
        {offeredRights.map((right) => (
          <Pressable
            key={right}
            testID={`authowl-privacy-right-${right}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: pendingRight !== null, busy: pendingRight === right }}
            disabled={pendingRight !== null}
            onPress={() => void createRequest(right)}
            style={{
              borderWidth: 1,
              borderColor: right === 'erasure' ? theme.danger : theme.border,
              borderRadius: theme.radius,
              padding: 12,
              opacity: pendingRight !== null ? 0.55 : 1,
            }}
          >
            <Text style={{ color: right === 'erasure' ? theme.danger : theme.text, fontWeight: '600' }}>
              {pendingRight === right ? t('common.working') : t(RIGHT_KEYS[right])}
            </Text>
          </Pressable>
        ))}
      </PrivacyBlock>

      <PrivacyBlock
        title={t('privacy.requests.title')}
        description={t('privacy.requests.description')}
        theme={theme}
      >
        {requests.length === 0 ? (
          <Text style={{ color: theme.mutedText }}>{t('privacy.requests.empty')}</Text>
        ) : requests.map((request) => (
          <View
            key={request.id}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
          >
            <Text style={{ flex: 1, color: theme.text }}>{t(RIGHT_KEYS[request.rightType])}</Text>
            <Text style={{ color: theme.mutedText, fontWeight: '600' }}>{t(STATE_KEYS[request.state])}</Text>
          </View>
        ))}
      </PrivacyBlock>
    </View>
  );
}

function PrivacyBlock({
  title,
  description,
  theme,
  children,
}: {
  title: string;
  description: string;
  theme: AuthOwlTheme;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        gap: theme.spacing,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: theme.radius,
        backgroundColor: theme.surface,
        padding: theme.spacing,
      }}
    >
      <View style={{ gap: 3 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 19 }}>{description}</Text>
      </View>
      {children}
    </View>
  );
}
