// An in-memory stand-in for the nodejs engine SDK files client, for script tests: ETags, If-Match /
// If-None-Match preconditions (412) and direct-child listings behave like the platform's.
export class PreconditionFailed extends Error {
  statusCode = 412
}
class NotFound extends Error {
  statusCode = 404
}

export function memoryFiles(initial = {}) {
  const nodes = new Map()
  let version = 0
  const put = (path, content, contentType) => nodes.set(path, { content, contentType, etag: `"${++version}"` })
  for (const [path, value] of Object.entries(initial)) {
    put(path, typeof value === 'string' ? value : JSON.stringify(value), value?.$schema ? `application/vnd.verentis.${value.$schema.split('/')[3]}.${value.kind}+json` : 'application/json')
  }
  const files = {
    nodes,
    writes: [],
    async stat(path) {
      const node = nodes.get(path)
      return node ? { path, etag: node.etag, contentType: node.contentType } : null
    },
    async readJson(path) {
      const node = nodes.get(path)
      if (!node) throw new NotFound(`${path} not found`)
      return JSON.parse(node.content)
    },
    async write(path, content, { contentType, ifMatch, ifNoneMatch } = {}) {
      const node = nodes.get(path)
      if (ifNoneMatch === '*' && node) throw new PreconditionFailed(`${path} exists`)
      if (ifMatch && node?.etag !== ifMatch) throw new PreconditionFailed(`${path} changed`)
      put(path, content, contentType)
      files.writes.push(path)
    },
    async list(path) {
      const prefix = `${path.replace(/\/+$/, '')}/`
      const data = [...nodes.entries()]
        .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
        .map(([candidate, node]) => ({ name: candidate.slice(prefix.length), path: candidate, mimeType: node.contentType }))
      return { data, pageCount: 1 }
    },
    json: path => JSON.parse(nodes.get(path).content),
    /** Simulates someone else editing the file. */
    touch(path) {
      const node = nodes.get(path)
      put(path, node.content, node.contentType)
    },
  }
  return files
}
