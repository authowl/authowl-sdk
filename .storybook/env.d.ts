interface ImportMetaEnv {
  readonly AUTHOWL_SCREENSHOT_THRESHOLD?: string;
  readonly AUTHOWL_SCREENSHOTS?: string;
  readonly AUTHOWL_STORY_LOCALE?: string;
  readonly AUTHOWL_STORY_THEME?: string;
  readonly AUTHOWL_STORY_VIEWPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
