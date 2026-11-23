import { generate, json } from '../../../tools/file-apps/build.mjs'
import { catalog } from './catalog.mjs'
import { documentFileAccess } from '../../../tools/file-apps/canvas.mjs'
import { researchPage, packPath, packMime } from '../../legal-research/src/page.mjs'

const id = 'south-africa-law'
const root = `/applications/${id}`
const page = researchPage(id, 'South Africa Law', 'ZA')
const manifest = {
  'api-version': 'verentis.io/v1', kind: 'Application',
  metadata: { id, name: 'South Africa Law', version: '0.1.0', author: 'Verentis', icon: './icons/app.svg', description: 'Add selected South African legislation and provision citations to Legal Research.' },
  marketplace: {
    logo: './icons/app.svg', readme: './marketplace/README.md', keywords: ['south africa', 'law', 'jurisdiction'],
    hero: { source: './marketplace/hero.svg', alt: 'Law library shelves' },
    images: [{ source: './marketplace/overview.png', alt: 'South African authorities in Legal Research', caption: 'Browse the South African index' },
      { source: './marketplace/detail.png', alt: 'Dated references for Constitution section 6', caption: 'Trace a change to its source' }],
  },
  spec: {
    scope: 'global', 'install-root': root, entry: 'https://canvas.apps.localtest.me',
    'entry-points': [{ id: 'home', 'display-name': 'South African authorities', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 }],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    dependencies: [{ package: 'verentis/legal-research', version: 'latest' }, { package: 'verentis/canvas', version: 'latest' }],
    permissions: ['file.read'], scopes: ['south-africa-law.default'], 'file-access': documentFileAccess({ 'home.page.yaml': page }),
    install: [
      { from: 'catalog/authorities.json', to: `${packPath}/ZA`, mode: 'managed', mime: packMime },
      { from: 'canvas/home.page.yaml', to: `${root}/canvas/home.page.yaml`, mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' },
    ],
    sandbox: { 'allow-scripts': true, 'allow-same-origin': true, 'allow-forms': true, 'allow-popups': true },
  },
  packaging: { publisher: 'verentis', files: ['catalog/**', 'canvas/**', 'README.md'], encryption: 'none' },
}
const overlay = entry => json({ 'api-version': manifest['api-version'], kind: manifest.kind, metadata: { id }, spec: { entry } })
await generate({ root: new URL('../', import.meta.url), label: 'South Africa Law', directories: ['catalog', 'canvas'], outputs: {
  'south-africa-law.app.yaml': json(manifest), 'catalog/authorities.json': json(catalog), 'canvas/home.page.yaml': json(page),
  'environments/feature.yaml': overlay('https://canvas.${param:apps-domain}'), 'environments/production.yaml': overlay('https://canvas.apps.verentis.io'),
} })
