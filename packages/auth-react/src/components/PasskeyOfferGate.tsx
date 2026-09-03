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
 * which reads as "no" and defeats the check entirely. On this side the user is
 * real. {@link usePasskeyOffer} owns which checks those are and why.
 *
 * NEVER BLOCKS. Children render immediately and keep rendering while the checks
 * run; the offer replaces them only on confirmed evidence. This is an optional
 * convenience, so every uncertainty - config still loading, the passkey list
 * unreadable, storage refusing - resolves to "show the app". Blocking would add
 * another bootstrap blank-flash to a surface that already has one.
 */
export function PasskeyOfferGate({ children, title }: PasskeyOfferGateProps) {
  const { subject, shouldOffer, remember } = usePasskeyOffer();
  // WHO the offer is for, not merely THAT there is one. A bare boolean cannot
  // be wrong about the second thing, and it was: the check was keyed by user
  // while its result was not, so an in-place account switch - a second tab
  // signing in as someone else, which propagates here without an unmount -
  // re-rendered the first user's offer for the second, before that person had
  // been checked at all. Their answer then arrived and was discarded, because a
  // bare flag can only ever be turned ON.
  const [offerFor, setOfferFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    // ON MOUNT WHEN DUE, never on a signed-out -> signed-in transition. The
    // redirect flow lands here ALREADY signed in, so transition detection would
    // miss precisely the case this exists for. Re-asking after a reload is
    // bounded by the stored cool-off instead.
    //
    // The deps already give one check per user: `shouldOffer` only changes
    // identity when `subject` does. StrictMode double-invokes in development
    // and costs one extra request there, which is not worth a ref to avoid.
    if (subject === null) return;
    let cancelled = false;
    void shouldOffer().then((due) => {
      // Recorded against the subject asked about, so a late answer cannot
      // attach to whoever is signed in by the time it lands - and so a "no"
      // can close a stale offer instead of only ever opening one.
      if (!cancelled) setOfferFor(due ? subject : null);
    });
    return () => {
      cancelled = true;
    };
  }, [subject, shouldOffer]);

  // Both clauses are load-bearing: with `offerFor !== subject` alone, two nulls
  // would compare equal and render the offer to nobody.
  if (subject === null || offerFor !== subject) return <>{children}</>;

  return (
    <div className="ba-form" data-testid="passkey-offer-gate">
      <PasskeyOffer
        variant="sign-in"
        title={title}
        onComplete={(added) => {
          remember(added);
          setOfferFor(null);
        }}
      />
      <AuthOwlBadge />
    </div>
  );
}
