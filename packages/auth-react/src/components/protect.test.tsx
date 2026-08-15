// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vite raw import - reads the component source for the docblock assertion.
import controlSource from './control.tsx?raw';

const mocks = vi.hoisted(() => ({
  user: {
    isLoaded: true,
    isSignedIn: true,
    user: { id: 'user-1', email: 'u@example.test', emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  },
  membership: null as { role: string; permissions: string[]; teams?: string[] } | null,
}));

vi.mock('../hooks', () => ({
  useUser: () => ({ ...mocks.user, needsMfaEnrollment: false, error: null }),
  useSession: () => ({
    data: { user: mocks.user.user, session: { id: 's1', userId: 'user-1', membership: mocks.membership } },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: () => undefined,
  }),
}));

vi.mock('../i18n', () => ({ useT: () => (key: string) => key }));

import { Protect } from './control';

describe('<Protect role|permission> (advisory gating)', () => {
  afterEach(cleanup);

  it('renders children only when the membership grants the permission', () => {
    mocks.membership = { role: 'billing_manager', permissions: ['org:billing:read', 'org:sys_roles:read'] };
    render(<Protect permission="org:billing:read"><p>secret</p></Protect>);
    expect(screen.getByText('secret')).toBeDefined();
  });

  it('renders the fallback when the permission is not granted', () => {
    mocks.membership = { role: 'member', permissions: ['org:sys_roles:read'] };
    render(<Protect permission="org:billing:read" fallback={<p>denied</p>}><p>secret</p></Protect>);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('denied')).toBeDefined();
  });

  it('gates on role match', () => {
    mocks.membership = { role: 'admin', permissions: [] };
    render(<Protect role="admin"><p>ok</p></Protect>);
    expect(screen.getByText('ok')).toBeDefined();
    cleanup();
    mocks.membership = { role: 'member', permissions: [] };
    render(<Protect role="admin" fallback={<p>no</p>}><p>ok</p></Protect>);
    expect(screen.getByText('no')).toBeDefined();
    expect(screen.queryByText('ok')).toBeNull();
  });

  it('gates on team membership', () => {
    mocks.membership = { role: 'member', permissions: [], teams: ['team-alpha', 'team-beta'] };
    render(<Protect teamId="team-alpha"><p>alpha</p></Protect>);
    expect(screen.getByText('alpha')).toBeDefined();
    cleanup();

    render(<Protect teamId="team-gamma" fallback={<p>denied</p>}><p>gamma</p></Protect>);
    expect(screen.queryByText('gamma')).toBeNull();
    expect(screen.getByText('denied')).toBeDefined();
  });

  it('fails a team gate when the session predates teams', () => {
    // No `teams` on the claim at all - an old session must not satisfy a team gate.
    mocks.membership = { role: 'owner', permissions: ['org:sys_roles:read'] };
    render(<Protect teamId="team-alpha" fallback={<p>denied</p>}><p>secret</p></Protect>);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('denied')).toBeDefined();
  });

  it('ANDs a team gate with a role gate', () => {
    mocks.membership = { role: 'admin', permissions: [], teams: ['team-alpha'] };
    render(<Protect role="admin" teamId="team-alpha"><p>both</p></Protect>);
    expect(screen.getByText('both')).toBeDefined();
    cleanup();

    // Right team, wrong role.
    render(<Protect role="owner" teamId="team-alpha" fallback={<p>denied</p>}><p>both</p></Protect>);
    expect(screen.queryByText('both')).toBeNull();
    expect(screen.getByText('denied')).toBeDefined();
  });

  it('requires signed-in even with a matching membership', () => {
    mocks.user = { ...mocks.user, isSignedIn: false, user: null as never };
    mocks.membership = { role: 'admin', permissions: ['org:billing:read'] };
    render(<Protect permission="org:billing:read" fallback={<p>signedout</p>}><p>secret</p></Protect>);
    expect(screen.getByText('signedout')).toBeDefined();
    mocks.user = { ...mocks.user, isSignedIn: true, user: { id: 'user-1', email: 'u@example.test', emailVerified: true, createdAt: new Date(), updatedAt: new Date() } };
  });

  it('keeps the "not a security boundary" advisory docblock', () => {
    const source = controlSource as string;
    expect(source).toMatch(/UX affordance/i);
    expect(source).toMatch(/NOT a security boundary/i);
    // The Protect docblock reinforces server-side enforcement over the verified token.
    expect(source).toMatch(/verified project token/i);
  });
});
