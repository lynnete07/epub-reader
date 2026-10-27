const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/browser',
    fullyParallel: false,
    timeout: 30_000,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        viewport: { width: 1280, height: 900 },
        trace: 'retain-on-failure',
        // 本机复用已安装的 Chrome；CI 不设置 channel，按常规安装 Playwright Chromium。
        channel: process.env.CI ? undefined : 'chrome'
    },
    webServer: {
        command: 'PORT=4173 node server.js',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 15_000
    }
});
