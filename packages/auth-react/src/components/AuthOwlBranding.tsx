'use client';
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
    <div className="ba-branding-identity">
      {logoUrl && !logoFailed ? (
        <img
          className="ba-branding-logo"
          src={logoUrl}
          alt={showAppName ? `${appName} logo` : 'Application logo'}
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
        />
      ) : showAppName ? (
        <span className="ba-branding-fallback" aria-hidden="true">
          {appName.charAt(0).toLocaleUpperCase()}
        </span>
      ) : null}
      {showAppName ? <span className="ba-branding-name">{appName}</span> : null}
    </div>
  );

  return (
    <div
      className={`ba-branding ba-branding-align-${alignment}`}
      data-testid="authowl-branding"
    >
      {href ? <a className="ba-branding-link" href={href}>{identity}</a> : identity}
      {showEnvironment && config.environmentType ? (
        <span
          className={`ba-environment ba-environment-${config.environmentType}`}
          data-testid="authowl-environment"
        >
          <span className="ba-environment-dot" aria-hidden="true" />
          {t(`branding.environment.${config.environmentType}`)}
        </span>
      ) : null}
    </div>
  );
}
