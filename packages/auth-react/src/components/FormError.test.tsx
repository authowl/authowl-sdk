// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormError } from './FormError';
import { catalogs, resolveServerError } from '@authowl/core/i18n';

describe('FormError', () => {
  afterEach(cleanup);

  it('announces the message: role="alert" + assertive aria-live on the ba-error node', () => {
    render(<FormError>Something went wrong</FormError>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Something went wrong');
    expect(alert.tagName).toBe('P');
    expect(alert.classList.contains('ba-error')).toBe(true);
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('renders nothing when there is no message (drop-in for `{error && …}`)', () => {
    const { container: a } = render(<FormError>{null}</FormError>);
    expect(a.querySelector('.ba-error')).toBeNull();
    const { container: b } = render(<FormError>{''}</FormError>);
    expect(b.querySelector('.ba-error')).toBeNull();
    const { container: c } = render(<FormError>{false}</FormError>);
    expect(c.querySelector('.ba-error')).toBeNull();
  });

  it('passes data-testid and extra className through', () => {
    render(
      <FormError data-testid="reset-invalid" className="extra">
        Invalid link
      </FormError>,
    );
    const alert = screen.getByTestId('reset-invalid');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.classList.contains('ba-error')).toBe(true);
    expect(alert.classList.contains('extra')).toBe(true);
  });

  it('renders resolveServerError output VERBATIM (readable-error policy preserved)', () => {
    // A mapped code must win over the raw server message, exactly as the shipped
    // 0.5.0 policy resolves it; FormError must not alter that resolved string.
    const resolved = resolveServerError(
      'en',
      { code: 'INVALID_EMAIL', status: 400, message: 'totally different server text' },
      'generic fallback',
    );
    render(<FormError>{resolved}</FormError>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(resolved);
    expect(alert.textContent).toBe(catalogs.en['serverError.INVALID_EMAIL']);

    // And the localized (Arabic) resolution is likewise passed through untouched.
    const resolvedAr = resolveServerError('ar', { code: 'INVALID_EMAIL', status: 400 }, 'x');
    render(<FormError>{resolvedAr}</FormError>);
    expect(screen.getAllByRole('alert')[1]!.textContent).toBe(catalogs.ar['serverError.INVALID_EMAIL']);
  });
});
