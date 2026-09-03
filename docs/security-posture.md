# Security posture

AuthOwl exposes a project-level security posture as one named bundle. The
current postures are:

- `standard`: normal session and recovery behavior.
- `high_assurance`: shorter OAuth refresh limits, no remembered MFA devices,
  and no recovery of a TOTP challenge by emailed code.

The server is the enforcement boundary. SDK capability flags only keep the
interface aligned with that policy. A direct request cannot restore a control
that the selected posture disables.

## React challenge behavior

`<MFAChallenge />` reads these additive fields from `PublicConfig.mfa`:

```ts
type MfaCapabilities = {
  emailOtpFallback?: boolean;
  trustDevice?: boolean;
}
```

When either field is `false`, the corresponding recovery or remembered-device
control is not rendered. Missing fields default to `true` for compatibility
with servers released before the posture contract. The server still validates
every request.

`<MFAChallenge variant="step-up" />` is the same prompt used to re-prove a
factor while already signed in, for the actions that would weaken it. It reads
the same capability fields, but never offers the remembered-device checkbox at
any posture: the server's full-session branch mints no session, so it has no
trust to grant. `useStepUpAction` drives it.

`allowTrustDevice={false}` can make an application stricter than the project,
but it cannot override a server value of `trustDevice: false`.

## Recovery under high assurance

Users recover with a single-use backup code. If none remains, an authorized
operator must perform the audited MFA reset. Applications should explain that
ladder before enabling high assurance and should prompt users to store backup
codes when TOTP is enrolled.

## Release policy

The bundle may tighten in a future AuthOwl release as security guidance
changes. Any such change is documented in that release. Applications that need
stable custom behavior should consume the capability flags rather than infer
rules from the posture name.
