import React from 'react';
import { UserButton, UserProfile } from '@authowl/react';
import { PreviewAuth } from './PreviewAuth';

export function UserProfilePreview({ locale, dark }: { locale: 'en' | 'ar'; dark: boolean }) {
  return (
    <PreviewAuth locale={locale} dark={dark}>
      <main style={{ minHeight: '100vh', padding: '40px 20px', boxSizing: 'border-box', background: dark ? '#09090b' : '#f4f4f5', fontFamily: 'system-ui' }}>
        <div style={{ maxWidth: 920, margin: '0 auto 18px', display: 'flex', justifyContent: 'flex-end' }}>
          <UserButton />
        </div>
        <UserProfile />
      </main>
    </PreviewAuth>
  );
}
