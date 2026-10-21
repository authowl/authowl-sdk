'use client';
import * as React from 'react';
import { useSlot } from '../elements';
import { useT } from '../i18n';
import { usePublicConfig } from '../hooks';
import { AuthCardLock } from './AuthCardLock';
import { AuthOwlBranding } from './AuthOwlBranding';
import { AuthOwlBadge } from './AuthOwlBadge';

const STEP_ID: Record<string, string> = { 'mfa-confirming': 'mfa-enrolment', 'passkey-offer': 'passkey-step' };

/** Shared sign-in/sign-up shell, header, status semantics and branding. */
export function StepCard({ lock, step, kind, stepRef, showBranding, showBadge, children }: {
  lock: NonNullable<React.ContextType<typeof AuthCardLock>>;
  step: string;
  kind: 'signIn' | 'signUp';
  stepRef: React.Ref<HTMLDivElement>;
  showBranding: boolean;
  showBadge?: boolean;
  children: React.ReactNode;
}) {
  const slot = useSlot();
  const t = useT();
  const { config } = usePublicConfig();
  // The design names the app in the heading ("Sign in to Acme"); the header
  // then shows only the mark, so the name is never printed twice.
  const app = showBranding && config?.branding?.showAppName !== false ? config?.branding?.appName?.trim() : '';
  const bare = step === 'error' || step === 'waitlist';
  const decorated = !bare && step !== 'loading';
  const branding = showBranding ? <AuthOwlBranding /> : null;
  const title = <h2 className={slot('ba-title')}>{t(`${kind}.title`)}</h2>;
  return (
    <AuthCardLock.Provider value={lock}>
      <div ref={stepRef} className={slot(bare ? 'ba-step' : 'ba-form ba-card ba-auth-card ba-step')}
        data-testid={bare ? undefined : `${kind.toLowerCase()}-${STEP_ID[step] ?? step}`}
        aria-busy={step === 'loading' || step === 'mfa-confirming' || undefined}>
        {step === 'form' ? (
          <header className={slot('ba-auth-header')}>
            {branding}
            {app ? <h2 className={slot('ba-title')}>{t(`${kind}.titleWithApp`, { app })}</h2> : title}
            <p className={slot('ba-subtitle')}>{t(`${kind}.subtitle`)}</p>
          </header>
        ) : decorated && branding}
        {(step === 'otp-code' || step === 'magic-sent') && title}
        {children}
        {decorated && <AuthOwlBadge force={showBadge} />}
      </div>
    </AuthCardLock.Provider>
  );
}
