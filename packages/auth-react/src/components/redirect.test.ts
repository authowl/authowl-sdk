import { describe, it, expect } from 'vitest';
import { isSafeRedirect } from './redirect';

const ORIGIN = 'https://app.example.com';

describe('isSafeRedirect', () => {
  it('allows relative paths', () => {
    expect(isSafeRedirect('/dashboard', ORIGIN)).toBe(true);
    expect(isSafeRedirect('/a/b?c=1#d', ORIGIN)).toBe(true);
    expect(isSafeRedirect('dashboard', ORIGIN)).toBe(true);
  });

  it('allows same-origin absolute URLs', () => {
    expect(isSafeRedirect('https://app.example.com/settings', ORIGIN)).toBe(true);
  });

  it('refuses cross-origin destinations (open-redirect)', () => {
    expect(isSafeRedirect('https://evil.com', ORIGIN)).toBe(false);
    expect(isSafeRedirect('https://app.example.com.evil.com/x', ORIGIN)).toBe(false);
    expect(isSafeRedirect('http://app.example.com/x', ORIGIN)).toBe(false); // scheme differs
  });

  it('refuses protocol-relative and non-http schemes', () => {
    expect(isSafeRedirect('//evil.com', ORIGIN)).toBe(false);
    expect(isSafeRedirect('javascript:alert(1)', ORIGIN)).toBe(false);
    expect(isSafeRedirect('data:text/html,<script>', ORIGIN)).toBe(false);
  });

  it('refuses malformed input', () => {
    expect(isSafeRedirect('http://[', ORIGIN)).toBe(false);
  });
});
