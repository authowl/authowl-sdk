'use client';
import { useSlot } from '../elements';
import * as React from 'react';
import { usePublicConfig } from '../hooks';
import { useT } from '../i18n';

export type AuthOwlBrandingProps = {
  /** Optional destination when the brand identity is clicked. */
  href?: string;
  /** Hide the environment label when a host app presents it elsewhere. */
  showEnvironment?: boolean;
};

/**
 * Project identity shown above AuthOwl's managed authentication components.
 * It reads the same public branding contract as the rest of the SDK, including
 * logo-only brands and the exact development or production environment.
 */
export function AuthOwlBranding({ href, showEnvironment = true }: AuthOwlBrandingProps = {}) {
  const slot = useSlot();
  const t = useT();
  const { config } = usePublicConfig();
  const logoUrl = config?.branding?.logoUrl;
  const appName = config?.branding?.appName?.trim() ?? '';
  const showAppName = config?.branding?.showAppName !== false && appName.length > 0;
  const alignment = config?.branding?.alignment ?? 'left';
  const [logoFailed, setLogoFailed] = React.useState(false);

  React.useEffect(() => setLogoFailed(false), [logoUrl]);

  if (!config) return null;
  if (!logoUrl && !showAppName && (!showEnvironment || !config.environmentType)) return null;

  const identity = (
    <div className={slot('ba-branding-identity')}>
      {logoUrl && !logoFailed ? (
        <img
          className={slot('ba-branding-logo')}
          src={logoUrl}
          alt={showAppName ? `${appName} logo` : 'Application logo'}
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
        />
      ) : showAppName ? (
        <span className={slot('ba-branding-fallback')} aria-hidden="true">
          {appName.charAt(0).toLocaleUpperCase()}
        </span>
      ) : null}
      {showAppName ? <span className={slot('ba-branding-name')}>{appName}</span> : null}
    </div>
  );

  return (
    <div
      className={slot(`ba-branding ba-branding-align-${alignment}`)}
      data-testid="authowl-branding"
    >
      {href ? <a className={slot('ba-branding-link')} href={href}>{identity}</a> : identity}
      {showEnvironment && config.environmentType ? (
        <span
          className={slot(`ba-environment ba-environment-${config.environmentType}`)}
          data-testid="authowl-environment"
        >
          <span className={slot('ba-environment-dot')} aria-hidden="true" />
          {t(`branding.environment.${config.environmentType}`)}
        </span>
      ) : null}
    </div>
  );
}
