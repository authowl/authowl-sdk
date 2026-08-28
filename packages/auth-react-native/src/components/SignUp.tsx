/** Drop-in email/password sign-up screen. */

import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import {
  buildPrivacySignUpEvidence,
  createIdempotencyKey,
  resolveProjectCapabilities,
  type Locale,
  type PublicConfig,
} from '@authowl/core/native';

import { useLocale, useServerError, useT } from '../i18n';
import { useAuthOwlClient, usePublicConfig } from '../provider';
import { Field, FormError, SubmitButton, useStyles } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

export interface SignUpProps {
  /**
   * Called when sign-up succeeds.
   *
   * `sessionCreated` is false when the project requires email verification
   * first. The caller decides what happens next, because "check your email" and
   * "you are signed in" are different screens.
   */
  onSignedUp?: (result: { sessionCreated: boolean }) => void;
  /** Collect first and last name instead of a single display name. */
  structuredName?: boolean;
  theme?: AuthOwlTheme;
}

/** Create an account with an email address and password. */
export function SignUp({ onSignedUp, structuredName = false, theme = defaultTheme }: SignUpProps) {
  const t = useT();
  const { locale, direction } = useLocale();
  const toMessage = useServerError();
  const client = useAuthOwlClient();
  const config = usePublicConfig();
  const capabilities = resolveProjectCapabilities(config.data);
  const styles = useStyles(theme);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedConsent, setAcceptedConsent] = useState(false);
  const [grantedPurposeCodes, setGrantedPurposeCodes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [privacyCorrelationId] = useState(createIdempotencyKey);

  const legal = config.data?.legal;
  const privacy = config.data?.privacy;
  useEffect(() => {
    setAcceptedConsent(false);
  }, [legal?.version]);
  useEffect(() => {
    setGrantedPurposeCodes(new Set());
  }, [privacy]);

  const useStructuredName = structuredName || capabilities.firstLastName;

  // The server requires a display name. When the app collects first/last
  // separately, join them rather than sending an empty one and failing on the
  // wire for a reason the user cannot act on.
  const displayName = useStructuredName
    ? [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    : name.trim();

  const canSubmit = email.trim().length > 0
    && password.length >= capabilities.passwordMinLength
    && password.length <= capabilities.passwordMaxLength
    && displayName.length > 0
    && (!legal?.required || acceptedConsent);

  async function submit() {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await client.signUp.email({
      email: email.trim(),
      password,
      name: displayName,
      ...(legal?.required ? { consentVersion: legal.version } : {}),
      ...(privacy && privacy.notices.length > 0
        ? {
            privacyEvidence: buildPrivacySignUpEvidence(
              privacy,
              locale,
              grantedPurposeCodes,
              privacyCorrelationId,
            ),
          }
        : {}),
      ...(useStructuredName
        ? { firstName: firstName.trim(), lastName: lastName.trim() }
        : {}),
    });
    setBusy(false);

    if (result.error !== null) {
      setError(toMessage(result.error, 'signUp.error.failed'));
      return;
    }
    onSignedUp?.({ sessionCreated: result.data?.sessionCreated === true });
  }

  if (config.isLoading || (config.data !== null && !capabilities.passwordSignUp)) return null;

  const termsUrl = legal?.termsUrl;
  const privacyUrl = legal?.privacyUrl;
  const consentDocuments = [
    termsUrl ? t('consent.termsOfService') : null,
    privacyUrl ? t('consent.privacyPolicy') : null,
  ].filter((value): value is string => value !== null).join(t('consent.docJoiner'));
  const consentTemplate = t('signUp.consentLabel');
  const consentMarker = consentTemplate.indexOf('{links}');
  const consentPrefix = consentMarker === -1
    ? consentTemplate
    : consentTemplate.slice(0, consentMarker);
  const consentSuffix = consentMarker === -1
    ? ''
    : consentTemplate.slice(consentMarker + '{links}'.length);

  return (
    <View style={styles.container} testID="authowl-signup">
      <Text style={styles.title}>{t('signUp.title')}</Text>

      {useStructuredName ? (
        <>
          <Field
            label={t('signUp.firstNameLabel')}
            value={firstName}
            onChangeText={setFirstName}
            theme={theme}
            editable={!busy}
            testID="authowl-signup-first-name"
            autoComplete="given-name"
          />
          <Field
            label={t('signUp.lastNameLabel')}
            value={lastName}
            onChangeText={setLastName}
            theme={theme}
            editable={!busy}
            testID="authowl-signup-last-name"
            autoComplete="family-name"
          />
        </>
      ) : (
        <Field
          label={t('signUp.nameLabel')}
          value={name}
          onChangeText={setName}
          theme={theme}
          editable={!busy}
          testID="authowl-signup-name"
          autoComplete="name"
        />
      )}

      <Field
        label={t('common.emailLabel')}
        value={email}
        onChangeText={setEmail}
        theme={theme}
        editable={!busy}
        testID="authowl-signup-email"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Field
        label={t('common.passwordLabel')}
        value={password}
        onChangeText={setPassword}
        theme={theme}
        secure
        editable={!busy}
        testID="authowl-signup-password"
        autoComplete="new-password"
        maxLength={capabilities.passwordMaxLength}
        onSubmitEditing={submit}
      />

      {legal?.required ? (
        <View style={[styles.consentRow, { direction }]}>
          <Pressable
            onPress={() => setAcceptedConsent((accepted) => !accepted)}
            disabled={busy}
            hitSlop={8}
            style={styles.consentToggle}
            testID="authowl-signup-consent"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedConsent }}
            accessibilityLabel={t('signUp.consentLabel', { links: consentDocuments })}
          >
            <View
              style={[
                styles.consentBox,
                acceptedConsent && styles.consentBoxChecked,
                busy && styles.consentBoxDisabled,
              ]}
              testID="authowl-signup-consent-box"
            >
              {acceptedConsent ? <Text style={styles.consentCheck}>✓</Text> : null}
            </View>
          </Pressable>
          <Text style={styles.consentText}>
            {consentPrefix}
            {termsUrl ? (
              <Text
                style={styles.consentLink}
                onPress={() => void Linking.openURL(termsUrl)}
                testID="authowl-signup-terms"
              >
                {t('consent.termsOfService')}
              </Text>
            ) : null}
            {termsUrl && privacyUrl ? t('consent.docJoiner') : null}
            {privacyUrl ? (
              <Text
                style={styles.consentLink}
                onPress={() => void Linking.openURL(privacyUrl)}
                testID="authowl-signup-privacy"
              >
                {t('consent.privacyPolicy')}
              </Text>
            ) : null}
            {consentSuffix}
          </Text>
        </View>
      ) : null}

      {privacy && (privacy.notices.length > 0 || privacy.consentPurposes.length > 0) ? (
        <NativePrivacySignUpEvidence
          privacy={privacy}
          locale={locale}
          direction={direction}
          grantedPurposeCodes={grantedPurposeCodes}
          onPurposeChange={(purposeCode, granted) => {
            setGrantedPurposeCodes((current) => {
              const next = new Set(current);
              if (granted) next.add(purposeCode);
              else next.delete(purposeCode);
              return next;
            });
          }}
          theme={theme}
          disabled={busy}
        />
      ) : null}

      <FormError message={error} theme={theme} />

      <SubmitButton
        label={t('signUp.submit')}
        busyLabel={t('signUp.submitPending')}
        onPress={submit}
        busy={busy}
        disabled={!canSubmit}
        theme={theme}
        testID="authowl-signup-submit"
      />
    </View>
  );
}

type PrivacyConfig = NonNullable<PublicConfig['privacy']>;

function NativePrivacySignUpEvidence({
  privacy,
  locale,
  direction,
  grantedPurposeCodes,
  onPurposeChange,
  theme,
  disabled,
}: {
  privacy: PrivacyConfig;
  locale: Locale;
  direction: 'ltr' | 'rtl';
  grantedPurposeCodes: ReadonlySet<string>;
  onPurposeChange: (purposeCode: string, granted: boolean) => void;
  theme: AuthOwlTheme;
  disabled: boolean;
}) {
  const t = useT();
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
      testID="authowl-signup-privacy-evidence"
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
          {t('privacy.signup.title')}
        </Text>
        <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 19 }}>
          {t('privacy.signup.description')}
        </Text>
      </View>

      {privacy.notices.map((notice) => (
        <View
          key={notice.noticeVersionId}
          style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', writingDirection: direction }}>
            {notice.title[locale]}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 18, writingDirection: direction }}>
            {notice.body[locale]}
          </Text>
        </View>
      ))}

      {privacy.consentPurposes.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>
            {t('privacy.signup.optional')}
          </Text>
          {privacy.consentPurposes.map((purpose) => {
            const granted = grantedPurposeCodes.has(purpose.code);
            return (
              <Pressable
                key={purpose.purposeVersionId}
                testID={`authowl-signup-purpose-${purpose.code}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: granted, disabled }}
                disabled={disabled}
                onPress={() => onPurposeChange(purpose.code, !granted)}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: granted ? theme.accent : theme.border,
                    borderRadius: 4,
                    backgroundColor: granted ? theme.accent : theme.background,
                  }}
                >
                  {granted ? <Text style={{ color: theme.accentText, fontSize: 13 }}>✓</Text> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600', writingDirection: direction }}>
                    {purpose.title[locale]}
                  </Text>
                  <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 17, writingDirection: direction }}>
                    {purpose.description[locale]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Text style={{ color: theme.mutedText, fontSize: 12, lineHeight: 18 }}>
            {t('privacy.signup.choiceNote')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
