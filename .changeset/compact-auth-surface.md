---
'@authowl/react': major
'@authowl/core': minor
---

Refresh SignIn and SignUp with compact token-based cards, accessible method tabs, social last-used hints, and reduced-motion-aware feedback. Add English and Arabic subtitles, method labels, and last-used copy.

DOM and rendering contract changes for the migration guide:

- The stacked `ba-button-secondary` sign-in alternates are gone. Methods are tabs now.
- Social buttons show the bare provider name as visible text. Their accessible name is the localized "Continue with <provider>" for SignIn or "Sign up with <provider>" for SignUp ("Redirecting..." while pending).
- Phone sign-in is a secondary link styled with `ba-link-button` rather than a button styled as an alternate action. It retains native button semantics.
- A new `.ba-subtitle` renders under the title.
- The exported `useLastUsedSignInMethod` returns null on the first render and resolves after mount.
- The passkey tab uses a filled primary button.
- At widths of 480px or less, controls grow to 48px and inputs use 16px text. Nothing changes the host page layout.

- Inside a card, `.ba-spinner` renders as three dots built from `::before` and `::after`. Host CSS targeting `.ba-spinner` affects these dots. Under reduced motion the spinner is static rather than slowed.
- The default tab follows the last-used method after mount.
- Every step change remounts the card subtree.
- Social buttons, tabs and method switches are disabled while any method is pending. Back and Change email remain enabled.
- The email field is hidden on the Passkey tab, while conditional mediation remains armed.
- The passkey tab shows a compact info panel and the email-code tab shows a short helper line below the email field.
- When branding shows the app name, the form heading names it ("Sign in to {app}", "Create your {app} account") and the header shows only the mark beside the heading, with the environment label at the inline end. `.ba-branding` is `display: contents` inside `.ba-auth-header`, and `.ba-branding-name` is hidden there.

The unreleased @authowl/react major includes AO-58(d). DOM-contract changes for the migration guide:

- Numeric one-time codes use one real input positioned over aria-hidden cells. The input stays read-only while a request is pending, preserving focus, and is disabled on success. Style the code slots instead of targeting a numeric .ba-input.
- MFA other-factor link buttons become pill chips whose accessible names match their visible factor labels. Backup codes keep a plain text input.
- `MFAChallengeProps.email` is a new public optional prop for the known emailed-code destination before a session exists. Username sign-in uses generic destination copy.
- Verify is hidden in numeric code modes, shown in backup-code mode, and shown after a non-code verification failure so a numeric keypad user can retry.
- Complete numeric codes auto-submit through the verification action. Pending requests lock the card until the completion handoff settles, and failed values do not auto-retry until edited. Full-length pastes replace the field, and failed codes are selected for replacement.
- Successful codes use token-based cell feedback and a drawn check, without delaying finish or redirect.

New appearance element slots for AO-58(d): `code-input`, `code-control`, `code-cells`, `code-cell`, `code-check`, `code-check-path`, `code-status`, `code-verifying`, `factor-form`, `factor-options`, `factor-chips`, `factor-chip`, `factor-header`, `factor-subtitle`, and `factor-trust`. Every slot emits both `ao-` and `ba-` class names.
