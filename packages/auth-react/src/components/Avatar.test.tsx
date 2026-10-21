// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

it.each([
  ['  Mona Ali ', 'mona@example.test', 'M'],
  ['🦉 Owl', null, '🦉'],
  ['👩🏽‍💻 Mona', null, '👩🏽‍💻'],
  ['e\u0301mile', null, 'e\u0301'],
  ['   ', '  ada@example.test', 'a'],
  ['   ', null, '○'],
])('uses a single first grapheme for %s', (name, email, expected) => {
  const { container } = render(<Avatar name={name} email={email} />);
  expect(container.textContent).toBe(expected);
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
