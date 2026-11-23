import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { memoryFiles } from '../../../../tools/file-apps/memory-files.mjs'
import { run as draft } from '../../../../packages/contract-studio/scripts/draft/main.mjs'
import { issue } from '../../../../packages/contract-studio/scripts/issue/main.mjs'
import { publish } from '../../../../packages/contract-studio/scripts/library/main.mjs'
import { run as matterWorkflow } from '../../../../packages/legal-matters/scripts/workflow/main.mjs'

export async function practiceScenario({ root, canvas, browser, files, packs, bundle, outcomes }) {
  const load = (app, path) => readFile(join(root, 'packages', app, path), 'utf8')
  const matter = '/legal-matters/MAT-DEMO'
  const agreement = '/legal-contracts/AGR-DEMO'
  const subject = JSON.parse(await load('legal-matters', 'tests/fixtures/gallery-matter.json'))
  const store = memoryFiles({ ...files, [matter]: subject,
    [subject.parties[0].crm]: { kind: 'company', state: 'active', name: subject.parties[0].name },
    [subject.project]: { kind: 'project', state: 'active' },
    '/settings/invoicing.json': { defaultDueDays: 14, defaultTaxRate: '15' },
    '/settings/accounting.json': { baseCurrency: 'ZAR', minorDigits: 2 }, '/legal-billing-register': { version: 1, batches: [] },
  })
  store.readText = async path => store.nodes.get(path).content
  await draft({ operation: 'create', code: 'AGR-DEMO', title: 'Workshop services agreement', matter }, store)
  const catalog = '/applications/legal-research/catalog/authorities.json'
  const clause = await publish({ code: 'RECORDS', title: 'Project records', revision: 1, jurisdiction: 'ZA',
    wording: 'The studio will retain the approved delivery schedule.', intendedUse: 'Services agreements', confirmed: true, approvedBy: 'Pilot counsel' }, store)
  const listings = { '/legal-precedents': [{ kind: 'file', path: clause.path, name: 'RECORDS-v1', mimeType: 'application/vnd.verentis.contract-studio.precedent+json' }], '/legal-contracts': [
    { kind: 'file', path: agreement, name: 'AGR-DEMO', mimeType: 'application/vnd.verentis.contract-studio.contract+json' },
  ] }
  for (const [app, file, bound, mime] of [
    ['legal-matters', 'home.page.yaml'], ['legal-matters', 'matter.form.yaml', matter, 'application/vnd.verentis.legal-matters.matter+json'],
    ['contract-studio', 'home.page.yaml'], ['contract-studio', 'contract.form.yaml', agreement, 'application/vnd.verentis.contract-studio.contract+json'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
    await page.route('**/*', route => route.abort())
    await page.exposeFunction('readRecord', path => store.readJson(path))
    await page.exposeFunction('runPackageScript', ({ file: script, parameters }) => {
      if (script === '/applications/contract-studio/scripts/draft') return draft(parameters, store)
      if (script === '/applications/contract-studio/scripts/issue') return issue(parameters, store)
      if (script === '/applications/legal-matters/scripts/workflow') {
        const id = '3f45b8f0-af7f-45fb-b456-471956dab8bd'
        return matterWorkflow({ files: store, context: { workspace: { id }, file: { branch: 'main' }, input: { parameters } },
          settings: { get: k => ({ 'synthetic-workspace-id': id, 'pilot-mode': 'isolated-synthetic' })[k] } })
      }
      throw Error(`Unexpected script: ${script}`)
    })
    await page.setContent('<main id="app"></main>')
    await page.addStyleTag({ content: 'body{margin:0;font:16px system-ui,sans-serif}*{box-sizing:border-box}' })
    await page.addStyleTag({ path: join(canvas, 'packages/components/src/styles.css') })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(args => window.renderDocument(args), {
      document: await load(app, `canvas/${file}`), files: { ...files, [agreement]: store.json(agreement), [clause.path]: store.json(clause.path) }, packs, listings,
      binding: bound ? { path: bound, name: bound.split('/').pop(), branch: 'main', nodeId: 'demo', mimeType: mime } : undefined,
    })
    await page.getByRole('heading').first().waitFor()
    if (app === 'legal-matters' && bound) {
      await page.getByRole('button', { name: 'Screen / re-screen' }).click()
      await page.getByText(/Potential matches: 0/).waitFor()
      await page.getByLabel('Agreed one-off fixed fee (optional)').fill('1250')
      await page.getByLabel('Disposition', { exact: true }).selectOption({ label: 'clear' })
      await page.getByLabel('Decision, checks performed and waiver evidence').fill('Synthetic conflict review completed.')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.getByRole('button', { name: 'Record decision' }).click()
      await page.getByRole('heading', { name: 'Matter · open' }).waitFor()
      await page.getByLabel('Pre-bill approver (recorded name)').fill('Pilot reviewer')
      const work = page.locator('.cv-c-card').filter({ hasText: 'Work in progress' })
      await work.getByRole('button', { name: 'Add row' }).click()
      await work.getByLabel('Charge', { exact: true }).selectOption({ label: 'fixed-fee' })
      await work.getByLabel('Narrative approved for the client').fill('Workshop agreement review')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.getByRole('button', { name: 'Prepare pre-bill' }).click()
      await page.getByRole('cell', { name: 'Workshop agreement review' }).waitFor()
      await page.getByRole('button', { name: 'Approve / resume draft' }).click()
      await page.getByRole('cell', { name: /^\/invoices\/LM-/ }).waitFor()
      const [invoice] = store.json(matter).invoices
      assert.equal(store.json(invoice).status, 'draft')
      assert.equal(store.json(invoice).lines[0].description, 'Workshop agreement review')
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    if (app === 'contract-studio' && bound) {
      const wording = 'The workshop begins on the date agreed by both parties.'
      await page.getByLabel('Stable point ID').fill('start')
      await page.getByLabel('Inline wording / local variation').fill(wording)
      await page.getByRole('button', { name: 'Add inline point' }).click()
      await page.getByRole('cell', { name: wording, exact: true }).waitFor()
      await page.getByLabel('Stable point ID').fill('records')
      await page.getByLabel('Inline wording / local variation').fill('')
      await page.getByLabel('Firm revision', { exact: true }).selectOption({ label: 'Project records · RECORDS v1 · ZA' })
      await page.getByRole('button', { name: 'Insert firm revision' }).click()
      await page.getByRole('cell', { name: 'RECORDS v1', exact: true }).waitFor()
      const picker = page.getByLabel('Authority', { exact: true })
      const option = picker.getByRole('option', { name: /ZA · POPIA s 21/ })
      await picker.selectOption({ label: await option.innerText() })
      await page.getByLabel('Pinpoint in the cited provision').fill('s 21')
      await page.getByRole('button', { name: 'Attach citation to point' }).click()
      await page.getByRole('cell', { name: /POPIA s 21/ }).waitFor()
      await page.getByRole('button', { name: 'Submit for review' }).click()
      await page.getByLabel('Approving reviewer').fill('Synthetic reviewer')
      await page.getByRole('button', { name: 'Approve and freeze' }).click()
      await page.getByRole('button', { name: /Issue or verify/ }).click()
      await page.getByRole('button', { name: 'Open internal schedule' }).waitFor()
      const result = store.json(agreement)
      assert.equal(result.stage, 'issued')
      assert.equal(result.points[1].authority.sourceUrl, files[catalog].authorities[0].sourceUrl)
      assert.match(await store.readText(result.clientPath), /workshop begins/)
      assert.doesNotMatch(await store.readText(result.clientPath), /POPIA|Synthetic reviewer/)
      assert.match(await store.readText(result.schedulePath), /ZA:popia:s21/)
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    assert.deepEqual(errors, [])
    await page.screenshot({ path: join(outcomes, `${app}-${bound ? 'detail' : 'overview'}.png`) })
    await page.close()
  }
  console.log('practice: screened and cleared matter, created invoice draft, and issued agreement with inline, firm and cited wording through Canvas actions')
}
