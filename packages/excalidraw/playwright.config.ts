import { defineConfig } from '@playwright/test'

const outcomes = './tests/scenarios/desktop-1000-1440x900/outcomes'
export default defineConfig({
  testDir: './tests/browser',
  outputDir: `${outcomes}/browser-artifacts`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${outcomes}/${process.env.PERFORMANCE === '1' ? 'performance-run' : 'browser-smoke'}.json` }],
  ],
  use: { baseURL: 'http://127.0.0.1:3303', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, headless: true },
  webServer: {
    command: 'NUXT_PUBLIC_CREATE_ONLY_API_URL=https://workspace.synthetic.test HOST=127.0.0.1 PORT=3303 node .output/server/index.mjs',
    url: 'http://127.0.0.1:3303/_ready',
    reuseExistingServer: !process.env.CI,
  },
})
