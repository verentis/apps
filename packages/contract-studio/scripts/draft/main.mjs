import { assert, authority, catalog, catalogPath, child, contracts, digest, freeze, key, libraryPath, matter, packs,
  mime, precedent, precedents, render, schemaId, string, variables } from './model.mjs'

async function readLibrary(files, path) {
  const record = precedent(await files.readJson(child(path, precedents)))
  assert(libraryPath(record.code, record.revision) === path, 'Library revision does not match its path.')
  return record
}
async function readAuthority(files, path, id) {
  // Resolve pre-split ZA references without rewriting their saved provenance.
  const location = catalogPath(path)
  const source = await files.readJson(location === catalog ? `${packs}/ZA` : location)
  assert(Array.isArray(source?.authorities), 'Invalid authority catalogue.')
  const matches = source.authorities.filter(a => a?.id === id)
  assert(matches.length === 1, 'Choose exactly one known authority from the selected catalogue.')
  return authority(matches[0])
}
async function changes(files, p, point) {
  if (p.sourceKind === 'firm') {
    assert(point.origin === 'firm', 'Select a point based on a firm revision.')
    const next = await readLibrary(files, p.precedentPath)
    assert(next.code === point.precedent.code && next.revision > point.precedent.revision, 'Choose a newer revision of the same firm clause.')
    return { kind: 'firm', before: point.precedent, after: next }
  }
  assert(p.sourceKind === 'authority' && point.authority, 'Select a point with an authority attached.')
  const before = authority(point.authority)
  const after = await readAuthority(files, point.authority.catalog, before.id)
  assert(JSON.stringify(before) !== JSON.stringify(after), 'This authority has not changed.')
  return { kind: 'authority', before, after }
}

export async function run(p, files, now = new Date().toISOString()) {
  if (p.operation === 'create') {
    const code = key(p.code, 'agreement code')
    const path = `${contracts}/${code}`
    const record = { $schema: schemaId, kind: 'contract', code, title: string(p.title, 'contract title', 200),
      matter: matter(p.matter), version: 1, stage: 'draft', points: [], updatedAt: now }
    await files.write(path, JSON.stringify(record), { contentType: mime('contract'), ifNoneMatch: '*' })
    return { path, message: 'Draft created' }
  }
  const path = child(p.path, contracts)
  const meta = await files.stat(path)
  assert(meta?.etag && meta.etag !== '*', 'An ETag is required; reload before editing.')
  const doc = await files.readJson(path)
  assert(doc.kind === 'contract' && path === `${contracts}/${key(doc.code)}`, 'Invalid contract identity.')
  assert(Number.isSafeInteger(p.version) && p.version === doc.version, 'This agreement changed. Reload before continuing.')
  assert(['draft', 'in-review'].includes(doc.stage), 'Approved agreements are frozen.')
  if (p.operation === 'return' || p.operation === 'approve') {
    assert(doc.stage === 'in-review', 'Submit the agreement for review first.')
    if (p.operation === 'approve') {
      doc.snapshot = freeze(doc, p.reviewer, now)
      assert(digest(doc.snapshot.client) === doc.review.clientSha256 &&
        digest(JSON.stringify(render(doc).points)) === doc.review.pointsSha256, 'Reviewed material has changed; return it to draft.')
      doc.stage = 'approved'
    } else {
      doc.stage = 'draft'
      delete doc.review
    }
  } else {
    assert(doc.stage === 'draft', 'Return this agreement to draft before editing.')
    const point = doc.points.find(pt => pt.id === p.pointId)
    const getPoint = () => { assert(point, 'Select an existing point.'); return point }
    const add = data => {
      const id = key(p.pointId, 'new point ID')
      assert(!point && doc.points.length < 100, 'Use a new point ID (maximum 100 points).')
      variables(p.bindings)
      doc.points.push({ id, ...data, bindings: p.bindings || '', note: string(p.note || '', 'internal note', 2000, true) })
    }
    switch (p.operation) {
      case 'metadata':
        doc.title = string(p.title, 'agreement title', 200)
        doc.matter = matter(p.matter)
        break
      case 'add-inline': add({ origin: 'inline', wording: string(p.wording, 'authored wording') }); break
      case 'add-firm': add({ origin: 'firm', precedent: await readLibrary(files, p.precedentPath), variation: '' }); break
      case 'edit-point':
        getPoint()
        if (point.origin === 'inline') point.wording = string(p.wording, 'authored wording')
        else point.variation = string(p.wording || '', 'local variation', 12000, true)
        variables(p.bindings)
        point.bindings = p.bindings || ''
        point.note = string(p.note || '', 'internal note', 2000, true)
        break
      case 'move': {
        getPoint()
        const position = Number(p.position)
        assert(Number.isInteger(position) && position >= 1 && position <= doc.points.length, 'Choose an existing numbered position.')
        doc.points.splice(doc.points.indexOf(point), 1)
        doc.points.splice(position - 1, 0, point)
        break
      }
      case 'remove': doc.points.splice(doc.points.indexOf(getPoint()), 1); break
      case 'attach':
        getPoint().authority = { ...await readAuthority(files, p.catalog, string(p.authorityId, 'authority', 500)),
          catalog: catalogPath(p.catalog), pinpoint: string(p.pinpoint, 'pinpoint', 200), retrievedAt: now }
        delete point.sourceDecision
        break
      case 'detach': delete getPoint().authority; delete point.sourceDecision; break
      case 'compare':
      case 'decide': {
        const comparison = await changes(files, p, getPoint())
        const token = digest(JSON.stringify([path, doc.version, point.id, comparison]))
        if (p.operation === 'compare') return { message: 'Compare the two source revisions below.', token,
          before: JSON.stringify(comparison.before, null, 2), after: JSON.stringify(comparison.after, null, 2) }
        assert(token === p.token && ['accept','reject','defer'].includes(p.decision), 'Preview this exact revision before deciding.')
        if (p.decision === 'accept') {
          if (comparison.kind === 'firm') point.precedent = comparison.after
          else Object.assign(point.authority, comparison.after, { retrievedAt: now })
        }
        point.sourceDecision = { kind: comparison.kind, before: comparison.before.revision, after: comparison.after.revision,
          decision: p.decision, at: now }
        break
      }
      case 'submit': {
        const { client, points } = render(doc)
        doc.stage = 'in-review'
        doc.review = { client, clientSha256: digest(client), pointsSha256: digest(JSON.stringify(points)), submittedAt: now }
        break
      }
      default: throw new Error('Unknown drafting operation.')
    }
  }
  doc.version++
  doc.updatedAt = now
  await files.write(path, JSON.stringify(doc), { contentType: mime('contract'), ifMatch: meta.etag })
  return { path, message: `Saved ${doc.code} · ${doc.stage} · revision ${doc.version}` }
}
export default async function draft(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
