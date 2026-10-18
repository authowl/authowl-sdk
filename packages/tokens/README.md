# @authowl/tokens

The design tokens shared by AuthOwl, Billow and Hitsend: semantic colours in
OKLCH for light and dark, plus type, spacing, radius, elevation and motion.
They come from the approved suite reference design, and every text pairing the
design uses passes WCAG AA, which a test proves for each brand and scheme.

```bash
pnpm add @authowl/tokens
```

## Use with Tailwind 4

```css
@import "tailwindcss";
@import "@authowl/tokens/tokens.css";
@import "@authowl/tokens/theme.css";
```

Utilities then follow the scheme and brand at runtime:

```html
<div class="bg-surface text-fg rounded-card shadow-popover">
  <p class="text-body text-fg-muted">Sign-in methods</p>
  <button class="bg-accent text-on-accent rounded-control">Save</button>
</div>
```

To run shadcn/ui primitives in the suite look, also import
`@authowl/tokens/shadcn.css`. It points shadcn's variables (`--background`,
`--primary`, `--ring` and the rest) at the tokens. It is for Tailwind 4 shadcn
setups.

## Use without Tailwind

`tokens.css` is plain CSS variables under `--ao-`, so it works anywhere:

```css
.card { background: var(--ao-surface); color: var(--ao-fg); border-radius: var(--ao-radius-card); }
```

From TypeScript, `cssVar('surface')` returns `var(--ao-surface)`, and the raw
values are exported as data (`neutral`, `brands`, `type`, `radius`, `space`,
`elevation`, `motion`).

## Schemes and brands

Light is the default. Dark applies under a `.dark` class, which is the
next-themes and shadcn convention. The package does not switch on
`prefers-color-scheme`; that is the app's choice.

AuthOwl gold is the default brand. Set `data-brand="billow"` or
`data-brand="hitsend"` on `<html>` or on any container to switch the accent.
Only the accent changes; the neutrals are shared.

| Token | Use |
|---|---|
| `canvas`, `surface`, `raised`, `inset` | Page, cards, hover and popovers, sunken inputs |
| `line`, `line-strong` | Dividers and borders |
| `fg`, `fg-muted`, `fg-faint` | Text. `fg-faint` only on `canvas`, `surface` and `inset` |
| `accent`, `on-accent` | The primary action's fill and its label |
| `accent-fg`, `accent-soft`, `ring`, `chart-1` | Accent as text, tint, focus ring and highlighted series |
| `success`, `warning`, `danger` and their `-soft` tints | Status text and pill backgrounds |
| `danger-solid`, `on-danger` | A destructive button and its label |

`CONTRAST_PAIRS` lists every approved pairing, and `measureContrast()` reports
its ratio. A pairing that is not listed, such as `fg-faint` on `raised`, is not
part of the design.

## Where the tokens depart from a source

- **Light success** is `#007742`, not the board's `#14804A`. The board's green
  read 4.25:1 on its own tint (the Active pill), which is under AA.
- **Billow dark** uses an `L 0.58` fill (`oklch(0.58 0.21 277)`) instead of
  Billow's `oklch(0.64 0.21 277)`. White labels on Billow's value are about
  3.6:1, and that value is outside sRGB, so screens clamp it. Text and lines use
  `#6F76FE`, the in-gamut colour it actually displays as. Billow's light primary
  is unchanged.
- **Hitsend** has no accent yet, so it keeps its neutral shadcn palette until
  one is chosen.

## License

MIT
