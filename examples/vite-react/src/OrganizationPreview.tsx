import React from 'react';
import { OrganizationList, OrganizationProfile, OrganizationSwitcher } from '@authowl/react';
import { PreviewAuth } from './PreviewAuth';

export function OrganizationPreview({ locale, dark, profile }: { locale: 'en' | 'ar'; dark: boolean; profile: boolean }) {
  return (
    <PreviewAuth locale={locale} dark={dark}>
      <main style={{ minHeight: '100vh', padding: '40px 20px', boxSizing: 'border-box', background: dark ? '#09090b' : '#f4f4f5', fontFamily: 'system-ui' }}>
        <div style={{ maxWidth: 960, margin: '0 auto 18px', display: 'flex', justifyContent: 'flex-end' }}>
          <OrganizationSwitcher />
        </div>
        {profile ? (
          <div style={{ maxWidth: 920, margin: '0 auto', border: `1px solid ${dark ? '#3f3f46' : '#d4d4d8'}`, borderRadius: 14, overflow: 'hidden', background: dark ? '#18181b' : '#fff' }}>
            <OrganizationProfile />
          </div>
        ) : <OrganizationList />}
      </main>
    </PreviewAuth>
  );
}
