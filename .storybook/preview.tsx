import type { Preview } from '@storybook/react-vite';
import React from 'react';
import '@authowl/react/styles.css';
import { PreviewAuth } from '../examples/vite-react/src/PreviewAuth';

const preview: Preview = {
  tags: ['autodocs'],
  globalTypes: {
    locale: {
      description: 'Component language and reading direction',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'ar', title: 'Arabic' },
        ],
      },
    },
    theme: {
      description: 'AuthOwl component color scheme',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
      },
    },
  },
  initialGlobals: {
    locale: import.meta.env.AUTHOWL_STORY_LOCALE === 'ar' ? 'ar' : 'en',
    theme: import.meta.env.AUTHOWL_STORY_THEME === 'dark' ? 'dark' : 'light',
  },
  decorators: [
    (Story, context) => {
      const locale = context.globals.locale === 'ar' ? 'ar' : 'en';
      const dark = context.globals.theme === 'dark';
      const signedIn = context.parameters.authowl?.signedIn !== false;
      const consentRequired = context.parameters.authowl?.consentRequired === true;
      const configUnavailable = context.parameters.authowl?.configUnavailable === true;
      const primaryColor = typeof context.parameters.authowl?.primaryColor === 'string'
        ? context.parameters.authowl.primaryColor
        : undefined;
      return (
        <PreviewAuth
          locale={locale}
          dark={dark}
          signedIn={signedIn}
          consentRequired={consentRequired}
          configUnavailable={configUnavailable}
          primaryColor={primaryColor}
        >
          <main
            style={{
              minHeight: '100vh',
              boxSizing: 'border-box',
              padding: '40px 20px',
              background: dark ? '#09090b' : '#f4f4f5',
              color: dark ? '#fafafa' : '#18181b',
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            }}
          >
            <Story />
          </main>
        </PreviewAuth>
      );
    },
  ],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { test: 'error' },
    options: { storySort: { order: ['Account', 'Organizations', 'Conversion'] } },
  },
};

export default preview;
