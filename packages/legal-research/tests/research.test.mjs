import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalog } from '../src/catalog.mjs'
import { home } from '../src/page.mjs'
import { lawPack } from '../../../tools/file-apps/law-pack.mjs'

// Evaluate the authored expressions against browser-shaped snapshots; the Canvas renderer
// independently validates its expression language and reactive bindings.
const evaluate = (name, data, state) => Function('data', 'state', `return (${home.spec.data[name].expr})`)(data, state)
test('only installed jurisdictions enter searches, with no external requests', () => {
  const extra = { id: 'NA:example', citation: 'Example Act', topic: 'Privacy', instrument: 'Example', jurisdiction: 'NA' }
  const authorities = evaluate('authorities', { core: catalog, packs: [{ data: { authorities: [extra] } }] }, {})
  assert.deepEqual(evaluate('results', { authorities }, { country: 'NA', query: ' PRIVACY ' }), [extra])
  const za = evaluate('results', { authorities }, { country: 'ZA', query: 'popia s 21' })
  assert.equal(za[0].id, 'ZA:popia:s21')
  assert.equal(evaluate('selected', { results: za }, { selected: extra.id }), undefined)
})
test('two dates straddling a recorded change resolve to different pinned revisions', () => {
  const selected = catalog.authorities.find(a => a.id === 'ZA:constitution:s6')
  const state = { firstdate: '2026-06-25', seconddate: '2026-06-26' }
  const first = evaluate('firstdate', { selected }, state), second = evaluate('seconddate', { selected }, state)
  assert.equal(first.from, '1997-02-04')
  assert.equal(second.from, '2026-06-26')
  assert.notEqual(first.url, second.url)
})
test('before commencement, outside review window and as-enacted coverage do not infer a version', () => {
  const selected = catalog.authorities.find(a => a.id === 'ZA:popia:s21')
  for (const firstdate of ['2019-12-31', '2030-01-01']) assert.ok(!evaluate('firstdate', { selected }, { firstdate }))
  assert.ok(!evaluate('firstdate', { selected: catalog.authorities.find(a => a.coverage === 'As enacted only') }, { firstdate: '2020-01-01' }))
})
test('duplicate authorities cannot silently replace a citation', () => {
  const entry = { key: 'test:s1', path: 'act/section-001.md' }
  assert.throws(() => lawPack({ ...catalog, checkedThrough: '2026-11-16' }, [entry, entry]), /Duplicate/)
})
