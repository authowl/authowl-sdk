# React appearance migration (AO-58b)

Import the single generated stylesheet. It ships without a layer. Tailwind hosts
should import it in their components layer so utility classes in `elements` win:

```css
@import '@authowl/react/styles.css' layer(components);
```

```tsx
<AuthOwlProvider
  appearance={{
    theme: 'inherit',
    brand: 'billow',
    variables: {
      colorPrimary: '#0EA5A4',
      colorBackground: '#ffffff',
      colorText: '#18181b',
      colorTextSecondary: '#66666d',
      colorInputBackground: '#ffffff',
      colorInputText: '#18181b',
      colorBorder: '#d4d4d8',
      colorDanger: '#b91c1c',
      colorSuccess: '#15803d',
      borderRadius: '6px',
      controlHeight: '2rem',
      fontFamily: 'Inter, sans-serif',
    },
    elements: { card: 'my-shell', input: 'my-input', button: 'my-button' },
  }}
  {...config}
/>
```

All variable values are CSS strings. `variables.colorPrimary` takes precedence
over the deprecated `primaryColor`, which takes precedence over dashboard
branding. An explicit `brand` selects that product's palette instead of the
dashboard colour; an explicit primary colour overrides that selection. Supported
opaque colours are 3/6 digit hex, rgb(), hsl(), oklch(), and the names white,
black, red, blue, green and rebeccapurple. All supported primary formats derive
complete light and dark ramps synchronously in sRGB, including an AA label and active
colour. Unsupported colours (including alpha and relative colours) are dropped.
Billow can retain its existing `primaryColor: 'oklch(0.51 0.23 277)'` path, or
move to `appearance={{ brand: 'billow' }}` for the shared Billow palette without
a primary override. There is no runtime token package or font download.

Values must be a single supported colour, length/percentage, or font-family list
for the corresponding variable. Lengths also accept calc() sums/differences of
lengths. CSS substitutions, escapes, comments, declaration delimiters, URLs,
expression constructs, important flags and newlines are rejected in full on
both server and client, with one development warning per variable.

Theme precedence is `appearance.theme`, then `config.branding.theme`, then
`inherit`. **The default changed from `light` to `inherit`.** Set `theme: 'light'`
to retain the previous default. `inherit` follows the nearest host `.dark`
convention. Explicit light/dark ignore that convention, and `system` follows the
OS through a media query. `data-authowl-theme` remains available to host CSS;
An `<html data-authowl-theme="dark">` no longer forces SDK dark: that
attribute is root-scoped now. Set it through `appearance.theme`, or use host
`.dark` with `inherit`. `data-authowl-brand` identifies the selected product. Tokens only affect `.authowl-root`.

`ElementSlot` and `ELEMENT_SLOTS` are type-only slot definitions, with no runtime table. Each suffix is the
class name: `elements.input` appends classes after `ao-input ba-input`.
`slot('input', elements)` is also exported. Existing forms now carry `ao-card
ba-card` on their existing block box. This slice retains their current width,
padding, flex gaps and radii; it does not introduce the later card geometry.
Use `elements.card` to style a host shell. `controlHeight` accepts `2rem` for
compact hosts and sets border-box sizing on inputs. All geometry defaults remain
unchanged unless the host supplies an override.

Legacy classes and variable overrides remain supported for one major. The SDK
stylesheet declares no `--ba-*` variables or `.ba-*` selectors; its declarations
read legacy variables before new variables. The provider continues emitting
`--ba-primary` inline for existing integrations. Migrate before **2.0**, when
`.ba-*`, `--ba-*` compatibility and `primaryColor` are scheduled for removal.
Existing host `.ba-*` selectors still match every SDK class-bearing element.

| Legacy variable | Replacement |
| --- | --- |
| `--ba-primary` | `variables.colorPrimary` (or `--ao-primary` via the API) |
| `--ba-surface` | `--ao-surface` |
| `--ba-fg` | `--ao-fg` |
| `--ba-muted` | `--ao-muted` / `--ao-fg-muted` |
| `--ba-border` | `--ao-border` / `--ao-line-strong` |
| `--ba-divider` | `--ao-divider` / `--ao-line` |
| `--ba-hover` | `--ao-hover` / `--ao-highlight` |
| `--ba-skeleton-a` | `--ao-skeleton-a` |
| `--ba-skeleton-b` | `--ao-skeleton-b` |
| `--ba-success` | `--ao-success` |
| `--ba-danger-text` | `--ao-danger-text` / `--ao-danger` |
| `--ba-overlay` | `--ao-overlay` |
| `--ba-accent-solid` | `--ao-accent-solid` / `--ao-brand` |
| `--ba-accent-solid-hover` | `--ao-accent-solid-hover` / `--ao-brand-hover` |
| `--ba-accent-solid-active` | `--ao-accent-solid-active` / `--ao-brand-active` |
| `--ba-accent-fg` | `--ao-accent-fg` / `--ao-on-brand` |
| `--ba-accent` | `--ao-accent` / `--ao-brand-text` |
| `--ba-rt-solid-hover-l`, `--ba-rt-solid-hover-d` | `--ao-light-brand-hover`, `--ao-dark-brand-hover` |
| `--ba-rt-solid-active-l`, `--ba-rt-solid-active-d` | `--ao-light-brand-active`, `--ao-dark-brand-active` |
| `--ba-rt-accent-l`, `--ba-rt-accent-d` | `--ao-light-brand-text`, `--ao-dark-brand-text` |
| `--ba-rt-accent-fg` | `--ao-light-on-brand`, `--ao-dark-on-brand` |

Use the appearance API for a primary colour rather than assigning `--ao-primary`
alone: it emits the full scheme ramps. Low-level scheme variables must be set
on `.authowl-root`; custom properties resolve where they are declared. Keep any
existing legacy overrides until their new equivalents have been applied there.

Hitsend should import the stylesheet with `layer(components)` as above, then use
its utilities on the slots and the compact height explicitly:

```tsx
appearance={{
  brand: 'hitsend',
  variables: { controlHeight: '2rem' },
  elements: {
    input: 'h-8 rounded-md px-3',
    button: 'h-8 rounded-md px-3',
    title: 'hidden',
  },
}}
```

`elements.title` replaces Hitsend's old title `display:none` rule. Without
`controlHeight`, input sizing follows the host's existing box-sizing reset.
A CSS-only legacy `--ba-primary` override still drives hover, active, accent
and focus colours before token-brand fallbacks. Prefer the provider colour API
for computed contrast labels and complete perceptual ramps.

Numeric one-time codes now render one real text input over aria-hidden visual
cells. The input retains numeric input mode and one-time-code autofill. Replace
numeric `.ba-input` styling with the `code-control`, `code-input`, `code-cells`
and `code-cell` element slots. Cells always run left to right, including Arabic.
A complete code submits automatically; pending actions lock entry, and a failed
value does not auto-retry until edited. Backup codes retain a plain text input
and manual submission. MFA's other-factor link buttons are now pill chips,
styled through `factor-chip`, in the `factor-options` section.


UserProfile now has four navigation groups: Profile (profile and email), Security
(password, passkeys, MFA, recovery and sessions), Connected accounts (social),
and Privacy (privacy rights and account deletion). Unavailable sections and empty
groups are omitted. `section`, `defaultSection` and `onSectionChange` still use
the ten existing section identifiers. Every `#authowl-profile-<section>` URL
selects its group, opens the requested row and focuses that section heading. Navigation writes the first
available section hash in the selected group.

DOM changes in the unreleased React major: `.ao-profile-nav-item` is now an anchor
with `aria-current="page"`; it replaces the old per-section buttons. The 184px
sidebar starts with `.ao-profile-identity`, containing the shared Avatar, name
and email when present. Avatar now uses one first grapheme of the trimmed name,
then email, then a neutral glyph. UserButton uses the same Avatar. Provider images
use `referrerPolicy="no-referrer"` and fall back on load failure. At container
widths of 640px or less, the identity is hidden and links form a horizontally
scrollable row. The content carries `data-group` as well as
the existing `data-section`, and contains all available sections of that group.
Group changes remount `.ao-profile-content.ao-step` for the token-based entrance;
hash changes within the same group preserve other open forms. Initial `section`
and `defaultSection` requests open the requested row. Nav clicks and later
controlled `section` changes land collapsed; controlled changes focus the new
section heading without moving focus on the first render.

Section summaries use their focusable h2 as the row title; the former duplicate
uppercase heading is removed. Sessions and Social retain uppercase list headings.
The modal group title is h2 so only the dialog title remains h1. Page mode no
longer renders the global h1 and description; hosts needing that introduction
should supply it. The active group retains its own title and subtitle.

Section summaries use `profile-section-title` for lists, `profile-row`, `profile-icon`,
`profile-icon-svg`, `profile-row-copy`, `profile-row-title`, `profile-row-meta`,
`profile-row-button` and `profile-row-body` slots. Edit/Manage opens the existing
workflow inline; closing the summary unmounts the workflow and clears its local
inputs, cancels parked step-up actions and invalidates late verification callbacks.
The open-state action now reads Close (`common.close`), while confirmation forms
keep their Cancel actions. Session and social row buttons now use
`profile-row-button`. The former `profile-list-item`, `profile-row-copy` descendant
rules, `profile-provider-actions`, `profile-subtitle` and
`profile-danger-zone` CSS are removed. Delete account uses the shared row instead
of the former danger-zone wrapper. The PrivacyCenter mounts only when its row
opens, so its requests begin on demand. It receives `title={null}` because the
row owns its title and description; standalone PrivacyCenter keeps its header.
Forms and their security gates retain their existing classes and test IDs. Host
selectors that assume a directly visible form or one section per page must be
updated. Additional slots are `profile-identity`, `profile-identity-copy`,
`profile-avatar`, `profile-group-heading`, `profile-group-title`,
`profile-group-subtitle`, `profile-row-heading`, `profile-pill`,
`profile-pill-success` and `profile-icon-success`. All slots emit both `ao-` and
`ba-` classes.

Only UserProfile's SDK-owned modal becomes a bottom sheet at viewport widths of
480px or less (previously 680px). The `.ao-profile-modal` surface has full width,
top corner radii,
a 92dvh maximum height, contained overscroll, no bottom border, internal scrolling
and safe-area padding. The `profile-sheet-handle` slot is decorative and visible only on phones. Larger
viewports keep the centered dialog. Inline page layout belongs to the host.
