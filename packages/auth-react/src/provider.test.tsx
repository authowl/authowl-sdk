// @vitest-environment jsdom
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthOwlProvider } from './provider';
import { useSession } from './hooks';

const PK = 'pk_live_11111111-1111-1111-1111-111111111111_abcdefghij0123456789';
const API_URL = 'https://auth.example.com';
// Never-resolving fetch: the appearance ramp comes from the PROP synchronously,
// so we don't need (or want) the public-config effect to settle in this test.
const fetchNever = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

afterEach(cleanup);

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
    expect(root.style.getPropertyValue('--ba-rt-accent-l')).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue('--ba-rt-solid-hover-d')).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue('--ba-rt-accent-fg')).toBe('#18181b');
  });

  it('emits no brand vars when no color is set (host --ba-primary override stays in control)', () => {
    const { container } = render(
      <AuthOwlProvider publishableKey={PK} apiUrl={API_URL} fetch={fetchNever}>
        <div />
      </AuthOwlProvider>,
    );
    const root = container.querySelector('.authowl-root') as HTMLElement;
    expect(root.style.getPropertyValue('--ba-primary')).toBe('');
    expect(root.style.getPropertyValue('--ba-rt-accent-l')).toBe('');
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
});
