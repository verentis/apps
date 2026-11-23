import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const canvas = resolve(process.env.CANVAS_CHECKOUT || join(root, '../canvas'))
const { build } = createRequire(join(canvas, 'package.json'))('esbuild')
const { chromium } = createRequire(join(process.env.APPS_TOOLING || root, 'package.json'))('playwright')
const src = await readFile(join(here, 'render.mjs'), 'utf8')
const bundle = await build({ stdin: { contents: src, resolveDir: canvas }, bundle: true, platform: 'browser', format: 'iife',
  write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } })
const base = '/applications/legal-research/catalog/authorities.json'
const extra = '/legal-authority-packs/NA'
const files = Object.fromEntries(await Promise.all([[base, 'legal-research'], [extra, 'namibia-law']].map(async ([path, app]) =>
  [path, JSON.parse(await readFile(join(root, 'packages', app, 'catalog/authorities.json'), 'utf8'))])))
const packs = [{ name: 'NA', path: extra, kind: 'file', mimeType: 'application/vnd.verentis.legal-research.pack+json' }]
const outcomes = join(here, 'outcomes')
await mkdir(outcomes, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [app, label, first, second] of [
    ['legal-research', 'Constitution s 6', '2026-06-25', '2026-06-26'],
    ['namibia-law', 'Labour Act 11 of 2007 s 11', '2023-03-14', '2023-03-15'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.abort())
    await page.setContent('<main id="app"></main>')
    await page.addStyleTag({ content: 'body{margin:0;font:16px system-ui,sans-serif}*{box-sizing:border-box}' })
    await page.addStyleTag({ path: join(canvas, 'packages/components/src/styles.css') })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(args => window.renderDocument(args), {
      document: await readFile(join(root, 'packages', app, 'canvas/home.page.yaml'), 'utf8'), files, packs,
    })
    const sourceRow = page.getByRole('row').filter({ has: page.getByText(label, { exact: true }) })
    await sourceRow.waitFor()
    await page.screenshot({ path: join(outcomes, `${app}-overview.png`) })
    await page.getByPlaceholder('e.g. POPIA, trust accounts or s 49').fill(label)
    await sourceRow.click()
    await page.getByRole('link', { name: 'Open pinned provision' }).waitFor()
    await page.locator('input[type=date]').nth(0).fill(first)
    await page.locator('input[type=date]').nth(1).fill(second)
    await page.getByText('The recorded wording changed between the selected dates.').waitFor()
    assert.notEqual(await page.getByRole('link', { name: 'Open earlier date source' }).getAttribute('href'),
      await page.getByRole('link', { name: 'Open later date source' }).getAttribute('href'))
    await page.screenshot({ path: join(outcomes, `${app}-comparison.png`) })
    await page.locator('input[type=date]').nth(1).fill('2040-01-01')
    await page.getByText('Coverage unknown for this date; no wording inferred.').waitFor()
    assert.equal(await page.getByRole('link', { name: 'Open later date source' }).count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${app}: citation search, source comparison and unknown coverage passed`)
  }
  const { practiceScenario } = await import('./practice.mjs')
  await practiceScenario({ root, canvas, browser, files, packs, bundle, outcomes })
} finally {
  await browser.close()
}
