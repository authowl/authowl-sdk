import { page } from 'vitest/browser';
import { expect } from 'vitest';

const configuredThreshold = import.meta.env.AUTHOWL_SCREENSHOT_THRESHOLD ?? '0.06';
const threshold = Number(configuredThreshold);
if (configuredThreshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  throw new Error('AUTHOWL_SCREENSHOT_THRESHOLD must be a number in [0,1].');
}

/** Storybook invokes preview.afterEach after play, before tearing down the story. */
export async function captureStory(storyId: string) {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
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
      // Two baseline runs in the same pinned image differ by at most 13/255 per
      // channel on shadow and corner edges (rasterization noise). 0.06 ignores
      // grey deltas up to about 15 and still counts any real edge or colour change.
      // Native x86_64 (CI) and emulated x86_64 Chromium anti-alias an isolated
      // glyph edge differently (measured: 16 pixels on one story); 64 pixels of
      // 691,200 absorbs that while a 1px layout change still moves thousands.
      comparatorOptions: { allowedMismatchedPixels: 64, threshold, includeAA: true },
      screenshotOptions: { caret: 'hide' },
    });
  } finally {
    style.remove();
  }
}
