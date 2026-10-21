import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { ResetPassword } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

const meta = {
  title: 'Conversion/ResetPassword',
  component: ResetPassword,
  parameters: { authowl: { signedIn: false } },
  render: (args) => (
    <div style={card}>
      <ResetPassword {...args} />
    </div>
  ),
} satisfies Meta<typeof ResetPassword>;

export default meta;
type Story = StoryObj<typeof meta>;

// A valid reset link supplies the token; the new-password form renders at once.
export const Default: Story = {
  args: { token: 'preview-reset-token' },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('reset-form')).resolves.toBeTruthy();
  },
};
