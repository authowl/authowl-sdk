'use client';
import * as React from 'react';
import type { AuthPasskey } from '@authowl/core';
import { usePasskeys, useUser } from '../hooks';
import { useT, useServerError } from '../i18n';
import { useSubmitAction } from './use-submit-action';
import { Busy } from './Spinner';
import { FormError } from './FormError';

export type PasskeyManagerProps = {
  /** Heading text; pass `null` to render without a heading. */
  title?: string | null;
  /** Whether project policy permits registering a new passkey. */
  allowAdd?: boolean;
};

/**
 * Drop-in passkey management for the signed-in user: list, register, rename, and
 * remove passkeys. Requires an authenticated session.
 *
 * The stateful body is keyed on the user id: on an account switch React remounts
 * it, so any in-flight load or mutation from the previous user resolves against
 * an unmounted instance (a no-op) and can never surface stale errors, pending
 * state, or another account's passkeys on the new user's UI.
 */
export function PasskeyManager({ title, allowAdd = true }: PasskeyManagerProps = {}) {
  const t = useT();
  const { user, isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="ba-form" data-testid="passkey-manager-loading" aria-busy="true">
        <div className="ba-skeleton" />
      </div>
    );
  }
  if (!isSignedIn || !user) {
    return <p className="ba-muted">{t('passkeys.signedOut')}</p>;
  }
  return <PasskeyManagerBody key={user.id} title={title} allowAdd={allowAdd} />;
}

function PasskeyManagerBody({
  title,
  allowAdd,
}: {
  title: string | null | undefined;
  allowAdd: boolean;
}) {
  const t = useT();
  const toServerError = useServerError();
  // The underlying client hands back fresh method references per render (they are
  // proxy-fabricated, not stable), so read them through a ref - keying an effect
  // or useCallback on them would re-run every render (an infinite list refetch).
  const api = usePasskeys();
  const apiRef = React.useRef(api);
  apiRef.current = api;

  // Mutations share the loading/error envelope; the list load uses the same error
  // surface via `setError`.
  const { pending, error, setError, run } = useSubmitAction();
  const [passkeys, setPasskeys] = React.useState<AuthPasskey[] | null>(null);

  // Monotonic token so a slow load can never be overwritten by an older one that
  // resolves later (e.g. the initial load racing a post-mutation refresh).
  const loadTokenRef = React.useRef(0);

  // Never throws: success, `{ error }`, and rejection are all handled behind the
  // token guard, so a superseded load can neither set an error nor overwrite the
  // list.
  const load = React.useCallback(async (): Promise<void> => {
    const token = ++loadTokenRef.current;
    try {
      const res = await apiRef.current.listPasskeys();
      if (token !== loadTokenRef.current) return; // superseded by a newer load
      if (res?.error) {
        setError(toServerError(res.error, t('passkeys.error.loadFailed')));
        return;
      }
      setError(null); // clear any stale error now that the current load succeeded
      setPasskeys(res?.data ?? []);
    } catch {
      if (token !== loadTokenRef.current) return; // stale rejection - ignore
      setError(t('passkeys.error.loadFailed'));
    }
  }, [setError, toServerError, t]);

  // Fresh instance per user (keyed remount), so a single load on mount suffices.
  React.useEffect(() => {
    void load();
  }, [load]);

  function onRename(id: string, current?: string | null) {
    const name = window.prompt(t('passkeys.renamePrompt'), current ?? '')?.trim();
    if (!name) return; // cancelled or blank - do not rename to an empty label
    void run(() => apiRef.current.updatePasskey({ id, name }), {
      failure: t('passkeys.error.renameFailed'),
      onSuccess: load,
    });
  }

  function onRemove(id: string, current?: string | null) {
    const name = current?.trim() || t('passkeys.unnamed');
    if (!window.confirm(t('passkeys.removeConfirm', { name }))) return;
    void run(() => apiRef.current.deletePasskey({ id }), {
      failure: t('passkeys.error.removeFailed'),
      onSuccess: load,
    });
  }

  return (
    <div className="ba-form" data-testid="passkey-manager">
      {title !== null && <h2 className="ba-title">{title ?? t('passkeys.title')}</h2>}
      {passkeys === null ? (
        error ? null : <div className="ba-skeleton" />
      ) : (
        <ul className="ba-passkey-list">
          {(passkeys ?? []).map((pk) => (
            <li key={pk.id} className="ba-passkey-item">
              <span className="ba-passkey-name">{pk.name?.trim() || t('passkeys.unnamed')}</span>
              <span className="ba-passkey-actions">
                <button
                  type="button"
                  className="ba-link-button"
                  disabled={pending}
                  onClick={() => onRename(pk.id, pk.name)}
                >
                  {t('passkeys.rename')}
                </button>
                <button
                  type="button"
                  className="ba-link-button ba-danger"
                  disabled={pending}
                  onClick={() => onRemove(pk.id, pk.name)}
                >
                  {t('passkeys.remove')}
                </button>
              </span>
            </li>
          ))}
          {passkeys !== null && passkeys.length === 0 && (
            <li className="ba-muted">{t('passkeys.empty')}</li>
          )}
        </ul>
      )}
      {error && (
        <div className="ba-inline-error">
          <FormError>{error}</FormError>
          {passkeys === null && (
            <button className="ba-link-button" type="button" onClick={() => void load()}>
              {t('userProfile.retry')}
            </button>
          )}
        </div>
      )}
      {passkeys !== null && allowAdd && (
        <button
          className="ba-button"
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() =>
            void run(() => apiRef.current.addPasskey(), {
              failure: t('passkeys.error.addFailed'),
              onSuccess: load,
            })
          }
        >
          <Busy busy={pending} label={t('common.working')}>{t('passkeys.add')}</Busy>
        </button>
      )}
    </div>
  );
}
