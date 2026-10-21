import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SignIn } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import type { PreviewSignInMethod } from '../examples/vite-react/src/PreviewAuth';

// The preview fixture enables password + magic-link + passkey and Google/GitHub
// social, so the default surface exercises every sign-in affordance at once.
const meta = {
  title: 'Conversion/SignIn',
  component: SignIn,
  // A sign-in surface is shown to signed-out visitors.
  parameters: { authowl: { signedIn: false } },
  render: (args) => <SignIn {...args} />,
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

export const ConfigurationUnavailable: Story = {
  parameters: { authowl: { signedIn: false, configUnavailable: true } },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('authowl-config-error')).resolves.toBeTruthy();
    expect(canvas.queryByTestId('signin-form')).toBeNull();
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

function methodStory(signInMethod: PreviewSignInMethod): Story {
  return {
    parameters: { authowl: { signedIn: false, signInMethod, passkeyReachable: signInMethod === 'passkey' } },
    play: async ({ canvasElement }) => {
      await expectStoryMatrix(canvasElement);
      const form = await within(canvasElement).findByTestId('signin-form');
      expect(form.querySelector('.ba-social-grid')).toBeNull();
      expect(Boolean(form.querySelector('input[type="password"]'))).toBe(signInMethod === 'password');
      expect(Boolean(form.querySelector('input[type="email"]'))).toBe(!['passkey', 'phone_otp'].includes(signInMethod));
    },
  };
}

export const PasswordOnly = methodStory('password');
export const EmailCodeOnly = methodStory('email_otp');
export const EmailLinkOnly = methodStory('magic_link');
export const PasskeyOnly: Story = {
  ...methodStory('passkey'),
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const form = await within(canvasElement).findByTestId('signin-form');
    await expect(form.querySelector('button[type="submit"]')).toHaveClass('ba-button');
  },
};
export const PhoneOnly = methodStory('phone_otp');
export const SsoOnly = methodStory('sso');

function emailSentStory(method: 'email_otp' | 'magic_link', testId: string): Story {
  return {
    ...methodStory(method),
    play: async ({ canvasElement }) => {
      await expectStoryMatrix(canvasElement);
      const canvas = within(canvasElement);
      const form = await canvas.findByTestId('signin-form');
      await userEvent.type(form.querySelector('input[type="email"]')!, 'mona@example.test');
      await userEvent.click(form.querySelector('button[type="submit"]')!);
      await canvas.findByTestId(testId);
    },
  };
}

export const EmailCodeSent = emailSentStory('email_otp', 'signin-otp-code');
export const MagicLinkSent = emailSentStory('magic_link', 'signin-magic-sent');

async function enterPhone(canvasElement: HTMLElement) {
  await expectStoryMatrix(canvasElement);
  const canvas = within(canvasElement);
  const form = await canvas.findByTestId('signin-form');
  await userEvent.click(within(form).getByRole('button'));
  const phone = await canvas.findByTestId('phoneotp-phone');
  await waitFor(() => expect(phone.querySelector('button[type="submit"]')).toBeEnabled());
  return phone;
}

export const PhoneEntry: Story = {
  ...methodStory('phone_otp'),
  play: async ({ canvasElement }) => { await enterPhone(canvasElement); },
};

export const PhoneCode: Story = {
  ...methodStory('phone_otp'),
  play: async ({ canvasElement }) => {
    const phone = await enterPhone(canvasElement);
    await userEvent.type(phone.querySelector('input[type="tel"]')!, '01000000000');
    await userEvent.click(phone.querySelector('button[type="submit"]')!);
    await within(canvasElement).findByTestId('phoneotp-code');
  },
};

export const WrongPassword: Story = {
  parameters: {
    authowl: { signedIn: false, signInMethod: 'password', wrongPassword: true },
  },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const form = await canvas.findByTestId('signin-form');
    await userEvent.type(form.querySelector('input[type="email"]')!, 'mona@example.test');
    await userEvent.type(form.querySelector('input[type="password"]')!, 'wrong-password');
    await userEvent.click(form.querySelector('button[type="submit"]')!);
    await expect(canvas.findByRole('alert')).resolves.toHaveClass('ba-error');
  },
};
