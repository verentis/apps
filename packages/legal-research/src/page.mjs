import { apiVersion, card, column, folder, grid, heading, page, status, table, text } from '../../../tools/file-apps/canvas.mjs'

export const packPath = '/legal-authority-packs'
export const packMime = 'application/vnd.verentis.legal-research.pack+json'
const computed = expr => ({ kind: 'computed', expr })
const field = (type, label, key, extra = {}) => ({ type: `canvas.form.${type}`, props: { label, value: `{{ state.${key} }}`, ...extra } })
const link = (label, expression) => ({
  type: 'canvas.link', props: { text: label, href: `{{ ${expression} }}`, external: true },
  rules: { visible: `String(${expression} || '').startsWith('https://')` },
})
const version = key => `data.selected && state.${key} && state.${key} <= data.selected.checkedThrough && (data.selected.versions || []).filter(v => v.from <= state.${key}).slice(-1)[0]`
const compare = (label, key) => column([
  field('date', label, key),
  { ...text('Coverage unknown for this date; no wording inferred.', 'muted'), rules: { visible: `!!state.${key} && !data.${key}` } },
  { ...text(`Recorded change effective {{ data.${key}.from }}`), rules: { visible: `!!data.${key}` } },
  link(`Open ${label.toLowerCase()} source`, `data.${key}.url`),
])

export function researchPage(id, name, country = '') {
  return {
  'api-version': apiVersion, kind: 'Page', metadata: { id: `${id}-home`, name, icon: 'library' },
  spec: {
    access: [{ path: packPath, reason: 'Read installed jurisdiction indexes' }],
    data: {
      packs: folder(packPath, packMime),
      authorities: computed('(data.packs || []).flatMap(e => (e.data && e.data.authorities) || [])'),
      results: computed("(data.authorities || []).filter(a => (!state.country || a.jurisdiction === state.country) && [a.id,a.instrument,a.citation,a.topic].join(' ').toLowerCase().includes(state.query.trim().toLowerCase()))"),
      countries: computed("(data.authorities || []).map(a => a.jurisdiction).filter((c,i,all) => all.indexOf(c) === i).map(c => ({label:c,value:c}))"),
      selected: computed('(data.results || []).find(a => a.id === state.selected)'),
      firstdate: computed(version('firstdate')), seconddate: computed(version('seconddate')),
    },
    state: { query: '', country, selected: '', firstdate: '', seconddate: '' },
    tree: page([
      heading(name), text('Find a statute or provision and check the source before relying on it. Search stays in your workspace.', 'muted'),
      grid([field('input', 'Find a citation, instrument or topic', 'query', { placeholder: 'e.g. POPIA, trust accounts or s 49' }),
        field('select', 'Jurisdiction', 'country', { display: 'segmented', options: "{{ [{label:'All jurisdictions',value:''}].concat(data.countries || []) }}" })]),
      ...status('packs'),
      { ...text('Install a country pack such as South Africa Law or Namibia Law to search its citations.'), rules: { visible: 'data.packs && data.packs.length === 0' } },
      text("{{ (data.results || []).length }} {{ (data.results || []).length === 1 ? 'match' : 'matches' }}", 'muted'),
      // The box above is the search; the table pages through every match and marks the one whose detail is open.
      { type: 'canvas.table',
        props: {
          rows: '{{ data.results || [] }}', rowKey: 'id', selected: '{{ state.selected }}', clickable: true, sortable: true, pageSize: 12, narrow: 'list',
          columns: [{ key: 'jurisdiction', label: 'Jurisdiction', format: 'badge' }, { key: 'citation', label: 'Citation' }, { key: 'topic', label: 'Topic' }, { key: 'coverage', label: 'Coverage' }],
          emptyText: 'No matching authority.',
        },
        on: { 'row-click': [{ 'set-state': { key: 'selected', value: '{{ event.id }}' } }] } },
      { ...card('{{ data.selected.citation }}', [
        text('{{ data.selected.instrument }} · {{ data.selected.topic }}'),
        text('Link only. This index does not grant permission to copy statutory wording. Research notes are not sent to the source.', 'muted'),
        link('Open pinned provision', 'data.selected.sourceUrl'), link('Open source publication', 'data.selected.officialUrl'),
        text('Compare two dates within the recorded history. A publication link alone does not establish commencement.', 'muted'),
        grid([compare('Earlier date', 'firstdate'), compare('Later date', 'seconddate')]),
        { ...text("{{ data.firstdate.revision === data.seconddate.revision ? 'Both dates resolve to the same recorded wording.' : 'The recorded wording changed between the selected dates.' }}"),
          rules: { visible: '!!data.firstdate && !!data.seconddate' } },
      ]), rules: { visible: '!!data.selected' } },
    ]),
  },
}
}
export const home = researchPage('legal-research', 'Legal Research')

/** The installed packs this reader searches: jurisdiction, revision, how many authorities and how far they are checked. */
export const packsPage = {
  'api-version': apiVersion, kind: 'Page', metadata: { id: 'legal-research-packs', name: 'Packs', icon: 'package' },
  spec: {
    access: [{ path: packPath, reason: 'List the installed jurisdiction packs' }],
    data: { packs: folder(packPath, packMime) },
    tree: page([
      heading('Packs'), text('The jurisdiction packs installed in this workspace. Install or update a pack such as South Africa Law to add authorities.', 'muted'),
      ...status('packs'),
      table("{{ (data.packs || []).filter(e => e.data).map(e => ({ pack: e.data.name || e.data.title || e.name, jurisdiction: e.data.jurisdiction || ((e.data.authorities || [])[0] || {}).jurisdiction || '', revision: e.data.revision || e.data.version || '', authorities: (e.data.authorities || []).length, checked: e.data.checkedThrough || '' })) }}",
        [['pack', 'Pack'], ['jurisdiction', 'Jurisdiction', undefined, 'badge'], ['revision', 'Revision'], ['authorities', 'Authorities', 'end'], ['checked', 'Checked through', undefined, 'date']], 'No pack is installed yet.'),
    ]),
  },
}
