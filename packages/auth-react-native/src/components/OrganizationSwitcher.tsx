/** Pick the active organization. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Organization } from '@authowl/core/native';

import { useServerError, useT } from '../i18n';
import { useAuthOwlClient, usePublicConfig, useSession } from '../provider';
import { FormError, useStyles } from './primitives';
import { defaultTheme, type AuthOwlTheme } from './theme';

export interface OrganizationSwitcherProps {
  /** Called after the active organization changes, including to personal. */
  onSwitched?: (organization: Organization | null) => void;
  /**
   * Offer a "personal account" row that clears the active organization.
   * Off by default: many apps require an organization context to function.
   */
  allowPersonal?: boolean;
  theme?: AuthOwlTheme;
}

/**
 * Lists the caller's organizations and switches between them.
 *
 * Reads the ACTIVE organization from the session rather than tracking it
 * locally. Switching re-mints the session claim server-side, so local state
 * would be a second source of truth that drifts the moment anything else
 * changes the active org.
 */
export function OrganizationSwitcher({
  onSwitched,
  allowPersonal = false,
  theme = defaultTheme,
}: OrganizationSwitcherProps) {
  const t = useT();
  const toMessage = useServerError();
  const client = useAuthOwlClient();
  const config = usePublicConfig();
  const session = useSession();
  const styles = useStyles(theme);

  const [organizations, setOrganizations] = useState<readonly Organization[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeId = session.data?.session.activeOrganizationId ?? null;
  const userId = session.data?.user.id ?? null;
  const signedIn = userId !== null;
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setError(null);
    const result = await client.organization.list();
    if (generation !== requestGeneration.current) return;
    if (result.error !== null) {
      setError(toMessage(result.error, 'organization.error.load'));
      return;
    }
    setOrganizations(result.data ?? []);
  }, [client, toMessage]);

  useEffect(() => {
    requestGeneration.current += 1;
    setOrganizations(null);
    setError(null);
    // Organizations are per-user, so an unauthenticated fetch would only 401.
    if (userId === null) return;
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [userId, load]);

  async function switchTo(organization: Organization | null) {
    if (switching !== null) return;
    setSwitching(organization?.id ?? 'personal');
    setError(null);
    const result = await client.organization.setActive({
      organizationId: organization?.id ?? null,
    });
    setSwitching(null);

    if (result.error !== null) {
      setError(toMessage(result.error, 'organization.switcher.error'));
      return;
    }
    onSwitched?.(result.data ?? null);
  }

  if (config.isLoading || (config.data !== null && !config.data.organizations)) return null;

  if (!signedIn) {
    return (
      <View style={styles.container} testID="authowl-orgswitcher">
        <Text style={styles.label}>{t('organization.signedOut')}</Text>
      </View>
    );
  }

  if (organizations === null && error === null) {
    return (
      <View style={styles.container} testID="authowl-orgswitcher">
        <Text style={styles.label}>{t('organization.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="authowl-orgswitcher">
      <Text style={styles.label}>{t('organization.switcher.label')}</Text>

      {allowPersonal ? (
        <OrganizationRow
          label={t('organization.personal')}
          selected={activeId === null}
          busy={switching === 'personal'}
          disabled={switching !== null}
          onPress={() => void switchTo(null)}
          testID="authowl-orgswitcher-personal"
          theme={theme}
        />
      ) : null}

      {(organizations ?? []).map((organization) => (
        <OrganizationRow
          key={organization.id}
          label={organization.name}
          selected={organization.id === activeId}
          busy={switching === organization.id}
          disabled={switching !== null}
          onPress={() => void switchTo(organization)}
          testID={`authowl-orgswitcher-${organization.id}`}
          theme={theme}
        />
      ))}

      <FormError message={error} theme={theme} testID="authowl-orgswitcher-error" />

      {error !== null ? (
        <Text
          style={styles.link}
          onPress={() => void load()}
          testID="authowl-orgswitcher-retry"
        >
          {t('organization.retry')}
        </Text>
      ) : null}
    </View>
  );
}

function OrganizationRow({
  label,
  selected,
  busy,
  disabled,
  onPress,
  testID,
  theme,
}: {
  label: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
  theme: AuthOwlTheme;
}) {
  const styles = useStyles(theme);
  return (
    <Pressable
      onPress={onPress}
      // The active organization stays pressable-looking but does nothing: making
      // it inert would read as "unavailable" rather than "already selected".
      disabled={disabled || selected}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || selected, busy }}
    >
      <Text style={selected ? [styles.label, { color: theme.accent }] : styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}
