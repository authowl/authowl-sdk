// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

it.each([
  ['  Mona Ali ', 'mona@example.test', 'M'],
  ['🦉 Owl', null, '🦉'],
  ['👩🏽‍💻 Mona', null, '👩🏽‍💻'],
  ['e\u0301mile', null, 'E\u0301'],
  ['   ', '  ada@example.test', 'A'],
  ['   ', null, '○'],
])('uses a single first grapheme for %s', (name, email, expected) => {
  const { container } = render(<Avatar name={name} email={email} />);
  expect(container.textContent).toBe(expected);
});

it('falls back to the first code point when Intl.Segmenter is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
  vi.resetModules();
  try {
    const { Avatar: LegacyAvatar } = await import('./Avatar');
    const { container, rerender } = render(<LegacyAvatar email="ada@example.test" />);
    expect(container.textContent).toBe('A');
    rerender(<LegacyAvatar name="🦉 Owl" />);
    expect(container.textContent).toBe('🦉');
    rerender(<LegacyAvatar name="e\u0301mile" />);
    expect(container.textContent).toBe('E');
  } finally {
    Object.defineProperty(Intl, 'Segmenter', descriptor);
    vi.resetModules();
  }
});

it('protects provider images and restores a fallback in profile identity too', () => {
  const { container, rerender } = render(<Avatar profile name="Mona" image="https://images.example.test/one" />);
  const image = container.querySelector('img')!;
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  fireEvent.error(image);
  expect(container.querySelector('.ao-profile-avatar')?.textContent).toBe('M');
  rerender(<Avatar profile name="Mona" image="https://images.example.test/two" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('https://images.example.test/two');
});
