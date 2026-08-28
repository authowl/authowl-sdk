'use client';

import * as React from 'react';
import type { Organization } from '@authowl/core';

const OrganizationListContent = React.lazy(async () => {
  const module = await import('./OrganizationListContent');
  return { default: module.OrganizationListContent };
});

export type OrganizationListProps = {
  onOrganizationChange?: (organization: Organization | null) => void;
};

/** Organization directory and invitation management, loaded on demand. */
export function OrganizationList(props: OrganizationListProps = {}) {
  return (
    <React.Suspense fallback={<div className="ba-skeleton" aria-busy="true" />}>
      <OrganizationListContent {...props} />
    </React.Suspense>
  );
}
