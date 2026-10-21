# AO-58(b) screenshot colour declaration

Every state below applies to **en-light, en-dark, ar-light and ar-dark**.
No geometry change is intended. The Storybook main canvas stays unchanged.
Legacy story surface variables now fall back to their new SDK counterparts, so
cards continue painting the same layer instead of losing their background.

| Story file | Every exported state | Intended colour differences |
| --- | --- | --- |
| GoogleOneTap.stories.tsx | ExistingSession | No expected change: existing-session copy and its frame use host colours; Google UI is suppressed. |
| MFAChallenge.stories.tsx | Totp, BackupCode | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. |
| MFAEnrollment.stories.tsx | Password, ScanQrAndBackupCodes, Enrolled | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. Success text changes where visible. |
| Organizations.stories.tsx | Switcher, Directory, Create, General, Members, Invitations, DangerZone | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. DangerZone changes destructive borders/fill/hover; badges use the token success colour. |
| PasskeyButton.stories.tsx | Default | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. |
| PrivacyCenter.stories.tsx | Default | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. |
| ResetPassword.stories.tsx | Default | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. |
| SignIn.stories.tsx | Default, ConfigurationUnavailable, ForgotPassword, PasswordOnly, EmailCodeOnly, EmailLinkOnly, PasskeyOnly, PhoneOnly, SsoOnly, EmailCodeSent, MagicLinkSent, PhoneEntry, PhoneCode, WrongPassword | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. WrongPassword also changes error red to AA danger; ConfigurationUnavailable uses the same AA error token. |
| SignUp.stories.tsx | Default, ConsentRequired, PrivacyEvidence | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. |
| Tokens.stories.tsx | AuthOwl, Billow, Hitsend | No expected change: these swatches already use the token palette and their own brand/scheme scopes. |
| UserProfile.stories.tsx | Profile, Email, Password, SocialConnections, Sessions, Passkeys, MultiFactor, Recovery, Privacy, DangerZone, Modal, WhiteBrandBoundary, BlackBrandBoundary | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. DangerZone changes destructive borders/fill/hover; WhiteBrandBoundary and BlackBrandBoundary retain their explicit primary ramps but change shared neutrals. |
| VerifyEmail.stories.tsx | Success | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. Success text changes where visible. |
| Waitlist.stories.tsx | Default | Shared neutral palette: text, borders, hover/selected fills, skeletons and dark surfaces where present. Primary hex ramps are retained by PreviewAuth. Success text changes where visible. |

The shared neutral colours move from the old zinc literals to the token OKLCH
palette. Light surface stays white. Dark surface, text, muted text, dividers,
borders, hover/selected fills, skeletons, success text and destructive colours can
change wherever visible. Existing shadow geometry and opacity stay unchanged.

PreviewAuth supplies explicit #F5B84C (or the white/black boundary colour), so its
hex brand ramp, label, hover and active colours remain the same. SDK users without
an explicit primary colour now get the generated AuthOwl brand picks (including
its darker gold label and token hover); selecting Billow or Hitsend uses those
products' two scheme ramps. None of the current component stories selects those
brands. Foundations/Tokens already showcases all three palettes.

The WrongPassword story now enforces a11y instead of opting out. Other existing
error states also use the AA danger token. Default theme inheritance does not
change this matrix because PreviewAuth explicitly supplies light or dark.

Canonical screenshots and browser a11y were not run here: Docker is unavailable
and the sandbox denies Chromium's Mach bootstrap registration. Regenerate only
after triage with AUTHOWL_SCREENSHOT_THRESHOLD=0. No baseline files were edited.
