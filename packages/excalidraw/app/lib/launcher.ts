import { exactHttpsOrigin, FilesModule, type FileEntry, type WriteFileOptions } from '@verentis/sdk'
import { MIME_TYPE } from './limits'
import { serializeScene } from './format'
import { createTemplate, type TemplateId } from './templates'

export const PAGE_SIZE = 50

export function documentEntries(entries: FileEntry[]) {
  return entries.filter(entry => entry.mimeType === MIME_TYPE || entry.name.toLowerCase().endsWith('.excalidraw'))
}

export function newDocumentPath(name: string, uuid = crypto.randomUUID()): string {
  const clean = name.trim().replace(/\.excalidraw$/i, '')
  if (!clean || clean.length > 100 || /[\/\\\u0000-\u001f\u007f]/.test(clean) || clean === '.' || clean === '..') {
    throw new Error('Use a document name of 1–100 characters without slashes or control characters.')
  }
  if (!/^[a-f0-9-]{36}$/i.test(uuid)) throw new Error('Invalid document identifier.')
  // The suffix reduces naming collisions; only the server create-only operation prevents overwrite.
  return `${clean}-${uuid}.excalidraw`
}

export async function listDocuments(files: Pick<FilesModule, 'get'>, pageNo: number) {
  if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error('Invalid page.')
  const result = await files.get('', { pageNo, pageSize: PAGE_SIZE, orderBy: 'name' })
  const children = result.children ?? []
  return { entries: documentEntries(children), hasNext: children.length === PAGE_SIZE }
}

export interface CreateOnlyFiles {
  write(path: string, options: WriteFileOptions & { createOnly: true }): Promise<void>
}
const SDK_CREATE_ONLY_AVAILABLE: 'createOnly' extends keyof WriteFileOptions ? true : false = true
function httpsApiBase(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null
  try {
    const url = new URL(value)
    if (!exactHttpsOrigin(url.origin) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) return null
    return value
  } catch { return null }
}
export function createOnlyFiles(files: unknown, apiUrl?: unknown, verifiedApiUrl?: unknown): CreateOnlyFiles | null {
  const verified = httpsApiBase(verifiedApiUrl)
  if (!SDK_CREATE_ONLY_AVAILABLE || !(files instanceof FilesModule) || !verified || httpsApiBase(apiUrl) !== verified) return null
  return files
}

export async function createDocument(files: CreateOnlyFiles, name: string, template: TemplateId) {
  const path = newDocumentPath(name)
  await files.write(path, { content: serializeScene(createTemplate(template)), contentType: MIME_TYPE, createOnly: true })
  return path
}
