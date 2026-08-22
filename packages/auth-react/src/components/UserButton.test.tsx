// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks', () => ({
  useUser: () => ({
    user: {
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phoneNumber: null,
      image: 'https://lh3.googleusercontent.com/avatar.jpg',
    },
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
  it('loads provider images without a cross-site referrer and falls back after an error', () => {
    const { container } = render(<UserButton />);
    const image = container.querySelector('img.ba-avatar') as HTMLImageElement;

    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image);

    expect(container.querySelector('img.ba-avatar')).toBeNull();
    expect(container.querySelector('.ba-avatar-fallback')?.textContent).toBe('A');
  });
});
