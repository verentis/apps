import { lawPack } from '../../../tools/file-apps/law-pack.mjs'
import { revision } from './revision.mjs'
import instruments from './instruments.json' with { type: 'json' }

const popia = 'Protection of Personal Information Act 4 of 2013'
const constitution = 'Constitution of the Republic of South Africa, 1996'
const justice = 'https://www.justice.gov.za/legislation/constitution/SAConstitution-web-eng.pdf'
const privacy = 'https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013popi.pdf'
export const catalog = lawPack({
  jurisdiction: 'ZA', repository: 'lexifina/south-africa-law',
  revision, checkedThrough: '2026-11-16',
}, [
  { key: 'popia:s21', instrument: popia, provision: 's 21', citation: 'POPIA s 21', topic: 'Security measures by operators', officialUrl: privacy,
    coverage: 'Provision history', path: 'act/2013/4/section-021.md',
    snapshots: [['2020-07-01', '504bfa49963b1677fda517093562d22acd5c158c', 'popia/section-021.md']] },
  { key: 'constitution:s6', instrument: constitution, provision: 's 6', citation: 'Constitution s 6', topic: 'Official languages', officialUrl: justice,
    coverage: 'Provision history', path: 'constitution/constitution/section-006.md',
    snapshots: [['1997-02-04', '05f6c31aa18c744b50df7f97777a52f949b78086', 'constitution/section-006.md'],
      ['2026-06-26', '81e64e83c8b583426ae0565d4dbd7a3c7dcdd28f', 'constitution/section-006.md']] },
  { key: 'constitution:s14', instrument: constitution, provision: 's 14', citation: 'Constitution s 14', topic: 'Privacy', officialUrl: justice,
    coverage: 'Reference only', path: 'constitution/constitution/section-014.md' },
  { key: 'companies:s75', instrument: 'Companies Act 71 of 2008', provision: 's 75', citation: 'Companies Act 71 of 2008 s 75',
    topic: 'Directors and personal financial interests', officialUrl: 'https://www.gov.za/sites/default/files/gcis_document/201409/321214210.pdf',
    coverage: 'Reference only', path: 'act/2008/71/section-075.md' },
  { key: 'legal-practice:s86', instrument: 'Legal Practice Act 28 of 2014', provision: 's 86', citation: 'Legal Practice Act 28 of 2014 s 86',
    topic: 'Trust accounts', officialUrl: 'https://www.justice.gov.za/legislation/acts/2014-028.pdf',
    coverage: 'Consolidation only', path: 'act/2014/28/section-086.md' },
  { key: 'consumer-protection:s49', instrument: 'Consumer Protection Act 68 of 2008', provision: 's 49', citation: 'Consumer Protection Act 68 of 2008 s 49',
    topic: 'Notice of terms and conditions', officialUrl: 'https://www.gov.za/documents/consumer-protection-act',
    coverage: 'As enacted only', path: 'act/2008/68/section-049.md' },
  ...instruments.map(({ slug, title, path, url, coverage }) => ({
    key: slug, instrument: title, provision: 'Whole instrument', citation: title, topic: 'Instrument directory',
    officialUrl: url, coverage, path: `${path}/README.md`,
  })),
])
