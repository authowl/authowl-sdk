# @authowl/tokens

The design tokens shared by AuthOwl, Billow and Hitsend: semantic colours in
OKLCH for light and dark, plus type, spacing, radius, elevation and motion.
They come from the approved suite reference design, and every text pairing the
design uses passes WCAG AA, which a test proves for each brand and scheme.

```bash
pnpm add @authowl/tokens
```

## Use with Tailwind 4 and shadcn/ui

Replace your `@theme inline` block and your `:root` and `.dark` colour blocks
with three imports. Keep your `@layer base` rules.

```css
@import "tailwindcss";
@import "@authowl/tokens/tokens.css";
@import "@authowl/tokens/theme.css";
@import "@authowl/tokens/shadcn.css";
```

`theme.css` is the only `@theme` you need. It also declares the `dark` variant
(`@custom-variant dark (&:is(.dark *))`). Utilities use shadcn's names, so a
component pulled with `npx shadcn add` is themed by the tokens with no edits:

```html
<div class="bg-card text-card-foreground rounded-xl border">
  <p class="text-sm text-muted-foreground">Sign-in methods</p>
  <button class="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md">Save</button>
</div>
```

Beyond shadcn's set, the theme adds `primary-hover` (the fill under the
pointer), `primary-text` (the brand as text or a line), `primary-soft` (a brand
tint), `foreground-faint`, `destructive-soft`, and `success` and `warning` with
their `-soft` tints. `text-primary` is the fill colour, and gold on white is
1.8:1, so brand-coloured text uses `text-primary-text`.

`shadcn.css` sets shadcn's raw variables (`--background`, `--primary`,
`--radius` and the rest). Import it wherever code reads them with `var()`
instead of a utility, as sonner and chart configs do.

Tailwind's scales are tokens too:

- **Type:** `text-xs` 12/16, `text-sm` 14/20, `text-base` 16/24, `text-lg`
  18/28, `text-xl` 20/28, `text-2xl` 24/32, `text-3xl` 30/36, plus the board's
  in-between steps `text-11`, `text-13` and `text-15`. The three largest
  tighten their tracking.
- **Radius:** `rounded-xs` 4, `sm` 6 (chips, menu items), `md` 10 (controls),
  `lg` 12 (tiles, dialogs), `xl` 16 (cards), `2xl` 20, `3xl` 24, `4xl` 32.
- **Shadow:** the boards are flat. `shadow-xs` and `shadow-sm` cast nothing,
  `shadow-md` is the popover shadow, and `shadow-lg` and up are the dialog
  shadow.
- **Spacing** stays Tailwind's 4px default.
- **Motion:** bare `transition` utilities take 200ms on the standard curve.
  People who ask for reduced motion get none: every duration collapses to 0,
  fades included. That is stricter than WCAG 2.3.3 requires, and is the safer
  default.

The AuthOwl dashboard is on Tailwind 3 until it upgrades. There, `tokens.css`
works on its own through `var(--ao-*)` in `theme.extend`. The package does not
ship a Tailwind 3 `hsl(var(--x))` form.

## Use without Tailwind

`tokens.css` is plain CSS variables under `--ao-`, named by role, so it works
anywhere:

```css
.card { background: var(--ao-surface); color: var(--ao-fg); border-radius: var(--ao-radius-xl); }
```

From TypeScript, `cssVar('surface')` returns `var(--ao-surface)`. It accepts
every variable `tokens.css` declares, such as `text-sm` or `radius-md`. The raw
values are exported as data (`neutral`, `brands`, `type`, `radius`, `space`,
`elevation`, `motion`), and `THEME_COLORS` maps each theme name to its token.

## Fonts

The font tokens read Geist through `--font-geist-sans` and `--font-geist-mono`,
the variables `create-next-app` and the `geist` package use:

```ts
const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
```

The variable class can sit on `<html>` or `<body>`. Without it the tokens fall
back to a locally installed Geist, then the system font.

## Schemes and brands

Light is the default. Dark applies under a `.dark` class, which is the
next-themes and shadcn convention. The package does not switch on
`prefers-color-scheme`; that is the app's choice.

AuthOwl gold is the default brand. `data-brand="billow"`, `data-brand="hitsend"`
or `data-brand="authowl"` switches it. Only the brand colours change; the
neutrals are shared. The scheme and the brand can each sit on `<html>` or on
any container, in either nesting order. Popovers and dialogs portal to
`<body>`, so a brand that must reach them goes on `<html>`. Avoid nesting one
brand inside another and then a `.dark` area inside that: the inner area takes
whichever brand comes later in the stylesheet.

| Token | Use |
|---|---|
| `canvas`, `surface`, `raised`, `inset` | Page, cards, popovers, sunken inputs |
| `highlight` | A hovered or selected item, and secondary buttons |
| `line`, `line-strong` | Dividers and borders, input borders |
| `fg`, `fg-muted`, `fg-faint` | Text, on any of the surfaces above |
| `brand`, `brand-hover`, `on-brand` | The primary action's fill, its hover and its label |
| `brand-text`, `brand-soft`, `ring`, `chart-1` | The brand as text, tint, focus ring and highlighted series |
| `success`, `warning`, `danger` and their `-soft` tints | Status text and pill backgrounds; `danger` is also the destructive fill |
| `chart-muted` | The series behind the highlighted one |

`CONTRAST_PAIRS` lists every approved pairing, and `measureContrast()` reports
its ratio.

## Where the tokens depart from a source

- **Light success** is `#007742`, not the board's `#14804A`. The board's green
  read 4.25:1 on its own tint (the Active pill), which is under AA.
- **Dark `fg-faint`** is `#85858E`, not the board's `#7E7E87`, which is 4.41:1
  on `raised` (every popover) and under AA on `highlight`.
- **`highlight`** is new. The boards drew hover with `raised`, which is also
  the popover, so a hovered item inside a popover would not show.
- **Billow dark** uses an `L 0.58` fill (`oklch(0.58 0.21 277)`) instead of
  Billow's `oklch(0.64 0.21 277)`. That value is outside sRGB, and white labels
  on what screens show for it are about 3.6:1. Text and lines use `#6F76FE`, an
  in-gamut colour at Billow's hue. Billow's light primary is unchanged.
- **Hitsend dark** keeps its `#8B5CF6` fill, but text, lines and hover use
  `#9469FF`, one step lighter at the same hue. `#8B5CF6` is 4.45:1 as text on
  `surface` and 4.18:1 on `raised`, under AA. Hitsend's light violet `#7C3AED`
  is unchanged.
- **Type and radius** round the boards' one-off values to the nearest step:
  12.5px text to 12 or 13, 17 to 16, 26 to 24; radii of 2 to 3px to 4, 5 to 8
  to 6, 9 to 11 to 10, 14 to 12, 18 to 16.

## License

MIT
