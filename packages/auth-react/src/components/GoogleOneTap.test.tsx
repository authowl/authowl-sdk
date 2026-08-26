// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetGoogleOneTapRuntimeForTests } from './google-one-tap';

type CredentialResponse = { credential?: string };
type Moment = {
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
};
type TestGoogleWindow = Window & {
  google?: {
    accounts: {
      id: {
        initialize: (options: Record<string, unknown>) => void;
        prompt: (listener?: (moment: Moment) => void) => void;
        cancel: () => void;
      };
    };
  };
};

const mocks = vi.hoisted(() => {
  const user = {
    id: 'user-google',
    email: 'mona@example.test',
    emailVerified: true,
    name: 'Mona',
    image: null,
    createdAt: new Date('2026-07-14T08:00:00.000Z'),
    updatedAt: new Date('2026-07-14T08:00:00.000Z'),
  };
  return {
    user,
    sessionUser: null as typeof user | null,
    config: {
      socialProviders: ['google'] as string[],
      socialProviderClientIds: {
        google: 'google-client.apps.googleusercontent.com',
      } as Record<string, string>,
    },
    configLoading: false,
    configError: false,
    sessionLoaded: true,
    signInSocial: vi.fn(async (): Promise<{
      data: { redirect: boolean; user?: typeof user } | null;
      error: { status?: number; code?: string } | null;
    }> => ({ data: { redirect: false, user }, error: null })),
    initialize: vi.fn(),
    prompt: vi.fn(),
    cancel: vi.fn(),
    credentialCallback: null as ((response: CredentialResponse) => void) | null,
    momentListener: null as ((moment: Moment) => void) | null,
  };
});

vi.mock('../hooks', () => ({
  usePublicConfig: () => ({
    config: mocks.config,
    isLoading: mocks.configLoading,
    isError: mocks.configError,
  }),
  useUser: () => ({
    user: mocks.sessionUser,
    isLoaded: mocks.sessionLoaded,
    isSignedIn: mocks.sessionUser !== null,
    needsMfaEnrollment: false,
    error: null,
  }),
  useSignIn: () => ({ signInSocial: mocks.signInSocial }),
}));

import { GoogleOneTap } from './GoogleOneTap';

function installGoogleApi() {
  mocks.initialize.mockImplementation((options: Record<string, unknown>) => {
    mocks.credentialCallback = options.callback as (response: CredentialResponse) => void;
  });
  mocks.prompt.mockImplementation((listener?: (moment: Moment) => void) => {
    mocks.momentListener = listener ?? null;
  });
  (window as TestGoogleWindow).google = {
    accounts: {
      id: {
        initialize: mocks.initialize,
        prompt: mocks.prompt,
        cancel: mocks.cancel,
      },
    },
  };
}

describe('GoogleOneTap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGoogleOneTapRuntimeForTests();
    mocks.sessionUser = null;
    mocks.config.socialProviders = ['google'];
    mocks.config.socialProviderClientIds = {
      google: 'google-client.apps.googleusercontent.com',
    };
    mocks.configLoading = false;
    mocks.configError = false;
    mocks.sessionLoaded = true;
    mocks.credentialCallback = null;
    mocks.momentListener = null;
    mocks.signInSocial.mockResolvedValue({
      data: { redirect: false, user: mocks.user },
      error: null,
    });
    installGoogleApi();
  });

  afterEach(() => {
    cleanup();
    resetGoogleOneTapRuntimeForTests();
    delete (window as TestGoogleWindow).google;
  });

  it('initializes once and exchanges the Google credential through AuthOwl', async () => {
    const onSignedIn = vi.fn();
    render(<GoogleOneTap nonce="attempt-nonce" autoSelect onSignedIn={onSignedIn} />);

    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1));
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'google-client.apps.googleusercontent.com',
        nonce: 'attempt-nonce',
        auto_select: true,
        cancel_on_tap_outside: true,
      }),
    );

    mocks.credentialCallback?.({ credential: 'google.jwt.credential' });
    await waitFor(() =>
      expect(mocks.signInSocial).toHaveBeenCalledWith({
        provider: 'google',
        disableRedirect: true,
        idToken: { token: 'google.jwt.credential', nonce: 'attempt-nonce' },
      }),
    );
    expect(onSignedIn).toHaveBeenCalledWith(mocks.user);
  });

  it('keeps one prompt through the development StrictMode mount cycle', async () => {
    render(
      <React.StrictMode>
        <GoogleOneTap />
      </React.StrictMode>,
    );
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1));
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });

  it('does not load Google when disabled, signed in, or unavailable for the project', async () => {
    const onSkipped = vi.fn();
    const first = render(<GoogleOneTap disabled onSkipped={onSkipped} />);
    await waitFor(() => expect(onSkipped).toHaveBeenCalledWith('disabled'));
    expect(mocks.initialize).not.toHaveBeenCalled();
    first.unmount();

    mocks.sessionUser = mocks.user;
    const second = render(<GoogleOneTap onSkipped={onSkipped} />);
    await waitFor(() => expect(onSkipped).toHaveBeenCalledWith('existing_session'));
    expect(mocks.initialize).not.toHaveBeenCalled();
    second.unmount();

    mocks.sessionUser = null;
    mocks.config.socialProviders = [];
    render(<GoogleOneTap onSkipped={onSkipped} />);
    await waitFor(() => expect(onSkipped).toHaveBeenCalledWith('provider_disabled'));
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('reports public-config and missing-client-id failures without loading Google', async () => {
    const onError = vi.fn();
    mocks.configError = true;
    const first = render(<GoogleOneTap onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith({ code: 'public_config_unavailable' }));
    first.unmount();

    mocks.configError = false;
    mocks.config.socialProviderClientIds = {};
    render(<GoogleOneTap onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith({ code: 'missing_client_id' }));
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('surfaces skipped, dismissed, and credential-exchange failures as typed callbacks', async () => {
    const onSkipped = vi.fn();
    const onDismissed = vi.fn();
    const onError = vi.fn();
    mocks.signInSocial.mockResolvedValueOnce({
      data: null,
      error: { status: 401, code: 'INVALID_ID_TOKEN' },
    });
    render(
      <GoogleOneTap onSkipped={onSkipped} onDismissed={onDismissed} onError={onError} />,
    );
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalled());

    mocks.momentListener?.({ isSkippedMoment: () => true });
    expect(onSkipped).toHaveBeenCalledWith('prompt_skipped');
    mocks.momentListener?.({
      isSkippedMoment: () => false,
      isDismissedMoment: () => true,
      getDismissedReason: () => 'tap_outside',
    });
    expect(onDismissed).toHaveBeenCalledWith('tap_outside');

    mocks.credentialCallback?.({ credential: 'rejected.jwt' });
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith({
        code: 'credential_exchange_failed',
        status: 401,
        authCode: 'INVALID_ID_TOKEN',
      }),
    );
  });

  it('cancels on unmount and suppresses the cancellation moment callback', async () => {
    const onDismissed = vi.fn();
    mocks.cancel.mockImplementation(() => {
      mocks.momentListener?.({
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel_called',
      });
    });
    const view = render(<GoogleOneTap onDismissed={onDismissed} />);
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalled());

    view.unmount();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('reports script loading failure', async () => {
    delete (window as TestGoogleWindow).google;
    const onError = vi.fn();
    render(<GoogleOneTap onError={onError} />);
    const script = await waitFor(() => {
      const found = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    script.dispatchEvent(new Event('error'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith({ code: 'script_load_failed' }));
  });

  it('rejects conflicting remount configuration instead of reinitializing Google', async () => {
    const first = render(<GoogleOneTap nonce="first" />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    first.unmount();

    const onError = vi.fn();
    render(<GoogleOneTap nonce="second" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith({ code: 'configuration_conflict' }));
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });
});


/**
 * The safe path is opt-in, so the only thing standing between a developer and a
 * replayable ID token is knowing the prop exists. A dev-only warning is what
 * tells them - and it must stay quiet once they have done it, or it trains
 * people to ignore console output.
 *
 * Each case uses its own client id because the warning dedupes per id, which is
 * also what the last case checks.
 */
describe('missing nonce', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  function useClientId(id: string) {
    mocks.config.socialProviderClientIds = { google: id };
  }
  function warnedAboutNonce(): boolean {
    return warn.mock.calls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('without a `nonce`'),
    );
  }

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('warns when One Tap runs without binding the token to this attempt', async () => {
    useClientId('no-nonce.apps.googleusercontent.com');
    render(<GoogleOneTap />);
    await waitFor(() => expect(warnedAboutNonce()).toBe(true));
    const message = warn.mock.calls.find((call) => `${call[0]}`.includes('nonce'))?.[0];
    // The warning has to say what goes wrong, not just what is missing.
    expect(message).toContain('replayed');
  });

  it('stays quiet once a nonce is supplied', async () => {
    useClientId('with-nonce.apps.googleusercontent.com');
    render(<GoogleOneTap nonce="per-attempt-value" />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    expect(warnedAboutNonce()).toBe(false);
  });

  it('says nothing when the component is not going to prompt at all', async () => {
    // A disabled component has no token to bind, so a warning would be noise.
    useClientId('disabled.apps.googleusercontent.com');
    const onSkipped = vi.fn();
    render(<GoogleOneTap disabled onSkipped={onSkipped} />);
    // Wait on what a disabled mount definitely does, rather than on the absence
    // of something another test may already have caused.
    await waitFor(() => expect(onSkipped).toHaveBeenCalledWith('disabled'));
    expect(warnedAboutNonce()).toBe(false);
  });

  it('warns once per client id, not once per mount', async () => {
    useClientId('repeated.apps.googleusercontent.com');
    const first = render(<GoogleOneTap />);
    await waitFor(() => expect(warnedAboutNonce()).toBe(true));
    first.unmount();

    warn.mockClear();
    render(<GoogleOneTap />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    expect(warnedAboutNonce()).toBe(false);
  });
});
