import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import '@authowl/tokens/tokens.css';
import {
  COLOR_TOKENS,
  cssVar,
  elevation,
  measureContrast,
  motion,
  palette,
  radius,
  space,
  toCss,
  type,
  type Brand,
  type ColorToken,
  type CssVarName,
  type Scheme,
} from '@authowl/tokens';

const RESULTS = measureContrast();
const cell: React.CSSProperties = { padding: '6px 8px' };

function Code({ children, size = 'xs' }: { children: React.ReactNode; size?: 'xs' | '11' }) {
  return <code style={{ fontFamily: cssVar('font-mono'), fontSize: cssVar(`text-${size}`), color: cssVar('fg-muted') }}>{children}</code>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: cssVar('text-base'), fontWeight: 600 }}>{title}</h2>
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
      <span style={{ flex: 1, fontSize: cssVar('text-sm') }}>{token}</span>
      <Code>{value}</Code>
    </div>
  );
}

function TokensPage({ brand, scheme }: { brand: Brand; scheme: Scheme }) {
  const colors = palette(brand, scheme);
  const pairs = RESULTS.filter((result) => result.brand === brand && result.scheme === scheme);
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      data-authowl-brand={brand}
      style={{
        ...Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--ao-${key}`, toCss(value)])),
        background: cssVar('canvas'), color: cssVar('fg'), fontFamily: cssVar('font-sans'),
        padding: 32, borderRadius: cssVar('radius-xl'), display: 'grid', gap: 32,
      }}
    >
      <header style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: cssVar('text-xs'), color: cssVar('brand-text'), fontWeight: 600 }}>@authowl/tokens</span>
        <h1 style={{ margin: 0, fontSize: cssVar('text-2xl'), letterSpacing: cssVar('text-2xl-tracking') }}>
          {brand} · {scheme}
        </h1>
      </header>

      <Section title="Colours">
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {COLOR_TOKENS.map((token) => (
            <Swatch key={token} token={token} value={toCss(colors[token])} />
          ))}
        </div>
      </Section>

      <Section title="Contrast, every approved pairing">
        <table aria-label="Contrast results" style={{ borderCollapse: 'collapse', fontSize: cssVar('text-13') }}>
          <thead>
            <tr style={{ textAlign: 'left', color: cssVar('fg-muted') }}>
              <th style={cell}>Text or mark</th>
              <th style={cell}>On</th>
              <th style={cell}>Ratio</th>
              <th style={cell}>Needs</th>
              <th style={cell}>Result</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <tr key={`${pair.fg}-${pair.bg}-${pair.over ?? ''}`} style={{ borderTop: `1px solid ${cssVar('line')}` }}>
                <td style={{ ...cell, fontFamily: cssVar('font-mono') }}>{pair.fg}</td>
                <td style={{ ...cell, fontFamily: cssVar('font-mono') }}>{pair.over ? `${pair.bg} over ${pair.over}` : pair.bg}</td>
                <td style={cell}>{pair.ratio.toFixed(2)}</td>
                <td style={cell}>{pair.min}</td>
                <td style={{ ...cell, color: cssVar(pair.passes ? 'success' : 'danger') }}>{pair.passes ? 'Pass' : 'Fail'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Type">
        {(Object.keys(type) as (keyof typeof type)[]).map((name) => {
          const step = type[name];
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
              <span
                style={{
                  fontSize: cssVar(`text-${name}`),
                  lineHeight: cssVar(`text-${name}-line-height`),
                  letterSpacing: 'tracking' in step ? cssVar(`text-${name}-tracking` as CssVarName) : undefined,
                }}
              >
                Sign-in methods
              </span>
              <Code>{name} {step.size}/{step.lineHeight}</Code>
            </div>
          );
        })}
      </Section>

      <Section title="Radius, space, elevation, motion">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {(Object.keys(radius) as (keyof typeof radius)[]).map((name) => (
            <div key={name} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 52, height: 40, background: cssVar('raised'), border: `1px solid ${cssVar('line-strong')}`, borderRadius: cssVar(`radius-${name}`) }} />
              <Code size="11">{name}</Code>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
          {space.steps.map((step) => (
            <span key={step} title={`${step}px`} style={{ width: step, height: step, background: cssVar('chart-muted'), borderRadius: cssVar('radius-xs') }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {(Object.keys(elevation[scheme]) as (keyof (typeof elevation)[Scheme])[]).map((name) => (
            <div key={name} style={{ padding: 16, background: cssVar('raised'), borderRadius: cssVar('radius-lg'), boxShadow: cssVar(`shadow-${name}`), fontSize: cssVar('text-13') }}>
              {name}
            </div>
          ))}
        </div>
        <Code>{Object.entries(motion.duration).map(([name, ms]) => `${name} ${ms}ms`).join(' · ')}</Code>
      </Section>
    </div>
  );
}

// The scheme follows the toolbar's theme, so it has no control of its own.
const meta = {
  title: 'Foundations/Tokens',
  component: TokensPage,
  args: { brand: 'authowl', scheme: 'light' },
  argTypes: { scheme: { control: false } },
  render: (args, { globals }) => <TokensPage brand={args.brand} scheme={globals.theme === 'dark' ? 'dark' : 'light'} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByRole('table', { name: 'Contrast results' });
    await expect(within(table).queryAllByText('Fail')).toHaveLength(0);
    await expect(within(table).getAllByText('Pass').length).toBeGreaterThan(20);
    await expect(canvasElement.querySelectorAll('[data-swatch]')).toHaveLength(COLOR_TOKENS.length);
    // The variables really resolve: the brand swatch is painted, not transparent.
    const brand = canvasElement.querySelector<HTMLElement>('[data-swatch="brand"] span');
    await expect(getComputedStyle(brand!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  },
} satisfies Meta<typeof TokensPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AuthOwl: Story = { args: { brand: 'authowl' } };
export const Billow: Story = { args: { brand: 'billow' } };
export const Hitsend: Story = { args: { brand: 'hitsend' } };
