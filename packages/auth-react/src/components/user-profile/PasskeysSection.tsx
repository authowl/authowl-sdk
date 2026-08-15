'use client';
import * as React from 'react';
import { useT } from '../../i18n';
import { PasskeyManager } from '../PasskeyManager';

export function PasskeysSection({ allowAdd }: { allowAdd: boolean }) {
  const t = useT();
  const titleId = React.useId();
  return (
    <section className="ba-profile-section" aria-labelledby={titleId}>
      <header className="ba-profile-section-header">
        <h2 id={titleId} className="ba-title">{t('userProfile.passkeys.title')}</h2>
        <p className="ba-muted">{t('userProfile.passkeys.description')}</p>
      </header>
      <PasskeyManager title={null} allowAdd={allowAdd} />
    </section>
  );
}
