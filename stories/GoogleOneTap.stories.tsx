import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, waitFor } from 'storybook/test';
import { GoogleOneTap } from '@authowl/react';
import { expectStoryMatrix } from './matrix';

const meta = {
  title: 'Conversion/GoogleOneTap',
  component: GoogleOneTap,
  parameters: {
    docs: {
      description: {
        component: 'Google One Tap owns no visible UI. This deterministic story proves that an existing AuthOwl session suppresses Google Identity Services without injecting its script.',
      },
    },
  },
} satisfies Meta<typeof GoogleOneTap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExistingSession: Story = {
  render: () => (
    <section style={{ maxWidth: 680, margin: '0 auto', padding: 24, border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', borderRadius: 14 }}>
      <GoogleOneTap />
      <h2 style={{ marginTop: 0 }}>Existing-session behavior</h2>
      <p style={{ marginBottom: 0, lineHeight: 1.6 }}>The signed-in preview fixture keeps One Tap inactive and leaves the page free of Google Identity Services scripts.</p>
    </section>
  ),
  play: async ({ canvasElement }) => {
    await expectStoryMatrix(canvasElement);
    await waitFor(() => {
      expect(document.querySelector('script[src*="accounts.google.com/gsi/client"]')).toBeNull();
    });
  },
};
