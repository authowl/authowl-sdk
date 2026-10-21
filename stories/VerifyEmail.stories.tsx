import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { VerifyEmail, VerificationPending } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';
import { slot } from '@authowl/react';

const meta = {
  title: 'Conversion/VerifyEmail',
  component: VerifyEmail,
  parameters: { authowl: { signedIn: false } },
  render: (args) => (
    <div style={card}>
      <VerifyEmail {...args} />
    </div>
  ),
} satisfies Meta<typeof VerifyEmail>;

export default meta;
type Story = StoryObj<typeof meta>;

// The landing page reads its outcome from the URL: with no `?error=` present the
// address is confirmed and the success confirmation renders. (No `redirectTo` is
// passed, so the story stays on the confirmation instead of navigating away.)
export const Success: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('verify-success')).resolves.toBeTruthy();
  },
};


export const OwnershipCode: Story = {
  render: () => <div className={`${slot('card')} ${slot('auth-card')}`}>
    <VerificationPending email="mona@example.test" method="code" />
  </div>,
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await within(canvasElement).findByTestId('verify-code-pending');
  },
};
