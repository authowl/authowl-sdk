import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CustomerPortalLink, PricingTable } from '@authowl/billing/react/commerce';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

function ButtonDemo() {
  return <section style={card}><PricingTable productIds={['starter']} /></section>;
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

const REAL_WAIT = { timeout: 10_000 };

function subscribeName(locale: unknown): RegExp {
  return locale === 'ar' ? /اشترك في Starter/ : /Subscribe to Starter/;
}

function portalName(locale: unknown): RegExp {
  return locale === 'ar' ? /إدارة الفوترة/ : /Manage billing/;
}

export const ButtonIdle: Story = {
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const button = await within(canvasElement).findByRole(
      'button',
      { name: subscribeName(globals.locale) },
      REAL_WAIT,
    );
    expect(button).toBeEnabled();
    expect(canvasElement.querySelector('.ao-pricing-amount')?.textContent).not.toBe('');
    if (globals.locale === 'ar') {
      const text = canvasElement.querySelector('.ao-pricing-amount')?.textContent ?? '';
      expect(text).not.toMatch(/[٠-٩۰-۹]/);
      expect(text).toMatch(/[0-9]/);
    }
  },
};

export const ButtonPending: Story = {
  parameters: { authowl: { pricing: 'one', billing: 'allowed', checkout: 'loading' }, screenshot: { waitForIdle: false } },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const button = await within(canvasElement).findByRole(
      'button',
      { name: subscribeName(globals.locale) },
      REAL_WAIT,
    );
    await userEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toBeDisabled();
    });
  },
};

export const ButtonError: Story = {
  parameters: { authowl: { pricing: 'one', billing: 'allowed', checkout: 'error' } },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const button = await canvas.findByRole(
      'button',
      { name: subscribeName(globals.locale) },
      REAL_WAIT,
    );
    await userEvent.click(button);
    expect(await canvas.findByRole('alert', {}, REAL_WAIT)).toBeVisible();
  },
};

export const PortalLinkIdle: Story = {
  render: () => <PortalDemo />,
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const button = await within(canvasElement).findByRole(
      'button',
      { name: portalName(globals.locale) },
      REAL_WAIT,
    );
    expect(button).toBeEnabled();
  },
};

export const PortalLinkError: Story = {
  render: () => <PortalDemo />,
  parameters: { authowl: { pricing: 'one', billing: 'allowed', portal: 'error' } },
  play: async ({ canvasElement, globals }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const button = await canvas.findByRole(
      'button',
      { name: portalName(globals.locale) },
      REAL_WAIT,
    );
    await userEvent.click(button);
    expect(await canvas.findByRole('alert', {}, REAL_WAIT)).toBeVisible();
  },
};
