'use client';
import { useSlot } from '../elements';


import * as React from 'react';
import type { OrganizationDetails } from '@authowl/core';
import type { OrganizationProfileSection } from './organization/model';

const OrganizationProfileContent = React.lazy(async () => {
  const module = await import('./OrganizationProfileContent');
  return { default: module.OrganizationProfileContent };
});

export type OrganizationProfileProps = {
  /** Organization to manage. Omitted means the active organization from the session. */
  organizationId?: string;
  defaultSection?: OrganizationProfileSection;
  onDeleted?: (organization: OrganizationDetails) => void;
  onLeft?: (organization: OrganizationDetails) => void;
};

/**
 * Managed organization settings, loaded when the host renders this optional
 * administration surface.
 */
export function OrganizationProfile(props: OrganizationProfileProps = {}) {
  const slot = useSlot();
  return (
    <React.Suspense fallback={<div className={slot('ba-skeleton')} aria-busy="true" />}>
      <OrganizationProfileContent {...props} />
    </React.Suspense>
  );
}

export type { OrganizationProfileSection } from './organization/model';
