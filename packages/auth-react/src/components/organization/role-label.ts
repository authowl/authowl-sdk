import type { useT } from '../../i18n';
import { organizationRoles } from './model';

export function organizationRoleLabel(role: string, t: ReturnType<typeof useT>): string {
  const roles = organizationRoles(role);
  return (roles.length > 0 ? roles : [role])
    .map((roleKey) => {
      if (roleKey === 'owner') return t('organization.role.owner');
      if (roleKey === 'admin') return t('organization.role.admin');
      if (roleKey === 'member') return t('organization.role.member');

      // listRoles() exposes only the key; using the operator-authored display
      // name here would require the server to add it to that response.
      const label = roleKey
        .split(/[-_]+/)
        .filter(Boolean)
        // Capitalise only the first letter and leave the rest alone: the project
        // role key is an unconstrained string, so lower-casing the remainder
        // would turn a deliberate `orgAdmin` into `Orgadmin`. Deliberately NOT
        // locale-aware: role keys are ASCII identifiers, and toLocaleUpperCase
        // on a Turkish host would render `instructor` as `Instructor` with a
        // dotted capital I.
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join(' ');
      return t('organization.role.custom', { role: label });
    })
    .join(t('organization.role.separator'));
}
