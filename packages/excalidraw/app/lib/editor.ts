import { CaptureUpdateAction, exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { serializeScene, type Scene } from './format'

export function editorScene(api: ExcalidrawImperativeAPI): Scene {
  return { elements: api.getSceneElementsIncludingDeleted(), appState: api.getAppState(), files: api.getFiles() }
}

export function applyScene(api: ExcalidrawImperativeAPI, scene: Scene) {
  api.addFiles(Object.values(scene.files))
  api.updateScene({ elements: scene.elements, appState: { ...api.getAppState(), ...scene.appState }, captureUpdate: CaptureUpdateAction.NEVER })
}

export async function exportImage(scene: Scene, format: 'png' | 'svg'): Promise<Blob> {
  serializeScene(scene)
  const options = {
    elements: scene.elements.filter(e => !e.isDeleted),
    appState: { ...scene.appState, exportBackground: true, exportEmbedScene: false },
    files: scene.files,
  }
  if (format === 'png') return exportToBlob({ ...options, mimeType: 'image/png' })
  const svg = await exportToSvg(options)
  return new Blob([svg.outerHTML], { type: 'image/svg+xml' })
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
