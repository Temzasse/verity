import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Verity',
    description: 'Verity Chrome extension',
    // activeTab + scripting: inject into the current tab only when the toolbar button is clicked.
    permissions: ['storage', 'activeTab', 'scripting'],
    action: { default_title: 'Scan this page with Verity' },
  },
  webExt: {
    // Keep a persistent dev profile so logins and extension storage survive restarts.
    chromiumArgs: ['--user-data-dir=./.chrome-profile'],
    // Pages to open on `pnpm dev`: set startUrls in web-ext.config.ts (personal, gitignored).
  },
});
