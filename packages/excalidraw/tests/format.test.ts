import { describe, expect, it } from 'vitest'
import { parseScene, serializeScene } from '../app/lib/format'
import { createTemplate, performanceFixture } from '../app/lib/templates'
import { assertDocumentSize, assertImageSize, DOCUMENT_BYTES, IMAGE_BYTES, ELEMENT_LIMIT } from '../app/lib/limits'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { BinaryFileData } from '@excalidraw/excalidraw/types'

describe('portable Excalidraw documents', () => {
  it('round trips synthetic templates using the standard upstream format', () => {
    for (const id of ['blank', 'flowchart', 'wireframe'] as const) {
      const scene = createTemplate(id)
      const json = serializeScene(scene)
      expect(JSON.parse(json)).toMatchObject({ type: 'excalidraw', version: 2 })
      expect(parseScene(json).elements.map(e => e.id)).toEqual(scene.elements.map(e => e.id))
    }
  })

  it('preserves embedded assets and removes transient app state', () => {
    const scene = createTemplate()
    const imageId = 'asset' as BinaryFileData['id']
    scene.files[imageId] = {
      id: imageId, mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=' as BinaryFileData['dataURL'], created: 1,
    }
    scene.elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: imageId }])
    scene.appState = { ...scene.appState, collaborators: new Map(), selectedElementIds: { secret: true }, isLoading: true }
    const json = serializeScene(scene)
    expect(JSON.parse(json).files.asset.dataURL).toBe('data:image/png;base64,aGVsbG8=')
    expect(JSON.parse(json).appState.collaborators).toBeUndefined()
    expect(JSON.parse(json).appState.selectedElementIds).toBeUndefined()
    expect(parseScene(json).files.asset?.dataURL).toBe('data:image/png;base64,aGVsbG8=')
    expect(parseScene(json).appState.activeTool).toBeUndefined()
    expect(parseScene(json).appState.scrollX).toBeUndefined()
  })

  it('rejects malformed, proprietary and oversized input', () => {
    expect(() => parseScene('no')).toThrow('JSON')
    expect(() => parseScene('{"scene":[]}')).toThrow('standard')
    expect(() => assertDocumentSize('x'.repeat(DOCUMENT_BYTES + 1))).toThrow('10 MiB')
    expect(() => assertDocumentSize('🦉'.repeat(DOCUMENT_BYTES / 4 + 1))).toThrow('10 MiB')
    expect(() => assertImageSize({ size: IMAGE_BYTES + 1, type: 'image/png' })).toThrow('5 MiB')
    expect(() => assertImageSize({ size: 1, type: 'text/html' })).toThrow('format')
  })

  it('rejects too many elements, duplicates and remote assets', () => {
    const fixture = performanceFixture()
    const json = JSON.parse(serializeScene(fixture))
    json.elements.push(json.elements[0])
    expect(() => parseScene(JSON.stringify(json))).toThrow('duplicate')
    expect(() => serializeScene({ ...fixture, elements: Array(10_001).fill(fixture.elements[0]) })).toThrow('10,000')
    const scene = createTemplate()
    scene.files.asset = { id: 'asset' as never, mimeType: 'image/png', dataURL: 'https://example.com/a.png' as never, created: 1 }
    expect(() => serializeScene(scene)).toThrow('embedded')
  })

  it('builds the reproducible 1,000 element performance fixture', () => {
    const fixture = performanceFixture()
    expect(fixture.elements).toHaveLength(1000)
    expect(parseScene(serializeScene(fixture)).elements).toHaveLength(1000)
  })
  it('accepts exactly 5 MiB imported/embedded images and rejects the first extra raw byte', () => {
    const scene = createTemplate()
    const id = 'boundary-asset' as BinaryFileData['id']
    const data = Buffer.alloc(IMAGE_BYTES)
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64').copy(data)
    scene.files[id] = { id, mimeType: 'image/png', dataURL: `data:image/png;base64,${data.toString('base64')}` as BinaryFileData['dataURL'], created: 1 }
    scene.elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: id }])
    expect(() => assertImageSize({ size: IMAGE_BYTES, type: 'image/png' })).not.toThrow()
    const json = serializeScene(scene)
    expect(Buffer.byteLength(json)).toBeGreaterThan(IMAGE_BYTES)
    expect(parseScene(json).files[id]?.dataURL).toBe(scene.files[id]!.dataURL)
    expect(() => assertImageSize({ size: IMAGE_BYTES + 1, type: 'image/png' })).toThrow('5 MiB')
    scene.files[id]!.dataURL = `data:image/png;base64,${Buffer.concat([data, Buffer.alloc(1)]).toString('base64')}` as BinaryFileData['dataURL']
    expect(() => serializeScene(scene)).toThrow('5 MiB')
    const encoded = JSON.parse(json)
    encoded.files[id].dataURL = scene.files[id]!.dataURL
    expect(() => parseScene(JSON.stringify(encoded))).toThrow('5 MiB')
  })
  it('accepts exactly 10 MiB total encoded JSON with images and rejects byte 10 MiB + 1', () => {
    const scene = createTemplate()
    const id = 'boundary-asset' as BinaryFileData['id']
    const data = Buffer.alloc(IMAGE_BYTES)
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64').copy(data)
    scene.files[id] = { id, mimeType: 'image/png', dataURL: `data:image/png;base64,${data.toString('base64')}` as BinaryFileData['dataURL'], created: 1 }
    scene.elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: id }])
    const json = serializeScene(scene)
    const atLimit = json + ' '.repeat(DOCUMENT_BYTES - Buffer.byteLength(json))
    expect(Buffer.byteLength(atLimit)).toBe(DOCUMENT_BYTES)
    expect(parseScene(atLimit).files[id]?.dataURL).toBe(scene.files[id]!.dataURL)
    expect(() => assertDocumentSize(new Blob([atLimit]))).not.toThrow()
    expect(() => parseScene(atLimit + ' ')).toThrow('10 MiB')
    expect(() => assertDocumentSize(new Blob([atLimit + ' ']))).toThrow('10 MiB')
  })
  it('accepts 10,000 unique elements and rejects the first excess on import and export', () => {
    const element = performanceFixture().elements[0]!
    const scene = createTemplate()
    scene.elements = Array.from({ length: ELEMENT_LIMIT }, (_, i) => ({ ...element, id: `boundary-${i}` }))
    const json = serializeScene(scene)
    expect(parseScene(json).elements).toHaveLength(ELEMENT_LIMIT)
    const over = { ...scene, elements: [...scene.elements, { ...element, id: 'boundary-excess' }] }
    expect(() => serializeScene(over)).toThrow('10,000')
    const raw = JSON.parse(json)
    raw.elements.push(over.elements.at(-1))
    expect(() => parseScene(JSON.stringify(raw))).toThrow('10,000')
  })
})
