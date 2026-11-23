import { generate, json } from '../../../tools/file-apps/build.mjs'
import { documentFileAccess } from '../../../tools/file-apps/canvas.mjs'
import { catalog } from './catalog.mjs'
import { basePath, home, packMime, packPath } from './page.mjs'

const id = 'legal-research'
const pages = { 'home.page.yaml': home }
const manifest = {
  'api-version': 'verentis.io/v1', kind: 'Application', metadata: {
    id, name: 'Legal Research', version: '0.1.0', author: 'Verentis', icon: './icons/app.svg',
    description: 'Find legal authorities by citation or topic and compare the sources recorded for two dates.',
  },
  marketplace: {
    logo: './icons/app.svg', readme: './marketplace/README.md', keywords: ['law', 'South Africa', 'legislation', 'legal research'],
    hero: { source: './marketplace/hero.svg', alt: 'Green law library shelves' },
    images: [{ source: './marketplace/overview.png', alt: 'Jurisdiction and citation search', caption: 'Find sources by topic or citation' },
      { source: './marketplace/detail.png', alt: 'Two dated Constitution section 6 citations', caption: 'Compare recorded provision versions' }],
  },
  spec: {
    scope: 'global', 'install-root': `/applications/${id}`, entry: 'https://canvas.apps.localtest.me',
    'entry-points': [{ id: 'home', 'display-name': 'Find authorities', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 }],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    dependencies: [{ package: 'verentis/canvas', version: 'latest' }], permissions: ['file.read'], scopes: ['legal-research.default'],
    'file-access': documentFileAccess(pages),
    install: [
      { from: 'canvas/home.page.yaml', to: `/applications/${id}/canvas/home.page.yaml`, mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' },
      { from: 'catalog/authorities.json', to: basePath, mode: 'managed', mime: packMime },
      { from: 'seed/packs', to: packPath, mode: 'seed', mime: 'application/vnd.verentis.legal-research.packs' },
    ],
    sandbox: { 'allow-scripts': true, 'allow-same-origin': true, 'allow-forms': true, 'allow-popups': true },
  },
  packaging: { publisher: 'verentis', files: ['catalog/**', 'canvas/**', 'seed/**', 'README.md'], encryption: 'none' },
}
const overlay = entry => json({ 'api-version': manifest['api-version'], kind: manifest.kind, metadata: { id }, spec: { entry } })
await generate({ root: new URL('../', import.meta.url), label: 'Legal Research', directories: ['canvas', 'catalog', 'seed'], outputs: {
  'legal-research.app.yaml': json(manifest), 'canvas/home.page.yaml': json(home), 'catalog/authorities.json': json(catalog), 'seed/packs': '',
  'environments/feature.yaml': overlay('https://canvas.${param:apps-domain}'), 'environments/production.yaml': overlay('https://canvas.apps.verentis.io'),
} })
