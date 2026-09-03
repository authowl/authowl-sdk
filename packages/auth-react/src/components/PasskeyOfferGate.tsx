'use client';
import * as React from 'react';
import { AuthOwlBadge } from './AuthOwlBadge';
import { PasskeyOffer } from './PasskeyOffer';
import { usePasskeyOffer } from './use-passkey-offer';

export type PasskeyOfferGateProps = {
  /** The signed-in application. Rendered untouched in every other state. */
  children: React.ReactNode;
  /** Optional heading override, matching the other gates. */
  title?: string;
};

/**
 * Offers a passkey once, just after a user starts a signed-in session having
 * arrived by some other method. Wrap your signed-in app, next to
 * <ConsentGate/> and <MFARequiredGate/>; it is free to wrap unconditionally.
 *
 * WHY A GATE AND NOT A STEP INSIDE <SignIn/>. The natural-looking design - show
 * the offer between a successful sign-in and the handoff - cannot work in the
 * documented embed. `<SignedOut>` unmounts `<SignIn/>` on the very store update
 * that makes the session usable, so by the time an offer could be rendered the
 * component that would render it is gone: the prompt never appears and the
 * sign-in handoff never completes. There is no post-success moment inside a
 * sign-in form. There is one here, on the side that survives.
 *
 * It also puts the checks where the answers exist. A sign-in form asks
 * "is this user 2FA-enrolled?" before any user is loaded, and gets `undefined` -
 * which reads as "no" and defeats the check entirely. On this side `useUser()`
 * is the real user.
 *
 * NEVER BLOCKS. Children render immediately and keep rendering while the checks
 * run; the offer replaces them only on confirmed evidence. This is an optional
 * convenience, so every uncertainty - config still loading, the passkey list
 * unreadable, storage refusing - resolves to "show the app". Blocking would add
 * another bootstrap blank-flash to a surface that already has one.
 */
export function PasskeyOfferGate({ children, title }: PasskeyOfferGateProps) {
  const { subject, shouldOffer, remember } = usePasskeyOffer();
  const [offering, setOffering] = React.useState(false);
  // One check per signed-in user, not one per render. Keyed by id so switching
  // account re-asks, and so a re-render mid-prompt cannot start a second check.
  const checked = React.useRef<string | null>(null);

  React.useEffect(() => {
    // ON MOUNT WHEN DUE, never on a signed-out -> signed-in transition. The
    // redirect flow lands here ALREADY signed in, so transition detection would
    // miss precisely the case this exists for. Re-asking after a reload is
    // bounded by the stored cool-off instead.
    if (subject === null || checked.current === subject) return;
    checked.current = subject;
    let cancelled = false;
    void shouldOffer().then((due) => {
      if (!cancelled && due) setOffering(true);
    });
    return () => {
      cancelled = true;
    };
  }, [subject, shouldOffer]);

  if (!offering) return <>{children}</>;

  return (
    <div className="ba-form" data-testid="passkey-offer-gate">
      <PasskeyOffer
        variant="sign-in"
        title={title}
        onComplete={(added) => {
          remember(added);
          setOffering(false);
        }}
      />
      <AuthOwlBadge />
    </div>
  );
}
