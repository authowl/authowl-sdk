import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Protect, useEntitlements } from '@authowl/billing/react';
import { expect, waitFor, within } from 'storybook/test';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

type Copy = Readonly<{
  reportsTitle: string;
  reportsBody: string;
  reportsAction: string;
  upgradeTitle: string;
  upgradeBody: string;
  upgradeAction: string;
}>;

const COPY: Record<'en' | 'ar', Copy> = {
  en: {
    reportsTitle: 'Reports',
    reportsBody: 'Revenue and usage for this workspace.',
    reportsAction: 'Export',
    upgradeTitle: 'Upgrade to Pro',
    upgradeBody: 'Reports are included in the Pro plan.',
    upgradeAction: 'See plans',
  },
  ar: {
    reportsTitle: 'التقارير',
    reportsBody: 'الإيرادات والاستخدام في مساحة العمل هذه.',
    reportsAction: 'تصدير',
    upgradeTitle: 'الترقية إلى Pro',
    upgradeBody: 'التقارير متاحة في خطة Pro.',
    upgradeAction: 'عرض الخطط',
  },
};

const copyFor = (locale: unknown): Copy => COPY[locale === 'ar' ? 'ar' : 'en'];

function ReportsPanel({ copy }: { copy: Copy }) {
  return (
    <>
      <h2>{copy.reportsTitle}</h2>
      <p>{copy.reportsBody}</p>
      <button type="button" style={button}>{copy.reportsAction}</button>
    </>
  );
}

function UpgradeNotice({ copy }: { copy: Copy }) {
  return (
    <>
      <h2>{copy.upgradeTitle}</h2>
      <p>{copy.upgradeBody}</p>
      <button type="button" style={button}>{copy.upgradeAction}</button>
    </>
  );
}

const button: React.CSSProperties = {
  background: 'transparent',
  color: 'inherit',
  border: '1px solid currentColor',
  borderRadius: 8,
  padding: '8px 12px',
};

function BillingDemo({ copy }: { copy: Copy }) {
  const { isLoading, reason } = useEntitlements();
  return (
    <section style={card} data-billing-state={isLoading ? 'loading' : reason ?? 'none'}>
      <Protect feature="reports" fallback={<UpgradeNotice copy={copy} />}>
        <ReportsPanel copy={copy} />
      </Protect>
    </section>
  );
}

const meta = {
  title: 'Billing',
  render: (_args, { globals }) => (
    <BillingDemo copy={copyFor(globals.locale)} />
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProtectLoading: Story = {
  parameters: { authowl: { billing: 'loading' } },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const value = copyFor(globals.locale);
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector('section')).toHaveAttribute(
      'data-billing-state',
      'loading',
    );
    await expect(canvas.findByRole('heading', { name: value.upgradeTitle })).resolves.toBeTruthy();
    await expect(canvas.queryByRole('heading', { name: value.reportsTitle })).toBeNull();
  },
};

export const ProtectDenied: Story = {
  parameters: { authowl: { billing: 'denied' } },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const value = copyFor(globals.locale);
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvasElement.querySelector('section')).toHaveAttribute('data-billing-state', 'ok');
    });
    await expect(canvas.findByRole('heading', { name: value.upgradeTitle })).resolves.toBeTruthy();
    await expect(canvas.queryByRole('heading', { name: value.reportsTitle })).toBeNull();
  },
};

export const ProtectAllowed: Story = {
  parameters: { authowl: { billing: 'allowed' } },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const value = copyFor(globals.locale);
    const canvas = within(canvasElement);
    await expect(canvas.findByRole('heading', { name: value.reportsTitle })).resolves.toBeTruthy();
    await expect(canvas.queryByRole('heading', { name: value.upgradeTitle })).toBeNull();
  },
};
