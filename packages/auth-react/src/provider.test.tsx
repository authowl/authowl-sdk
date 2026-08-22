// @vitest-environment jsdom
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthOwlProvider } from './provider';
import { usePublicConfig, useSession } from './hooks';
import { makePublicConfig } from './test-fixtures';

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
