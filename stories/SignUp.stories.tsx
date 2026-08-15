import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SignUp } from '@authowl/react';
import { expectStoryMatrix } from './matrix';
import { card } from './surface';

// The preview fixture enables password registration plus Google/GitHub social,
// so the default surface renders the full registration form and its dividers.
const meta = {
  title: 'Conversion/SignUp',
  component: SignUp,
  // A sign-up surface is shown to signed-out visitors.
  parameters: { authowl: { signedIn: false } },
  render: (args) => (
    <div style={card}>
      <SignUp {...args} />
    </div>
  ),
} satisfies Meta<typeof SignUp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.findByTestId('signup-form')).resolves.toBeTruthy();
  },
};

export const ConsentRequired: Story = {
  parameters: {
    authowl: {
      signedIn: false,
      consentRequired: true,
    },
  },
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    const canvas = within(canvasElement);
    const form = await canvas.findByTestId('signup-form');
    const consent = await canvas.findByTestId('signup-consent');
    const checkbox = within(consent).getByRole('checkbox');
    const submit = within(form).getByRole('button');
    const visual = consent.querySelector('.ba-checkbox-visual');

    await expect(consent.parentElement?.tagName).toBe('FORM');
    await expect(checkbox.classList.contains('ba-checkbox')).toBe(true);
    await userEvent.click(checkbox);
    await expect(checkbox).toBeChecked();
    await expect(visual).not.toBeNull();
    await waitFor(() => {
      expect(getComputedStyle(visual!).backgroundColor).toBe('rgb(245, 184, 76)');
    });
    await expect(consent.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
  },
};
