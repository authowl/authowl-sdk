'use client';
import * as React from 'react';
import { useAuthClient } from '../../hooks';

/** Built-in roles the engine authorizes statically (never returned by list-roles). */
const BUILTIN_ROLES = ['owner', 'admin', 'member'] as const;

/**
 * The role keys assignable in an organization: the three built-ins plus this
 * project's roles (the engine's dynamic roles, which include projected custom
 * roles), fetched via `organization.listRoles()`. FALLS BACK to the built-ins
 * alone when the list is unavailable (endpoint off, no permission, or an error),
 * so a role select always renders something sensible. Deduped, built-ins first.
 */
export function useOrganizationRoles(organizationId: string | undefined): { roles: string[] } {
  const api = useAuthClient().organization;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const [dynamic, setDynamic] = React.useState<string[]>([]);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    const token = ++requestRef.current;
    setDynamic([]);
    if (!organizationId) return;
    void (async () => {
      try {
        const result = await apiRef.current.listRoles({ organizationId });
        if (token !== requestRef.current) return;
        setDynamic((result.data ?? []).map((entry) => entry.role).filter(Boolean));
      } catch {
        // Fall back to built-ins only.
      }
    })();
    return () => {
      requestRef.current += 1;
    };
  }, [organizationId]);

  const roles = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const candidate of [...BUILTIN_ROLES, ...dynamic]) {
      const key = candidate.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }, [dynamic]);

  return { roles };
}
