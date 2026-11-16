// Creates a new CRM record for the workspace "New" menu. Inside the CRM containers the script writes the record
// itself, create-only, with the file access its installer consented to (manifest `file-access`), and returns
// `{ path }`; a taken name moves on to the next code. Elsewhere (a parent outside its grants, another branch, or a
// token without write access) it returns the `{ name, content }` proposal the workspace writes with the user's token.
import { propose } from './propose.mjs'

/** The containers this script declares `file-access: write` on (see manifest.yaml). */
export const writableRoots = ['/customers', '/deals', '/cases']
export const attempts = 5

const lower = value => value.toLowerCase()
const within = path => writableRoots.some(root => lower(path) === lower(root) || lower(path).startsWith(`${lower(root)}/`))
const statusOf = error => error?.statusCode ?? error?.status

/**
 * Proposes the record and, when it falls inside a writable container on the files client's branch, creates it
 * create-only, retrying a taken name with the next proposal. `files` is the engine SDK files client.
 */
export async function createRecord(input, settings, files, { branch = 'main', uuid } = {}) {
  const siblings = Array.isArray(input?.siblings) ? [...input.siblings] : []
  const firstAttempt = Number.isInteger(input?.attempt) && input.attempt > 0 ? input.attempt : 1
  for (let attempt = firstAttempt; ; attempt++) {
    const proposal = propose({ ...input, siblings, attempt }, settings, uuid)
    const parent = input.parentPath.replace(/\/+$/, '')
    const path = `${parent}/${proposal.name}`
    const sameBranch = (input.branch ?? branch).toLowerCase() === branch.toLowerCase()
    if (!files || !sameBranch || !within(path)) return proposal
    try {
      await files.write(path, JSON.stringify(proposal.content, null, 2), { contentType: input.mime || 'application/json', ifNoneMatch: '*' })
      return { path }
    } catch (error) {
      if (statusOf(error) === 403) return proposal
      if (statusOf(error) !== 412 || attempt - firstAttempt + 1 >= attempts) throw error
      siblings.push(proposal.name)
    }
  }
}

export default async function create(engine) {
  const result = await createRecord(engine.context.input.parameters, engine.settings, engine.files,
    { branch: engine.context.file?.branch || 'main' })
  await engine.output.result(result)
}
