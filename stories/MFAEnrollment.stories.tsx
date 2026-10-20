import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { userEvent, within } from 'storybook/test';
import { MFAEnrollment } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

const meta = {
  title: 'Conversion/MFAEnrollment',
  component: MFAEnrollment,
  parameters: { authowl: { mfaEnrollment: true } },
  render: (args) => <div style={card}><MFAEnrollment {...args} /></div>,
} satisfies Meta<typeof MFAEnrollment>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Password: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await within(canvasElement).findByTestId('mfa-enroll-password');
  },
};

async function startEnrollment(canvasElement: HTMLElement) {
  await expectStoryMatrix(canvasElement);
  const canvas = within(canvasElement);
  const form = await canvas.findByTestId('mfa-enroll-password');
  await userEvent.type(form.querySelector('input')!, 'preview-password');
  await userEvent.click(within(form).getByRole('button'));
  const setup = await canvas.findByTestId('mfa-enroll-verify');
  await within(setup).findByRole('img');
  return setup;
}

export const ScanQrAndBackupCodes: Story = {
  play: async ({ canvasElement }) => { await startEnrollment(canvasElement); },
};

export const Enrolled: Story = {
  play: async ({ canvasElement }) => {
    const setup = await startEnrollment(canvasElement);
    await userEvent.type(setup.querySelector('input')!, '123456');
    await userEvent.click(within(setup).getByRole('button'));
    await within(canvasElement).findByTestId('mfa-enroll-done');
  },
};
