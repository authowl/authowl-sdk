'use client';
import * as React from 'react';
import type { OrganizationTeam, OrganizationTeamMember } from '@authowl/core';
import { useAuthClient } from '../../hooks';
import { useT } from '../../i18n';
import { useOrganizationListResource } from './use-organization-list-resource';

export function useTeamsResource(organizationId: string) {
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const t = useT();
  const resource = useOrganizationListResource<OrganizationTeam>({
    enabled: true,
    resourceKey: organizationId,
    request: () => apiRef.current.listTeams({ organizationId }),
    fallback: t('organization.profile.loadError'),
  });
  return { teams: resource.data, error: resource.error, reload: resource.refresh };
}

export function useTeamMembersResource(selectedTeamId: string | null) {
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const t = useT();
  const resource = useOrganizationListResource<OrganizationTeamMember>({
    enabled: selectedTeamId !== null,
    resourceKey: selectedTeamId,
    request: () => apiRef.current.listTeamMembers({ teamId: selectedTeamId! }),
    fallback: t('organization.profile.loadError'),
  });
  return { members: resource.data, error: resource.error, reload: resource.refresh };
}
