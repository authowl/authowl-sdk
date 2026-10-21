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
dashboard colour; an explicit primary colour overrides that selection. Hex
primary colours derive both light and dark ramps in the server HTML. Other CSS
colours use CSS mixes. There is no runtime token package or font download.

Theme precedence is `appearance.theme`, then `config.branding.theme`, then
`inherit`. **The default changed from `light` to `inherit`.** Set `theme: 'light'`
to retain the previous default. `inherit` follows the nearest host `.dark`
convention. Explicit light/dark ignore that convention, and `system` follows the
OS through a media query. `data-authowl-theme` remains available to host CSS;
`data-brand` identifies the selected product. Tokens only affect `.authowl-root`.

`ElementSlot` and `ELEMENT_SLOTS` are the typed slot table. Each suffix is the
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
