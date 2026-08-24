import { describe, expect, it, vi } from 'vitest';
import { CAPTCHA_ADAPTERS } from './captcha-providers';

describe('captcha provider teardown', () => {
  it('uses reset when remove is absent', () => {
    const reset = vi.fn();
    const api = { render: vi.fn(), execute: vi.fn(), reset };

    expect(() => CAPTCHA_ADAPTERS['recaptcha-v2'].teardown(api, 7)).not.toThrow();
    expect(reset).toHaveBeenCalledWith(7);
  });
});
