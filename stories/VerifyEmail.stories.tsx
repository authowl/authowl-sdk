import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { VerifyEmail } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

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
