'use client';
import * as React from 'react';
import { useSlot } from '../elements';
import { useT } from '../i18n';
import { AuthCardLock } from './AuthCardLock';
import { AuthOwlBranding } from './AuthOwlBranding';
import { AuthOwlBadge } from './AuthOwlBadge';

const STEP_ID: Record<string, string> = { 'mfa-confirming': 'mfa-enrolment', 'passkey-offer': 'passkey-step' };
const STATUS_STEPS = ['otp-code', 'magic-sent', 'verify-pending', 'passkey-offer'];

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
  const bare = step === 'error' || step === 'waitlist';
  const decorated = !bare && step !== 'loading';
  const branding = showBranding ? <AuthOwlBranding /> : null;
  const title = <h2 className={slot('ba-title')}>{t(`${kind}.title`)}</h2>;
  return (
    <AuthCardLock.Provider value={lock}>
      <div ref={stepRef} className={slot(bare ? 'ba-step' : 'ba-form ba-card ba-auth-card ba-step')}
        data-testid={bare ? undefined : `${kind.toLowerCase()}-${STEP_ID[step] ?? step}`}
        aria-busy={step === 'loading' || step === 'mfa-confirming' || undefined}
        role={STATUS_STEPS.includes(step) ? 'status' : undefined}>
        {step === 'form' ? (
          <header className={slot('ba-auth-header')}>
            {branding}
            {title}
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
