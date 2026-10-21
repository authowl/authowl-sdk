// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { user } = vi.hoisted(() => ({ user: {
  id: 'user-1',
  name: 'Ada Lovelace' as string | null,
  email: 'ada@example.com',
  phoneNumber: null,
  image: 'https://lh3.googleusercontent.com/avatar.jpg' as string | null,
} }));

vi.mock('../hooks', () => ({
  useUser: () => ({
    user,
    isLoaded: true,
  }),
  useSignOut: () => ({ signOut: vi.fn() }),
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('./AuthOwlBadge', () => ({ AuthOwlBadge: () => null }));
vi.mock('./UserProfile', () => ({ UserProfile: () => null }));

import { UserButton } from './UserButton';

afterEach(cleanup);

describe('UserButton avatar', () => {
  beforeEach(() => {
    user.name = 'Ada Lovelace';
    user.image = 'https://lh3.googleusercontent.com/avatar.jpg';
  });

  it('shows an uppercase initial for an email-only user', () => {
    user.name = null;
    user.image = null;
    const { container } = render(<UserButton />);
    expect(container.querySelector('.ba-avatar-fallback')?.textContent).toBe('A');
  });

  it('loads provider images without a cross-site referrer and falls back after an error', () => {
    const { container } = render(<UserButton />);
    const image = container.querySelector('img.ba-avatar') as HTMLImageElement;

    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image);

    expect(container.querySelector('img.ba-avatar')).toBeNull();
    expect(container.querySelector('.ba-avatar-fallback')?.textContent).toBe('A');
  });
});
