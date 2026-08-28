import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, within } from 'storybook/test';
import { PrivacyCenter } from '@authowl/react';
import { expectStoryMatrix } from './matrix';

const meta = {
  title: 'Account/PrivacyCenter',
  component: PrivacyCenter,
  parameters: { authowl: { privacyEnabled: true } },
  render: (args) => (
    <div style={{ width: 'min(100%, 760px)', margin: '0 auto' }}>
      <PrivacyCenter {...args} />
    </div>
  ),
} satisfies Meta<typeof PrivacyCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByRole('switch')).resolves.toHaveAttribute('aria-checked', 'true');
    await expect(canvasElement.querySelector('.ba-privacy-request-list [data-state="in_progress"]'))
      .not.toBeNull();
    await expect(canvas.findByText(/Cairo Studio|استوديو القاهرة/)).resolves.toBeVisible();
  },
};
