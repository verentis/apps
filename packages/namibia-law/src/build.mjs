import { generate, json } from '../../../tools/file-apps/build.mjs'
import { lawPack } from '../../../tools/file-apps/law-pack.mjs'
import { documentFileAccess } from '../../../tools/file-apps/canvas.mjs'
import { home, packPath, packMime } from '../../legal-research/src/page.mjs'

const id = 'namibia-law'
const catalog = lawPack({
  repository: 'lexifina/namibia-law', revision: 'e46aaa41315de063236d6df919829a7f6db63cf8', jurisdiction: 'NA', checkedThrough: '2026-11-16',
}, [
  { key: 'labour:s11', instrument: 'Labour Act 11 of 2007', provision: 's 11', citation: 'Labour Act 11 of 2007 s 11', topic: 'Payment of remuneration',
    officialUrl: 'https://namiblii.org/akn/na/act/2007/11', coverage: 'Provision history', path: 'labour/sec-011.md',
    snapshots: [['2012-08-01', 'e9b3db8ec712a3403af5c13e323f48d0bec3406f', 'labour/sec-011.md'],
      ['2023-03-15', '991a613e786a610edc7fede7793a31fd2c3df090', 'labour/sec-011.md']] },
  { key: 'companies:s11', instrument: 'Companies Act 28 of 2004', provision: 's 11', citation: 'Companies Act 28 of 2004 s 11', topic: 'Company law',
    officialUrl: 'https://namiblii.org/akn/na/act/2004/28', coverage: 'Reference only', path: 'companies/sec-011.md' },
])
const root = `/applications/${id}`
const page = { ...home, metadata: { ...home.metadata, id: 'namibia-law-home', name: 'Namibia Law' }, spec: { ...home.spec, state: { ...home.spec.state, country: 'NA' } } }
const manifest = {
  'api-version': 'verentis.io/v1', kind: 'Application',
  metadata: { id, name: 'Namibia Law', version: '0.1.0', author: 'Verentis', icon: './icons/app.svg', description: 'Add selected Namibian labour and company law citations to Legal Research.' },
  marketplace: {
    logo: './icons/app.svg', readme: './marketplace/README.md', keywords: ['namibia', 'law', 'jurisdiction'],
    hero: { source: './marketplace/hero.svg', alt: 'Sandstone library columns' },
    images: [{ source: './marketplace/overview.png', alt: 'Namibian authorities in Legal Research', caption: 'Browse the Namibian index' },
      { source: './marketplace/detail.png', alt: 'Dated references for Labour Act section 11', caption: 'Trace a change to its source' }],
  },
  spec: {
    scope: 'global', 'install-root': root, entry: 'https://canvas.apps.localtest.me',
    'entry-points': [{ id: 'home', 'display-name': 'Namibian authorities', route: '/render?document=.%2Fcanvas%2Fhome.page.yaml', order: 10 }],
    launch: { enabled: true, 'entry-point': 'home', pinnable: true },
    dependencies: [{ package: 'verentis/legal-research', version: 'latest' }, { package: 'verentis/canvas', version: 'latest' }],
    permissions: ['file.read'], scopes: ['namibia-law.default'], 'file-access': documentFileAccess({ 'home.page.yaml': page }),
    install: [
      { from: 'catalog/authorities.json', to: `${packPath}/NA`, mode: 'managed', mime: packMime },
      { from: 'canvas/home.page.yaml', to: `${root}/canvas/home.page.yaml`, mode: 'managed', mime: 'application/vnd.verentis.canvas.page+yaml' },
    ],
    sandbox: { 'allow-scripts': true, 'allow-same-origin': true, 'allow-forms': true, 'allow-popups': true },
  },
  packaging: { publisher: 'verentis', files: ['catalog/**', 'canvas/**', 'README.md'], encryption: 'none' },
}
const overlay = entry => json({ 'api-version': manifest['api-version'], kind: manifest.kind, metadata: { id }, spec: { entry } })
await generate({ root: new URL('../', import.meta.url), label: 'Namibia Law', directories: ['catalog', 'canvas'], outputs: {
  'namibia-law.app.yaml': json(manifest), 'catalog/authorities.json': json(catalog), 'canvas/home.page.yaml': json(page),
  'environments/feature.yaml': overlay('https://canvas.${param:apps-domain}'), 'environments/production.yaml': overlay('https://canvas.apps.verentis.io'),
} })
