const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  // Service workers would cache the app between tests, so only pwa.spec.js turns them on.
  use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    // Jessica's screens are for an iPad, so they also run in WebKit at iPad size.
    { name: 'ipad', testMatch: 'jessica.spec.js', use: devices['iPad (gen 7) landscape'] },
    { name: 'ipad-portrait', testMatch: 'jessica.spec.js', use: devices['iPad (gen 7)'] },
  ],
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173/index.html',
    stderr: 'ignore',
    reuseExistingServer: !process.env.CI,
  },
});
