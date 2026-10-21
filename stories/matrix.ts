import { expect, waitFor } from 'storybook/test';

export async function expectStoryMatrix(canvasElement: HTMLElement): Promise<void> {
  // Play assertions run before captureStory, so resize the phone frame here too.
  const [width, height] = (import.meta.env.AUTHOWL_STORY_VIEWPORT ?? '').split('x').map(Number);
  if (width && height) {
    const { page } = await import('vitest/browser');
    await page.viewport(width, height);
  }
  const expectedLocale = import.meta.env.AUTHOWL_STORY_LOCALE === 'ar' ? 'ar' : 'en';
  const expectedTheme = import.meta.env.AUTHOWL_STORY_THEME === 'dark' ? 'dark' : 'light';
  await waitFor(() => {
    const root = canvasElement.querySelector('.authowl-root');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-authowl-locale', expectedLocale);
    expect(root).toHaveAttribute('data-authowl-theme', expectedTheme);
    expect(root).toHaveAttribute('dir', expectedLocale === 'ar' ? 'rtl' : 'ltr');
  });
}
