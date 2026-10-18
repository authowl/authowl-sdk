import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import '@authowl/tokens/tokens.css';
import {
  ACCENT_COLORS,
  cssVar,
  elevation,
  measureContrast,
  motion,
  NEUTRAL_COLORS,
  palette,
  radius,
  space,
  toCss,
  type,
  type Brand,
  type ColorToken,
  type Scheme,
} from '@authowl/tokens';

const mono = 'var(--ao-font-mono)';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 'var(--ao-text-title)', fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ token, value }: { token: ColorToken; value: string }) {
  return (
    <div data-swatch={token} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span
        aria-hidden="true"
        style={{
          width: 40, height: 28, flex: 'none', borderRadius: cssVar('radius-sm'),
          background: cssVar(token), border: `1px solid ${cssVar('line-strong')}`,
        }}
      />
      <span style={{ flex: 1, fontSize: 'var(--ao-text-body)' }}>{token}</span>
      <code style={{ fontFamily: mono, fontSize: 'var(--ao-text-meta)', color: cssVar('fg-muted') }}>{value}</code>
    </div>
  );
}

function TokensPage({ brand, scheme }: { brand: Brand; scheme: Scheme }) {
  const colors = palette(brand, scheme);
  const pairs = measureContrast().filter((result) => result.brand === brand && result.scheme === scheme);
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      data-brand={brand}
      style={{
        background: cssVar('canvas'), color: cssVar('fg'), fontFamily: 'var(--ao-font-sans)',
        padding: 32, borderRadius: cssVar('radius-card'), display: 'grid', gap: 32,
      }}
    >
      <header style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 'var(--ao-text-meta)', color: cssVar('accent-fg'), fontWeight: 600 }}>@authowl/tokens</span>
        <h1 style={{ margin: 0, fontSize: 'var(--ao-text-display-sm)', letterSpacing: 'var(--ao-text-display-sm-tracking)' }}>
          {brand} · {scheme}
        </h1>
      </header>

      <Section title="Colours">
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {[...NEUTRAL_COLORS, ...ACCENT_COLORS].map((token) => (
            <Swatch key={token} token={token} value={toCss(colors[token])} />
          ))}
        </div>
      </Section>

      <Section title="Contrast, every approved pairing">
        <table aria-label="Contrast results" style={{ borderCollapse: 'collapse', fontSize: 'var(--ao-text-body-sm)' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: cssVar('fg-muted') }}>
              <th style={{ padding: '6px 8px' }}>Text or mark</th>
              <th style={{ padding: '6px 8px' }}>On</th>
              <th style={{ padding: '6px 8px' }}>Ratio</th>
              <th style={{ padding: '6px 8px' }}>Needs</th>
              <th style={{ padding: '6px 8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <tr key={`${pair.fg}-${pair.bg}-${pair.over ?? ''}`} style={{ borderTop: `1px solid ${cssVar('line')}` }}>
                <td style={{ padding: '6px 8px', fontFamily: mono }}>{pair.fg}</td>
                <td style={{ padding: '6px 8px', fontFamily: mono }}>{pair.over ? `${pair.bg} over ${pair.over}` : pair.bg}</td>
                <td style={{ padding: '6px 8px' }}>{pair.ratio.toFixed(2)}</td>
                <td style={{ padding: '6px 8px' }}>{pair.min}</td>
                <td style={{ padding: '6px 8px', color: cssVar(pair.passes ? 'success' : 'danger') }}>{pair.passes ? 'Pass' : 'Fail'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Type">
        {Object.entries(type).map(([name, step]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ fontSize: `var(--ao-text-${name})`, lineHeight: `var(--ao-text-${name}-line-height)`, letterSpacing: 'tracking' in step ? `var(--ao-text-${name}-tracking)` : undefined }}>
              Sign-in methods
            </span>
            <code style={{ fontFamily: mono, fontSize: 'var(--ao-text-meta)', color: cssVar('fg-muted') }}>
              {name} {step.size}/{step.lineHeight}
            </code>
          </div>
        ))}
      </Section>

      <Section title="Radius, space, elevation, motion">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {Object.keys(radius).map((name) => (
            <div key={name} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 52, height: 40, background: cssVar('raised'), border: `1px solid ${cssVar('line-strong')}`, borderRadius: `var(--ao-radius-${name})` }} />
              <code style={{ fontFamily: mono, fontSize: 'var(--ao-text-caption)', color: cssVar('fg-muted') }}>{name}</code>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
          {space.steps.map((step) => (
            <span key={step} title={`${step}px`} style={{ width: step, height: step, background: cssVar('chart-muted'), borderRadius: cssVar('radius-mark') }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {Object.keys(elevation[scheme]).map((name) => (
            <div key={name} style={{ padding: 16, background: cssVar('raised'), borderRadius: cssVar('radius-tile'), boxShadow: `var(--ao-shadow-${name})`, fontSize: 'var(--ao-text-body-sm)' }}>
              {name}
            </div>
          ))}
        </div>
        <code style={{ fontFamily: mono, fontSize: 'var(--ao-text-meta)', color: cssVar('fg-muted') }}>
          {Object.entries(motion.duration).map(([name, ms]) => `${name} ${ms}ms`).join(' · ')}
        </code>
      </Section>
    </div>
  );
}

const meta = {
  title: 'Foundations/Tokens',
  component: TokensPage,
  args: { brand: 'authowl', scheme: 'light' },
  render: (args, { globals }) => <TokensPage brand={args.brand} scheme={globals.theme === 'dark' ? 'dark' : 'light'} />,
} satisfies Meta<typeof TokensPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const proveTokens: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const table = await canvas.findByRole('table', { name: 'Contrast results' });
  await expect(within(table).queryAllByText('Fail')).toHaveLength(0);
  await expect(within(table).getAllByText('Pass').length).toBeGreaterThan(20);
  await expect(canvasElement.querySelectorAll('[data-swatch]')).toHaveLength(NEUTRAL_COLORS.length + ACCENT_COLORS.length);
  // The variables really resolve: the accent swatch is painted, not transparent.
  const accent = canvasElement.querySelector<HTMLElement>('[data-swatch="accent"] span');
  await expect(getComputedStyle(accent!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
};

export const AuthOwl: Story = { args: { brand: 'authowl' }, play: proveTokens };
export const Billow: Story = { args: { brand: 'billow' }, play: proveTokens };
export const Hitsend: Story = { args: { brand: 'hitsend' }, play: proveTokens };
