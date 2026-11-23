import { assert, child, clients, contracts, digest, key, mime, officeMime, schedules } from './model.mjs'

async function emit(files, path, content, contentType) {
  try {
    await files.write(path, content, { contentType, ifNoneMatch: '*' })
  } catch (error) {
    if ((error.statusCode ?? error.status) !== 412) throw error
    assert(await files.readText(path) === content, `Conflicting artifact at ${path}. Nothing was overwritten.`)
  }
}
export async function issue({ path, version }, files) {
  child(path, contracts)
  const meta = await files.stat(path)
  assert(meta?.etag && meta.etag !== '*', 'A contract ETag is required.')
  const doc = await files.readJson(path)
  assert(doc.kind === 'contract' && path === `${contracts}/${key(doc.code)}`, 'Invalid contract identity.')
  assert(doc.stage === 'approved' || doc.stage === 'issued', 'Only approved snapshots can be issued.')
  assert(doc.version === version, 'Reload the approved revision before issuing.')
  const snap = doc.snapshot
  assert(snap && digest(snap.client) === snap.clientSha256 && digest(snap.schedule) === snap.scheduleSha256 &&
    typeof snap.office === 'string' && digest(snap.office) === snap.officeSha256, 'The approval snapshot failed its digest check.')
  const provenance = JSON.parse(snap.schedule)
  assert(provenance.clientSha256 === snap.clientSha256 && provenance.officeSha256 === snap.officeSha256, 'The schedule does not match the approved client files.')
  const client = `${clients}/${doc.code}.txt`
  const office = `${clients}/${doc.code}.fodt`
  const schedule = `${schedules}/${doc.code}.json`
  // Materialise the private schedule first. A retry checks prior bytes instead of overwriting any artifact.
  await emit(files, schedule, snap.schedule, 'application/json')
  await emit(files, client, snap.client, 'text/plain; charset=utf-8')
  await emit(files, office, snap.office, officeMime)
  if (doc.stage === 'approved') {
    Object.assign(doc, { stage: 'issued', version: doc.version + 1, clientPath: client, officePath: office, schedulePath: schedule })
    await files.write(path, JSON.stringify(doc), { contentType: mime('contract'), ifMatch: meta.etag })
  }
  return { path, client, office, schedule, message: 'Verified TXT, editable FODT and separate internal source schedule.' }
}
export default async function main(engine) {
  await engine.output.result(await issue(engine.context.input.parameters, engine.files))
}
