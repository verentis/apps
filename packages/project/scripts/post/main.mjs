// Completes Project tasks. The task form runs this script (run-script) against a saved task; it validates the
// stage transition, stamps the completion time and marks the task done.
//
// Integrity model: the task is updated conditionally (If-Match), so a concurrent edit fails instead of being
// overwritten, and completing an already-done task returns a friendly message instead of failing (idempotent).

export const operations = ['complete-task']
export const project = {
  tasks: '/tasks',
  taskMime: 'application/vnd.verentis.project.task+json',
}
/** Stages a task may be completed from; `done` is reached only through this script. */
export const completableStages = ['backlog', 'in-progress', 'review']

class TaskError extends Error {}
const fail = message => { throw new TaskError(message) }
const statusOf = error => error?.statusCode ?? error?.status
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const label = record => record.code || 'This task'

function checkPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${project.tasks}/`) || path.slice(project.tasks.length + 1).includes('/')) {
    fail(`Expected a task directly in ${project.tasks} (got ${JSON.stringify(path ?? '')}).`)
  }
  return path
}

/** The task with the ETag it was read at, so the update can be conditional. */
async function readTask(files, path) {
  const metadata = await files.stat(path)
  if (!metadata) fail(`${path} does not exist.`)
  let record
  try {
    record = await files.readJson(path)
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} is not valid JSON.`)
    throw error
  }
  if (record?.kind !== 'task') fail(`${path} is not a task.`)
  return { path, record, etag: metadata.etag }
}

/** Writes the changed task back only if nobody changed it since it was read. */
async function saveTask(files, { path, record, etag }) {
  try {
    await files.write(path, JSON.stringify(record, null, 2), { contentType: project.taskMime, ...(etag ? { ifMatch: etag } : {}) })
  } catch (error) {
    if (statusOf(error) === 412) fail(`${path} changed while it was being completed. Reload it and try again.`)
    throw error
  }
}

async function completeTask(files, path, now) {
  const task = await readTask(files, checkPath(path))
  const { record } = task
  if (record.state === 'archived') fail(`${label(record)} is archived. Restore it first.`)
  if (record.stage === 'done') return { message: `${label(record)} is already done`, path }
  if (!completableStages.includes(record.stage)) {
    fail(`${label(record)} cannot move from ${JSON.stringify(record.stage ?? '')} to done. Expected one of ${completableStages.join(', ')}.`)
  }
  if (!String(record.title ?? '').trim()) fail(`${label(record)} needs a title before it can be completed.`)
  record.stage = 'done'
  record.completedAt = now
  record.updatedAt = now
  await saveTask(files, task)
  return { message: `${label(record)} is done`, path }
}

export async function run(parameters, files, { now = nowIso() } = {}) {
  const { operation, path } = parameters ?? {}
  if (operation === 'complete-task') return completeTask(files, path, now)
  return fail(`Unsupported operation ${JSON.stringify(operation ?? '')}. Expected one of ${operations.join(', ')}.`)
}

export default async function post(engine) {
  await engine.output.result(await run(engine.context.input.parameters, engine.files))
}
