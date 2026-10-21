// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmbeddedAuthFormContext } from './components/EmbeddedAuthFormContext';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(), retry: vi.fn(), signOut: vi.fn(),
  user: { isLoaded: true, isSignedIn: false, user: null },
  config: { environmentId: 'project-a' },
}));
vi.mock('./hooks', () => ({
  usePublicConfig: () => ({ config: mocks.config }),
  useUser: () => mocks.user,
  useSignOut: () => ({ signOut: mocks.signOut }),
  useInvitationRecipientHint: () => ({ isLoaded: true, recipientHint: null }),
  useOrganizationInvitation: () => ({
    invitation: null, status: 'idle', error: null, accept: mocks.accept, retry: mocks.retry,
  }),
}));
vi.mock('./provider', () => ({ useAuthOwlContext: () => ({ locale: 'en' }) }));
vi.mock('./components/MFARequiredGate', () => ({
  MFARequiredGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/SignIn', () => ({
  SignIn: () => <p data-testid="signin" data-embedded={String(React.useContext(EmbeddedAuthFormContext))}>Sign in form</p>,
}));
vi.mock('./components/SignUp', () => ({
  SignUp: () => <p data-testid="signup" data-embedded={String(React.useContext(EmbeddedAuthFormContext))}>Sign up form</p>,
}));
import { AcceptOrganizationInvitation } from './components/AcceptOrganizationInvitation';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

it.each(['signin', 'signup'])('keeps embedded %s inline', (mode) => {
  render(<AcceptOrganizationInvitation />);
  if (mode === 'signup') fireEvent.click(screen.getByText('Create an account'));
  expect(screen.getByTestId(mode).getAttribute('data-embedded')).toBe('true');
});
