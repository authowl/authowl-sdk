import type { Meta, StoryObj } from '@storybook/react-vite';
import { PricingTable } from '@authowl/billing/react/commerce';
import type { ReactNode } from 'react';
import { expect, within } from 'storybook/test';
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

const matrix = async ({ canvasElement }: { canvasElement: HTMLElement }) => expectStoryMatrix(canvasElement);

export const OneProduct: Story = {
  parameters: { authowl: { pricing: 'one', billing: 'allowed' } },
  play: matrix,
};

export const ThreeProducts: Story = {
  args: { highlight: 'growth' },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    if (globals.locale === 'ar') {
      const text = canvasElement.querySelector('.ao-pricing-amount')?.textContent ?? '';
      expect(text).not.toMatch(/[٠-٩۰-۹]/);
      expect(text).toMatch(/[0-9]/);
    }
  },
};

export const FiveProducts: Story = {
  parameters: { authowl: { pricing: 'five', billing: 'allowed' } },
  play: matrix,
};

export const HiddenCurrencyProduct: Story = {
  args: { currency: 'USD' },
  parameters: { authowl: { pricing: 'mixed', billing: 'allowed' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    expect(canvas.queryByText('Scale')).toBeNull();
    expect(canvasElement.textContent).not.toContain('EGP');
  },
};

export const Loading: Story = {
  parameters: { authowl: { pricing: 'loading', billing: 'loading' }, screenshot: { waitForIdle: false } },
  play: matrix,
};

export const Empty: Story = {
  parameters: { authowl: { pricing: 'empty', billing: 'allowed' } },
  play: matrix,
};

export const Error: Story = {
  parameters: { authowl: { pricing: 'error', billing: 'allowed' } },
  play: matrix,
};

export const CurrentPlan: Story = {
  parameters: { authowl: { pricing: 'three', billing: 'subscribed' } },
  play: matrix,
};

export const SignedOut: Story = {
  args: { signInUrl: '/sign-in' },
  parameters: { authowl: { pricing: 'three', billing: 'denied', signedIn: false } },
  play: matrix,
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
  play: matrix,
};
