'use client';

import * as React from 'react';
import type { Organization } from '@authowl/core';

const OrganizationSwitcherContent = React.lazy(async () => {
  const module = await import('./OrganizationSwitcherContent');
  return { default: module.OrganizationSwitcherContent };
});

export type OrganizationSwitcherProps = {
  showPersonalWorkspace?: boolean;
  onOrganizationChange?: (organization: Organization | null) => void;
};

/** Organization workspace switcher, loaded when the host renders it. */
export function OrganizationSwitcher(props: OrganizationSwitcherProps = {}) {
  return (
    <React.Suspense
      fallback={<div className="ba-skeleton ba-organization-switcher-skeleton" aria-busy="true" />}
    >
      <OrganizationSwitcherContent {...props} />
    </React.Suspense>
  );
}
