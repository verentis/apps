// Creates a new Documents record for the workspace "New" menu. Inside the app's containers the script writes the
// record itself, create-only, with the file access its installer consented to (manifest `file-access`), and returns
// `{ path }`; a taken name moves on to the next code. Elsewhere (a parent outside its grants, another branch, or a
// token without write access) it returns the `{ name, content }` proposal the workspace writes with the user's token.
//
// Beyond the shared proposal flow, document cards get their tags defaulted here: the card's workspace (defaulted
// from the Documents settings) names its `defaultTags`, which fill a card created without tags. A missing or
// unreadable workspace leaves the tags empty; the card is still created. The card's `filePath` stays empty — the
// referenced file already lives in the VFS and is never created, copied or stored by this app.
import config from './config.mjs'
import { propose } from './propose.mjs'

/** The containers this script declares `file-access: write` on (see manifest.yaml). */
export const writableRoots = config.writableRoots
export const attempts = 5

const lower = value => value.toLowerCase()
const within = path => writableRoots.some(root => lower(path) === lower(root) || lower(path).startsWith(`${lower(root)}/`))
const statusOf = error => error?.statusCode ?? error?.status

/** Reads the settings files new records take defaults from; unreadable ones are skipped. */
export async function readDefaults(files) {
  const documents = {}
  for (const path of config.settingsFiles ?? []) {
    try {
      documents[path] = await files.readJson(path)
    } catch {
      // Defaults are a convenience: the form still opens with the template values.
    }
  }
  return documents
}

/**
 * Fills a document card's empty `tags` from its workspace's `defaultTags`. Anything missing (no workspace chosen,
 * workspace unreadable, no default tags) leaves the tags empty.
 */
export async function applyWorkspaceTags(record, files) {
  if (record?.kind !== 'document' || (Array.isArray(record.tags) && record.tags.length) || !record.workspace || !files) return record
  try {
    const workspace = await files.readJson(record.workspace)
    if (workspace?.kind === 'workspace' && Array.isArray(workspace.defaultTags)) {
      record.tags = workspace.defaultTags.filter(tag => typeof tag === 'string' && tag.trim()).slice(0, 50)
    }
  } catch {
    // The tags are a convenience: the card is still created without them.
  }
  return record
}

/**
 * Proposes the record and, when it falls inside a writable container on the files client's branch, creates it
 * create-only, retrying a taken name with the next proposal. `files` is the engine SDK files client.
 */
export async function createRecord(input, settings, files, { branch = 'main', uuid } = {}) {
  const siblings = Array.isArray(input?.siblings) ? [...input.siblings] : []
  const documents = files ? await readDefaults(files) : {}
  for (let attempt = 1; ; attempt++) {
    const proposal = propose({ ...input, siblings }, settings, uuid, documents)
    await applyWorkspaceTags(proposal.content, files)
    const parent = input.parentPath.replace(/\/+$/, '')
    const path = `${parent}/${proposal.name}`
    const sameBranch = (input.branch ?? branch).toLowerCase() === branch.toLowerCase()
    if (!files || !sameBranch || !within(path)) return proposal
    try {
      await files.write(path, JSON.stringify(proposal.content, null, 2), { contentType: input.mime || 'application/json', ifNoneMatch: '*' })
      return { path }
    } catch (error) {
      if (statusOf(error) === 403) return proposal
      if (statusOf(error) !== 412 || attempt >= attempts) throw error
      siblings.push(proposal.name)
    }
  }
}

export default async function create(engine) {
  const result = await createRecord(engine.context.input.parameters, engine.settings, engine.files,
    { branch: engine.context.file?.branch || 'main' })
  await engine.output.result(result)
}
