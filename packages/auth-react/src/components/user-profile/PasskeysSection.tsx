'use client';
import { useSlot } from '../../elements';
import * as React from 'react';
import { useT } from '../../i18n';
import { PasskeyManager } from '../PasskeyManager';

export function PasskeysSection({ allowAdd }: { allowAdd: boolean }) {
  const slot = useSlot();
  const t = useT();
  const titleId = React.useId();
  return (
    <section className={slot('ba-profile-section')} aria-labelledby={titleId}>
      <header className={slot('ba-profile-section-header')}>
        <h2 id={titleId} className={slot('ba-title')}>{t('userProfile.passkeys.title')}</h2>
        <p className={slot('ba-muted')}>{t('userProfile.passkeys.description')}</p>
      </header>
      <PasskeyManager title={null} allowAdd={allowAdd} />
    </section>
  );
}
