'use client';
import { useSlot } from '../elements';


import * as React from 'react';

const PrivacyCenterContent = React.lazy(async () => {
  const module = await import('./PrivacyCenterContent');
  return { default: module.PrivacyCenterContent };
});

export type PrivacyCenterProps = {
  /** Optional class name on the privacy-center section. */
  className?: string;
};

/**
 * Managed consent and data-rights UI.
 *
 * The full center loads on demand because it is normally opened from account
 * settings, keeping it out of an application's initial authentication bundle.
 */
export function PrivacyCenter(props: PrivacyCenterProps = {}) {
  return (
    <React.Suspense fallback={<PrivacyCenterFallback className={props.className} />}>
      <PrivacyCenterContent {...props} />
    </React.Suspense>
  );
}

function PrivacyCenterFallback({ className }: PrivacyCenterProps) {
  const slot = useSlot();
  return (
    <section
      className={slot(['ba-profile-section ba-privacy-center', className].filter(Boolean).join(' '))}
      aria-busy="true"
    >
      <div className={slot('ba-skeleton')} />
      <div className={slot('ba-skeleton')} />
      <div className={slot('ba-skeleton')} />
    </section>
  );
}
