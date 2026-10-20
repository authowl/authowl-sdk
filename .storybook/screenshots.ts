import { page } from 'vitest/browser';
import { expect } from 'vitest';

/** Storybook invokes preview.afterEach after play, before tearing down the story. */
export async function captureStory(storyId: string) {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
    }
  `;
  document.head.append(style);
  try {
    await expect.poll(() => document.querySelector('[aria-busy="true"], .ba-skeleton')).toBeNull();
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
    // Include portalled dialogs as well as the canvas, and all vertical content.
    await expect.element(page.elementLocator(document.body)).toMatchScreenshot(storyId, {
      comparatorOptions: { allowedMismatchedPixels: 0, threshold: 0, includeAA: true },
      screenshotOptions: { animations: 'disabled', caret: 'hide' },
    });
  } finally {
    style.remove();
  }
}
