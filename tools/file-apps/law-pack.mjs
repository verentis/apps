// These catalogues contain bibliographic facts and links, never legislative wording.
export function lawPack({ repository, revision, jurisdiction, checkedThrough }, entries) {
  if (!/^lexifina\/[a-z-]+-law$/.test(repository) || !/^[0-9a-f]{40}$/.test(revision)
    || !/^[A-Z]{2}$/.test(jurisdiction)) throw new Error('Invalid law pack identity')
  const ids = new Set()
  const url = (sha, path) => `https://github.com/${repository}/blob/${sha}/${path}`
  const authorities = entries.map(entry => {
    const { key, path, snapshots = [], ...metadata } = entry
    const id = `${jurisdiction}:${key}`
    if (ids.has(id)) throw new Error(`Duplicate authority: ${id}`)
    ids.add(id)
    const versions = snapshots.map(([from, sha, oldPath], index) => {
      if (!/^\d{4}-\d\d-\d\d$/.test(from) || from > checkedThrough || !/^[0-9a-f]{40}$/.test(sha)
        || (index && snapshots[index - 1][0] >= from)) throw new Error(`Invalid history: ${id}`)
      return { from, revision: sha, url: url(sha, oldPath) }
    })
    return { id, jurisdiction, ...metadata, revision, sourceUrl: url(revision, path), rights: 'link-only', checkedThrough, versions }
  })
  return { formatVersion: 1, jurisdiction, repository, revision, authorities }
}
