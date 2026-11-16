import type { Meta, StoryObj } from '@storybook/react-vite';
import { PricingTable } from '@authowl/billing/react/commerce';
import React, { type ReactNode } from 'react';
import { expect, waitFor, within } from 'storybook/test';
import { expectStoryMatrix } from './matrix';

function frame(children: ReactNode) {
  return <div style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>{children}</div>;
}

const meta = {
  title: 'Billing/PricingTable',
  component: PricingTable,
  render: (args) => frame(<PricingTable {...args} />),
  parameters: { authowl: { pricing: 'three', billing: 'allowed' } },
} satisfies Meta<typeof PricingTable>;

export default meta;
type Story = StoryObj<typeof meta>;

const REAL_WAIT = { timeout: 10_000 };

async function expectCards(canvasElement: HTMLElement, count: number): Promise<void> {
  await waitFor(() => {
    expect(canvasElement.querySelectorAll('.ao-pricing-grid[role="list"] > .ao-pricing-card'))
      .toHaveLength(count);
  }, REAL_WAIT);
}

export const OneProduct: Story = {
  parameters: { authowl: { pricing: 'one', billing: 'allowed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 1);
    expect(await within(canvasElement).findByRole('heading', { name: 'Starter' }, REAL_WAIT))
      .toBeVisible();
  },
};

export const ThreeProducts: Story = {
  args: { highlight: 'growth' },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 3);
    expect(canvasElement.querySelector('.ao-pricing-card-highlighted #ao-plan-growth'))
      .toHaveTextContent('Growth');
    if (globals.locale === 'ar') {
      const text = canvasElement.querySelector('.ao-pricing-amount')?.textContent ?? '';
      expect(text).not.toMatch(/[٠-٩۰-۹]/);
      expect(text).toMatch(/[0-9]/);
    }
  },
};

export const FiveProducts: Story = {
  parameters: { authowl: { pricing: 'five', billing: 'allowed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 5);
    expect(await within(canvasElement).findByRole('heading', { name: 'Enterprise' }, REAL_WAIT))
      .toBeVisible();
  },
};

export const HiddenCurrencyProduct: Story = {
  args: { currency: 'USD' },
  parameters: { authowl: { pricing: 'mixed', billing: 'allowed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 2);
    const canvas = within(canvasElement);
    expect(await canvas.findByRole('heading', { name: 'Growth' }, REAL_WAIT)).toBeVisible();
    expect(canvas.queryByText('Scale')).toBeNull();
    expect(canvasElement.textContent).not.toContain('EGP');
  },
};

export const Loading: Story = {
  parameters: { authowl: { pricing: 'loading', billing: 'loading' }, screenshot: { waitForIdle: false } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => {
      expect(canvasElement.querySelector('.ao-pricing-grid[aria-busy="true"]')).not.toBeNull();
      expect(canvasElement.querySelectorAll('.ao-pricing-card.ao-skeleton')).toHaveLength(3);
    });
  },
};

export const Empty: Story = {
  parameters: { authowl: { pricing: 'empty', billing: 'allowed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => {
      expect(canvasElement.querySelector('.ao-pricing-status')).toHaveTextContent('EGP');
      expect(canvasElement.querySelector('.ao-pricing-grid[role="list"]')).toBeNull();
    }, REAL_WAIT);
  },
};

export const Error: Story = {
  parameters: { authowl: { pricing: 'error', billing: 'allowed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => {
      const status = canvasElement.querySelector('.ao-pricing-status');
      expect(status?.querySelector('.ao-error')).not.toBeNull();
      expect(status?.querySelector('button')).toBeEnabled();
    }, REAL_WAIT);
  },
};

export const CurrentPlan: Story = {
  parameters: { authowl: { pricing: 'three', billing: 'subscribed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 3);
    await waitFor(() => {
      expect(canvasElement.querySelector('[aria-labelledby="ao-plan-growth"] .ao-pricing-badge'))
        .not.toBeNull();
      expect(canvasElement.querySelectorAll('.ao-portal-link')).toHaveLength(3);
    }, REAL_WAIT);
  },
};

export const SignedOut: Story = {
  args: { signInUrl: '/sign-in' },
  parameters: { authowl: { pricing: 'three', billing: 'denied', signedIn: false } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 3);
    expect(canvasElement.querySelectorAll('.ao-pricing-card a[href="/sign-in"]')).toHaveLength(3);
  },
};

function ReturnTable() {
  sessionStorage.setItem('authowl.billing.checkout.v1', JSON.stringify({
    productId: 'growth', currency: 'EGP', userId: 'user-preview', startedAt: Date.now(),
  }));
  return frame(<PricingTable />);
}

export const ReturnConfirming: Story = {
  render: () => <ReturnTable />,
  parameters: { authowl: { pricing: 'three', billing: 'loading' }, screenshot: { waitForIdle: false } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await expectCards(canvasElement, 3);
    await waitFor(() => {
      const status = canvasElement.querySelector('.ao-pricing-status');
      expect(status?.querySelector('button')).toBeEnabled();
      expect(status?.textContent).not.toBe('');
    }, REAL_WAIT);
  },
};
