import { describe, expect, it } from 'vitest';
import { formatMessage, type MessageKey, type MessageParams } from '../../i18n';
import { organizationRoleLabel } from './role-label';

const en = (key: MessageKey, params?: MessageParams) => formatMessage('en', key, params);
const ar = (key: MessageKey, params?: MessageParams) => formatMessage('ar', key, params);

describe('organizationRoleLabel', () => {
  it('keeps built-in role labels localized', () => {
    expect(organizationRoleLabel('owner', en)).toBe('Owner');
    expect(organizationRoleLabel('admin', en)).toBe('Admin');
    expect(organizationRoleLabel('member', en)).toBe('Member');
  });

  it('humanizes custom role keys', () => {
    expect(organizationRoleLabel('editor', en)).toBe('Editor');
    expect(organizationRoleLabel('billing_admin', en)).toBe('Billing Admin');
    expect(organizationRoleLabel('billing-admin', en)).toBe('Billing Admin');
  });

  it('labels every role with the locale-specific separator', () => {
    expect(organizationRoleLabel('admin,editor', en)).toBe('Admin, Editor');
    expect(organizationRoleLabel('admin,editor', ar)).toBe('مشرف، Editor');
  });

  it('capitalises a custom key without flattening the rest of it', () => {
    // Project role keys are an unconstrained string server-side, so a deliberate
    // `orgAdmin` must not come back as `Orgadmin`.
    expect(organizationRoleLabel('orgAdmin', en)).toBe('OrgAdmin');
    expect(organizationRoleLabel('billing_admin', en)).toBe('Billing Admin');
  });

  it('routes a custom role through the catalog rather than hardcoding it', () => {
    // Both shipped locales define organization.role.custom as the pass-through
    // '{role}', so comparing en against ar cannot tell a correct implementation
    // from one that ignored `t` for this branch. Assert the call directly.
    const calls: Array<[string, unknown]> = [];
    const spy = ((key: string, params?: unknown) => {
      calls.push([key, params]);
      return `<<${key}>>`;
    }) as unknown as Parameters<typeof organizationRoleLabel>[1];

    expect(organizationRoleLabel('editor', spy)).toBe('<<organization.role.custom>>');
    expect(calls).toContainEqual(['organization.role.custom', { role: 'Editor' }]);
  });
});
