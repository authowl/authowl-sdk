import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { EmailOtpForm } from '@authowl/react';
import { slot } from '@authowl/react';
import { expectStoryMatrix } from './matrix';

const meta = {
  title: 'Conversion/EmailCode',
  component: EmailOtpForm,
  parameters: { authowl: { signedIn: false, signInMethod: 'email_otp' } },
  render: (args) => <div className={`${slot('card')} ${slot('auth-card')}`}><EmailOtpForm {...args} /></div>,
} satisfies Meta<typeof EmailOtpForm>;
export default meta;
type Story = StoryObj<typeof meta>;

async function enterCode(canvasElement: HTMLElement) {
  await expectStoryMatrix(canvasElement);
  const canvas = within(canvasElement);
  const form = await canvas.findByTestId('emailotp-email');
  await userEvent.type(form.querySelector('input')!, 'mona@example.test');
  await userEvent.click(form.querySelector('button[type="submit"]')!);
  return canvas.findByTestId('emailotp-code');
}

export const Empty: Story = { play: async ({ canvasElement }) => { await enterCode(canvasElement); } };
export const Filled: Story = {
  parameters: { authowl: { signedIn: false, signInMethod: 'email_otp', codePending: true }, screenshot: { waitForIdle: false } },
  play: async ({ canvasElement }) => {
    const form = await enterCode(canvasElement);
    await userEvent.type(form.querySelector('input')!, '123456');
  },
};
export const Error: Story = {
  parameters: { authowl: { signedIn: false, signInMethod: 'email_otp', invalidCode: true } },
  play: async ({ canvasElement }) => {
    const form = await enterCode(canvasElement);
    await userEvent.type(form.querySelector('input')!, '123456');
    await expect(within(canvasElement).findByRole('alert')).resolves.toBeTruthy();
  },
};
