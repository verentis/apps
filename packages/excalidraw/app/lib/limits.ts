export const DOCUMENT_BYTES = 10 * 1024 * 1024
export const IMAGE_BYTES = 5 * 1024 * 1024
export const ELEMENT_LIMIT = 10_000
export const MIME_TYPE = 'application/vnd.excalidraw+json'

export function assertDocumentSize(content: string | Blob) {
  const size = typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.size
  if (size > DOCUMENT_BYTES) throw new Error('Document exceeds 10 MiB, including embedded images.')
}

export function assertImageSize(file: { size: number; type: string }) {
  if (file.size > IMAGE_BYTES) throw new Error('An imported image must not exceed 5 MiB.')
  if (!/^image\/(?:png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) throw new Error('Unsupported image format.')
}
