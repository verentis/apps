import { restore, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import { assertDocumentSize, DOCUMENT_BYTES, ELEMENT_LIMIT, IMAGE_BYTES } from './limits'

export interface Scene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateScene(scene: Scene) {
  if (scene.elements.length > ELEMENT_LIMIT) throw new Error('A document supports at most 10,000 elements.')
  for (const file of Object.values(scene.files)) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/.exec(file.dataURL)
    if (!match) throw new Error('Images must be embedded data URLs, not remote URLs.')
    if (match[1] !== file.mimeType || match[2]!.length % 4 !== 0) throw new Error('Invalid embedded image encoding or MIME type.')
    const encoded = match[2]!
    const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
    if (bytes > IMAGE_BYTES) throw new Error('An imported image must not exceed 5 MiB.')
  }
}

export function serializeScene(scene: Scene): string {
  validateScene(scene)
  // The local serializer preserves embedded files and upstream's portable appState.
  const json = serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')
  assertDocumentSize(json)
  return json
}

export function parseScene(content: string): Scene {
  assertDocumentSize(content)
  let raw: unknown
  try { raw = JSON.parse(content) } catch { throw new Error('The document is not valid JSON.') }
  if (!record(raw) || raw.type !== 'excalidraw' || raw.version !== 2 ||
      !Array.isArray(raw.elements) || !record(raw.appState) || (raw.files !== undefined && !record(raw.files))) {
    throw new Error('Expected a standard version 2 .excalidraw document.')
  }
  if (raw.elements.length > ELEMENT_LIMIT) throw new Error('A document supports at most 10,000 elements.')
  const ids = new Set<string>()
  for (const element of raw.elements) {
    if (!record(element) || typeof element.id !== 'string' || !element.id || ids.has(element.id) ||
        typeof element.type !== 'string' || !['rectangle', 'diamond', 'ellipse', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame', 'magicframe', 'embeddable'].includes(element.type) ||
        !['x', 'y', 'width', 'height'].every(key => typeof element[key] === 'number' && Number.isFinite(element[key]))) {
      throw new Error('Invalid or duplicate scene element.')
    }
    // External embeds are not an authenticated workspace feature.
    if (element.type === 'embeddable' || element.type === 'magicframe') throw new Error('External embeds and AI frames are not supported.')
    ids.add(element.id)
  }
  const files = raw.files ?? {}
  for (const [id, file] of Object.entries(files as Record<string, unknown>)) {
    if (!record(file) || file.id !== id || typeof file.dataURL !== 'string' || typeof file.mimeType !== 'string' ||
        typeof file.created !== 'number' || !Number.isFinite(file.created) || file.created < 0) throw new Error('Invalid embedded image.')
  }
  const restored = restore(raw, null, null)
  // Restored defaults include local viewport/tools. Only portable state may be
  // applied to a live editor, otherwise room polling resets selection and zoom.
  const portable = JSON.parse(serializeAsJSON(restored.elements, restored.appState, restored.files, 'local')) as { appState: Partial<AppState> }
  const scene: Scene = { elements: restored.elements, appState: portable.appState, files: restored.files }
  validateScene(scene)
  for (const element of scene.elements) {
    if (element.type === 'image' && element.fileId && !scene.files[element.fileId]) {
      throw new Error('An image element is missing its embedded asset.')
    }
  }
  return scene
}

export async function parseDocument(blob: Blob): Promise<Scene> {
  if (blob.size > DOCUMENT_BYTES) throw new Error('Document exceeds 10 MiB, including embedded images.')
  return parseScene(await blob.text())
}
