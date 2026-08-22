// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../i18n', () => ({
  useT: () => (key: string) => key,
}));

import { QrCode } from './QrCode';

afterEach(cleanup);

describe('QrCode', () => {
  it('loads the local encoder on demand and renders an accessible SVG', async () => {
    render(
      <QrCode
        value="otpauth://totp/Acme:a@b.co?secret=JBSWY3DPEHPK3PXP&issuer=Acme"
        size={180}
      />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    const image = await screen.findByRole('img', { name: 'qr.ariaLabel' });
    expect(image.tagName).toBe('svg');
    expect(image.getAttribute('width')).toBe('180');
    expect(image.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
  });

  it('stays empty for a value the encoder cannot render', async () => {
    const { container, rerender } = render(
      <QrCode value="otpauth://totp/Acme:a@b.co?secret=JBSWY3DPEHPK3PXP&issuer=Acme" />,
    );
    await screen.findByRole('img');
    rerender(<QrCode value="" />);

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeNull();
    });
  });
});
