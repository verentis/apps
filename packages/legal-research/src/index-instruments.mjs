// Maintainer-only refresh. Package builds use the checked-in metadata and never need network access.
import { writeFile } from 'node:fs/promises'
import { revision } from './revision.mjs'

const source = `https://raw.githubusercontent.com/lexifina/south-africa-law/${revision}/data`
async function metadata(file) {
  const result = await fetch(`${source}/${file}`)
  if (!result.ok) throw new Error(`Reading ${file}: HTTP ${result.status}`)
  return result.json()
}
const [{ acts }, { paths }, { parts }] = await Promise.all(['versions.json', 'paths.json', 'parts.json'].map(metadata))
const consolidated = new Set(parts['30-justice-acts.json'].acts)
const enacted = new Set([...parts['40-govza-acts.json'].acts, ...parts['50-q610-global-minimum-tax.json'].acts])
const directory = acts.map(({ slug, title, url }) => {
  const path = paths[slug]
  if (!/^[a-z0-9-]+$/.test(slug) || !/^(?:act|constitution)\/[a-z0-9/-]+$/.test(path)
    || !title || !url.startsWith('https://')) throw new Error(`Invalid source metadata: ${slug}`)
  const coverage = consolidated.has(slug) ? 'Consolidation only' : enacted.has(slug) ? 'As enacted only' : 'Instrument index'
  return { slug, title, path, url, coverage }
})
await writeFile(new URL('instruments.json', import.meta.url), JSON.stringify(directory, null, 2) + '\n')
