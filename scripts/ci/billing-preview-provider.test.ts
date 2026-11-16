// @vitest-environment jsdom
import React from 'react';
import {
  clientExtension,
  createAuthOwlClient,
  resolveConfig,
} from '../../packages/auth-core/src/index';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewFetch, PreviewAuth } from '../../examples/vite-react/src/PreviewAuth';
import { pricingCatalog } from '../../examples/vite-react/src/preview-billing-fixtures';
import { usePricing } from '../../packages/billing/src/react';
import { decodePricingCatalog } from '../../packages/billing/src/wire';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
});

function PricingProbe() {
  const pricing = usePricing();
  return React.createElement('output', {
    'data-status': pricing.status,
    'data-currency': pricing.currency ?? '',
  }, pricing.products.map((product) => product.id).join(','));
}

describe('billing preview provider', () => {
  it('serves the pricing fixture at the project products path', async () => {
    const previewFetch = vi.fn(createPreviewFetch({
      signedIn: true,
      consentRequired: false,
      primaryColor: '#F5B84C',
      configUnavailable: false,
      privacyEnabled: false,
      mfaEnrollment: false,
      wrongPassword: false,
      invalidCode: false,
      codePending: false,
      billing: 'allowed',
      pricing: 'one',
      checkout: 'redirect',
      portal: 'redirect',
    }));
    const core = createAuthOwlClient(resolveConfig({
      publishableKey: [
        'pk_live',
        '11111111-1111-1111-1111-111111111111',
        'abcdefghij0123456789',
      ].join('_'),
      apiUrl: 'https://auth.preview.test',
      fetch: previewFetch,
    }));
    let decodedInput: unknown;
    const request = clientExtension(core).requestProjectJson('/billing/products', {
      method: 'GET',
      timeoutMs: 1_000,
      maxResponseBytes: 100_000,
      decode(value) {
        decodedInput = value;
        return decodePricingCatalog(value);
      },
    });
    const result = await request;
    expect(decodedInput).toEqual(pricingCatalog('one'));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok).toBe(true);
    expect(previewFetch.mock.calls.at(-1)?.[0]).toBe(
      'https://auth.preview.test/api/projects/11111111-1111-1111-1111-111111111111/billing/products',
    );
  });

  it('delivers the selected catalog through the provider billing client', async () => {
    const child = React.createElement(PricingProbe);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    root.render(React.createElement(PreviewAuth, {
      locale: 'en',
      dark: false,
      billing: 'allowed',
      pricing: 'one',
      children: child,
    }));

    await vi.waitFor(() => {
      expect(container?.querySelector('output')?.getAttribute('data-status')).toBe('ready');
    });
    expect(container.querySelector('output')?.getAttribute('data-currency')).toBe('EGP');
    expect(container.querySelector('output')?.textContent).toBe('starter');
  });
});
