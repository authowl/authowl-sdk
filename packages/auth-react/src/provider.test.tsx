// @vitest-environment jsdom
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthOwlProvider } from './provider';
import { usePublicConfig, useSession } from './hooks';
import { makePublicConfig } from './test-fixtures';
import type { Appearance } from './appearance';
import { SignIn } from './components/SignIn';
import { SignUp } from './components/SignUp';
import { StepCard } from './components/StepCard';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const API_URL = 'https://auth.example.com';
// Never-resolving fetch: the appearance ramp comes from the PROP synchronously,
// so we don't need (or want) the public-config effect to settle in this test.
const fetchNever = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

afterEach(cleanup);

it.each([
  [undefined, null],
  [{}, null],
  [{ layout: {} }, null],
  [{ layout: { mobileSheet: false } }, null],
  [{ layout: { mobileSheet: true } }, 'sheet'],
] satisfies [Appearance | undefined, string | null][])('emits the phone layout only when opted in: %j', (appearance, layout) => {
  const node = <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}
    locale="en" appearance={appearance}><span>auth</span></AuthOwlProvider>;
  const html = renderToString(node);
  const { container } = render(node);
  expect(container.querySelector('.authowl-root')?.getAttribute('data-authowl-layout')).toBe(layout);
  if (layout) {
    expect(html).toContain('data-authowl-layout="sheet"');
  } else {
    expect(html).toBe('<div class="authowl-root" data-authowl-theme="inherit" data-authowl-brand="authowl" data-authowl-locale="en" dir="ltr" style="display:contents"><span>auth</span></div>');
  }
});

it.each([{ name: 'SignIn', Component: SignIn }, { name: 'SignUp', Component: SignUp }])(
  'preserves $name SSR markup when the phone sheet is off', ({ Component }) => {
    const markup = (appearance?: Appearance) => renderToString(
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever} appearance={appearance}>
        <Component showBranding={false} showBadge={false} />
      </AuthOwlProvider>,
    );
    const baseline = markup();
    expect(baseline).not.toContain('auth-sheet-handle');
    expect(markup({ layout: {} })).toBe(baseline);
    expect(markup({ layout: { mobileSheet: false } })).toBe(baseline);
    expect(markup({ layout: { mobileSheet: true } })).toContain('class="ao-auth-sheet-handle ba-auth-sheet-handle" aria-hidden="true"');
  },
);

it.each(['form', 'forgot', 'otp-code', 'mfa', 'error', 'waitlist'])(
  'keeps the opt-in sheet shell and decorative handle on the %s step', (step) => {
    const html = renderToString(
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}
        appearance={{ layout: { mobileSheet: true }, elements: { 'auth-sheet-handle': 'host-handle' } }}>
        <StepCard lock={{ locked: false, setPending: () => undefined }} step={step} kind="signIn"
          stepRef={null} showBranding={false} showBadge={false}>Step content</StepCard>
      </AuthOwlProvider>,
    );
    expect(html).toContain('ao-auth-sheet ba-auth-sheet');
    expect(html).toContain('class="ao-auth-sheet-handle ba-auth-sheet-handle host-handle" aria-hidden="true"');
  },
);

describe('AuthOwlProvider brand ramp emission', () => {
  it('carries --ba-primary + the derived --ba-rt-* bridge vars on the wrapper style', () => {
    const { container } = render(
      <AuthOwlProvider
        publishableKey={PK}
        apiUrl={API_URL}
        fetch={fetchNever}
        appearance={{ primaryColor: '#F5B84C' }}
      >
        <div />
      </AuthOwlProvider>,
    );
    const root = container.querySelector('.authowl-root') as HTMLElement;
    expect(root).not.toBeNull();
    // This is the regression the silent-prop-shadow class of bugs would hit: the
    // resolved ramp must actually reach the wrapper's inline style attribute.
    expect(root.style.getPropertyValue('--ba-primary')).toBe('#F5B84C');
    expect(root.style.getPropertyValue('--ao-light-brand-text')).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue('--ao-dark-brand-hover')).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue('--ao-light-on-brand')).toBe('#18181b');
  });

  it('emits no brand vars when no color is set (host --ba-primary override stays in control)', () => {
    const { container } = render(
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}>
        <div />
      </AuthOwlProvider>,
    );
    const root = container.querySelector('.authowl-root') as HTMLElement;
    expect(root.style.getPropertyValue('--ba-primary')).toBe('');
    expect(root.style.getPropertyValue('--ao-light-brand-text')).toBe('');
  });

  it('reads the framework-neutral pending snapshot during SSR without fetching', () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    function SessionProbe() {
      return <span>{useSession().isPending ? 'pending' : 'ready'}</span>;
    }
    const html = renderToString(
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchSpy}>
        <SessionProbe />
      </AuthOwlProvider>,
    );
    expect(html).toContain('<span>pending</span>');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets a failed public-config request be retried without remounting the provider', async () => {
    const projectId = '11111111-1111-1111-1111-111111111111';
    const config = makePublicConfig({
      environmentId: projectId,
      environmentType: 'production',
      authBaseUrl: `${API_URL}/api/projects/${projectId}/auth`,
    });
    let publicConfigCalls = 0;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/public-config')) {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      publicConfigCalls += 1;
      if (publicConfigCalls === 1) throw new TypeError('network unavailable');
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    function ConfigProbe() {
      const { config: loaded, isLoading, isError, retry } = usePublicConfig();
      if (isLoading) return <span>loading</span>;
      if (isError) return <button onClick={retry}>retry</button>;
      return <span>{loaded?.environmentId}</span>;
    }

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchSpy}>
        <ConfigProbe />
      </AuthOwlProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByText(projectId)).toBeTruthy());
    expect(publicConfigCalls).toBe(2);
    warning.mockRestore();
  });
});

it('renders theme, brand, variables and element classes in SSR HTML without fetching', async () => {
  const { FormError } = await import('./components/FormError');
  const fetchSpy = vi.fn() as unknown as typeof fetch;
  const html = renderToString(
    <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchSpy}
      appearance={{ theme: 'system', brand: 'hitsend', variables: { colorPrimary: '#123456', controlHeight: '2rem' }, elements: { error: 'host-error' } }}>
      <FormError>Wrong password</FormError>
    </AuthOwlProvider>,
  );
  expect(html).toContain('data-authowl-theme="system"');
  expect(html).toContain('data-authowl-brand="hitsend"');
  expect(html).toContain('--ao-light-brand:#123456');
  expect(html).toContain('--ao-dark-brand:#123456');
  expect(html).toContain('--ao-control-height:2rem');
  expect(html).toContain('ao-error ba-error host-error');
  expect(fetchSpy).not.toHaveBeenCalled();
});

it.each([
  'white;display:block;position:fixed', 'white{}', '<style>', 'white\\3b',
  'white/*comment*/', 'white!important', 'url(https://example.com)',
  'expression(alert(1))', 'white\n', 'white\r',
])('drops the entire unsafe value on server and client: %j', value => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const node = <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}
    appearance={{ primaryColor: value, variables: { colorPrimary: value, colorText: value, controlHeight: value, borderRadius: value, fontFamily: value } }}><div /></AuthOwlProvider>;
  const html = renderToString(node);
  expect(html).toContain('style="display:contents"');
  expect(html).not.toContain('--ao-');
  expect(html).not.toContain('--ba-');
  expect(html).not.toContain('data-authowl-control-height');
  const { container } = render(node);
  expect(container.querySelector('.authowl-root')?.getAttribute('style')).toBe('display: contents;');
  warning.mockRestore();
});

it('warns only once per invalid variable in development', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const node = <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}
    appearance={{ variables: { colorSuccess: 'green;display:none' } }}><div /></AuthOwlProvider>;
  renderToString(node);
  render(node);
  expect(warning).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

it.each(['white', 'rgb(14, 165, 164)', 'hsl(180 80% 35%)', 'oklch(0.51 0.23 277)'])('emits complete non-hex ramps on server and client for %s', primaryColor => {
  const node = <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}
    appearance={{ brand: 'billow', primaryColor }}><div /></AuthOwlProvider>;
  const html = renderToString(node);
  const { container } = render(node);
  const root = container.querySelector('.authowl-root') as HTMLElement;
  for (const scheme of ['light', 'dark']) {
    for (const token of ['brand', 'brand-hover', 'brand-active', 'on-brand', 'brand-text', 'ring']) {
      const name = `--ao-${scheme}-${token}`;
      const value = root.style.getPropertyValue(name);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
      expect(html).toContain(`${name}:${value}`);
    }
  }
});
