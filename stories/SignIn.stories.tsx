import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SignIn } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

// The preview fixture enables password + magic-link + passkey and Google/GitHub
// social, so the default surface exercises every sign-in affordance at once.
const meta = {
  title: 'Conversion/SignIn',
  component: SignIn,
  // A sign-in surface is shown to signed-out visitors.
  parameters: { authowl: { signedIn: false } },
  // The drop-in forms are designed to sit on a surface card (like the account
  // and organization stories), which is also where their accent/link colors
  // meet contrast - the same framing consumers use.
  render: (args) => (
    <div style={card}>
      <SignIn {...args} />
    </div>
  ),
} satisfies Meta<typeof SignIn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('signin-form')).resolves.toBeTruthy();
  },
};

// Inline "forgot password" step: reachable once a reset page is configured. The
// switch is pure client state (no network), so it renders deterministically.
export const ForgotPassword: Story = {
  args: { resetPasswordUrl: '/reset' },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const form = await canvas.findByTestId('signin-form');
    // The only link-button inside the sign-in form is "Forgot password?"
    // (selected structurally so the assertion holds in every locale).
    const forgot = form.querySelector('.ba-link-button');
    expect(forgot).not.toBeNull();
    await userEvent.click(forgot as HTMLElement);
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-testid="signin-forgot"]')).not.toBeNull();
    });
  },
};
