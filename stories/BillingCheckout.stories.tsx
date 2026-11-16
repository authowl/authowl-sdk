import type { Meta, StoryObj } from '@storybook/react-vite';
import { CheckoutButton, CustomerPortalLink, usePricing } from '@authowl/billing/react/commerce';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

function ButtonDemo() {
  const pricing = usePricing();
  const price = pricing.products[0]?.prices[0];
  const locale = document.documentElement.dir === 'rtl' ? 'ar-EG-u-nu-latn' : 'en-US';
  const formatted = price ? new Intl.NumberFormat(locale, {
    style: 'currency', currency: price.currency, currencyDisplay: 'code',
  }).format(price.amount / 10 ** price.exponent) : '';
  return <section style={card}>
    <h2>Starter</h2>
    <p data-story-price><bdi>{formatted}</bdi></p>
    <CheckoutButton productId="starter" />
  </section>;
}

function PortalDemo() {
  return <section style={card}><CustomerPortalLink /></section>;
}

const meta = {
  title: 'Billing/Checkout',
  render: () => <ButtonDemo />,
  parameters: { authowl: { pricing: 'one', billing: 'allowed', checkout: 'redirect', portal: 'redirect' } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ButtonIdle: Story = {
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    if (globals.locale === 'ar') {
      const text = canvasElement.querySelector('[data-story-price]')?.textContent ?? '';
      expect(text).not.toMatch(/[٠-٩۰-۹]/);
      expect(text).toMatch(/[0-9]/);
    }
  },
};

export const ButtonPending: Story = {
  parameters: { authowl: { pricing: 'one', billing: 'allowed', checkout: 'loading' }, screenshot: { waitForIdle: false } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const button = await within(canvasElement).findByRole('button', { name: /Starter/ });
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
  },
};

export const ButtonError: Story = {
  parameters: { authowl: { pricing: 'one', billing: 'allowed', checkout: 'error' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Starter/ }));
    await canvas.findByRole('alert');
  },
};

export const PortalLinkIdle: Story = {
  render: () => <PortalDemo />,
  play: async ({ canvasElement }) => expectStoryMatrix(canvasElement),
};

export const PortalLinkError: Story = {
  render: () => <PortalDemo />,
  parameters: { authowl: { pricing: 'one', billing: 'allowed', portal: 'error' } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Manage billing/ }));
    await canvas.findByRole('alert');
  },
};
