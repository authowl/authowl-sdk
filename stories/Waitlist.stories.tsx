import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { Waitlist } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

const meta = {
  title: 'Conversion/Waitlist',
  component: Waitlist,
  parameters: { authowl: { signedIn: false } },
  render: (args) => (
    <div style={card}>
      <Waitlist {...args} />
    </div>
  ),
} satisfies Meta<typeof Waitlist>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('waitlist-form')).resolves.toBeTruthy();
    await expect(canvas.findByRole('button')).resolves.toBeTruthy();
  },
};
