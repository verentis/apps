import { assert, libraryPath, mime, precedent } from './model.mjs'

export async function publish(p, files, now = new Date().toISOString()) {
  assert(p.confirmed === true, 'Confirm that the wording is cleared for firm reuse and contains no client details.')
  const record = precedent({ ...p, kind: 'precedent', approvedAt: now })
  const path = libraryPath(record.code, record.revision)
  await files.write(path, JSON.stringify(record), { contentType: mime('precedent'), ifNoneMatch: '*' })
  return { path, message: `Published ${record.code} revision ${record.revision}` }
}
export default async function library(engine) {
  await engine.output.result(await publish(engine.context.input.parameters, engine.files))
}
