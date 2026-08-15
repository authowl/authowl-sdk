import type { useT } from '../../i18n';
import { organizationRoles } from './model';

export function organizationRoleLabel(role: string, t: ReturnType<typeof useT>): string {
  const primaryRole = organizationRoles(role)[0] ?? role;
  if (primaryRole === 'owner') return t('organization.role.owner');
  if (primaryRole === 'admin') return t('organization.role.admin');
  if (primaryRole === 'member') return t('organization.role.member');
  return primaryRole;
}
