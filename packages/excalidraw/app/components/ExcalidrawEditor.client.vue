<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Excalidraw, MainMenu } from '@excalidraw/excalidraw'
import type { Collaborator, ExcalidrawImperativeAPI, ExcalidrawProps, SocketId } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { assertImageSize, ELEMENT_LIMIT } from '../lib/limits'
import { applyScene, editorScene, exportImage, download } from '../lib/editor'
import { serializeScene, type Scene } from '../lib/format'
import type { Participant } from '../lib/collaboration'

const props = defineProps<{ scene: Scene; readOnly: boolean; name: string; participants?: Participant[]; resetHistory?: boolean }>()
const emit = defineEmits<{
  change: [scene: Scene, json: string]
  pointer: [payload: Parameters<NonNullable<ExcalidrawProps['onPointerUpdate']>>[0]]
  error: [message: string]
  ready: [api: ExcalidrawImperativeAPI]
  gesture: [active: boolean]
  paused: [scene: Scene]
}>()
const container = ref<HTMLDivElement>()
let root: Root | undefined
let api: ExcalidrawImperativeAPI | undefined
let applying = false
let disposed = false
let accepted: Scene = props.scene
let lastJSON = ''
let interacting = false
let pointerDown = false
let editingControl: HTMLElement | null = null
let gestureFrame: number | undefined
let mountingFrame: number | undefined

function error(cause: unknown) {
  emit('error', cause instanceof Error ? cause.message : 'The editor operation failed.')
}
function publish(scene: Scene) {
  try {
    const json = serializeScene(scene)
    if (json === lastJSON) return
    accepted = scene
    lastJSON = json
    emit('change', scene, json)
  } catch (cause) {
    error(cause)
    if (api) {
      applying = true
      applyScene(api, accepted)
      applying = false
    }
  }
}
function finishGesture() {
  if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame)
  gestureFrame = requestAnimationFrame(() => {
    gestureFrame = undefined
    if (disposed || !api || pointerDown || editingControl || api.getAppState().editingTextElement) return
    interacting = false
    emit('gesture', false)
    if (!props.readOnly) publish(editorScene(api))
  })
}
function beginPointer() {
  if (props.readOnly || pointerDown) return
  pointerDown = true
  interacting = true
  emit('gesture', true)
}
function endPointer() {
  if (!pointerDown) return
  pointerDown = false
  finishGesture()
}
function beginControl(event: Event) {
  const target = event.target
  if (props.readOnly || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
  if (target instanceof HTMLInputElement && !['text', 'color', 'number', 'range'].includes(target.type)) return
  editingControl = target
  interacting = true
  emit('gesture', true)
}
function endControl(event: Event) {
  if (event.target !== editingControl) return
  editingControl = null
  finishGesture()
}
function finishControl(event: KeyboardEvent) {
  if (editingControl && ['Enter', 'Escape'].includes(event.key)) endControl(event)
}
function render() {
  root?.render(createElement(Excalidraw, {
    initialData: props.scene,
    name: props.name,
    viewModeEnabled: props.readOnly,
    isCollaborating: true,
    aiEnabled: false,
    validateEmbeddable: false,
    handleKeyboardGlobally: false,
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } },
    excalidrawAPI: value => {
      api = value
      emit('ready', value)
      if (mountingFrame !== undefined) cancelAnimationFrame(mountingFrame)
      mountingFrame = requestAnimationFrame(() => {
        mountingFrame = undefined
        if (disposed || interacting || !api) return
        applying = true
        applyScene(api, props.scene)
        if (props.resetHistory) api.history.clear()
        applying = false
      })
    },
    generateIdForFile: async file => {
      assertImageSize(file)
      const bytes = await file.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    },
    onLinkOpen: (_, event) => event.preventDefault(),
    onPaste: data => {
      if (props.readOnly) return false
      if ((data.elements?.length ?? 0) + (api?.getSceneElementsIncludingDeleted().length ?? 0) > ELEMENT_LIMIT) {
        error(new Error('A document supports at most 10,000 elements.'))
        return false
      }
      return true
    },
    onPointerUpdate: payload => { if (!props.readOnly) emit('pointer', payload) },
    onPointerDown: beginPointer,
    onPointerUp: endPointer,
    onChange: (elements, appState, files) => {
      if (disposed || applying || props.readOnly) return
      if (appState.editingTextElement) {
        interacting = true
        emit('gesture', true)
        return
      }
      if (interacting) { if (!pointerDown) finishGesture(); return }
      publish({ elements, appState, files })
    },
  }, createElement(MainMenu, null,
    createElement(MainMenu.DefaultItems.ClearCanvas),
    createElement(MainMenu.DefaultItems.ToggleTheme),
    createElement(MainMenu.DefaultItems.ChangeCanvasBackground),
  )))
}

function guardFiles(event: Event) {
  const transfer = event instanceof DragEvent ? event.dataTransfer : event instanceof ClipboardEvent ? event.clipboardData : null
  if (props.readOnly) { event.preventDefault(); event.stopPropagation(); return }
  try {
    for (const file of Array.from(transfer?.files ?? [])) {
      if (!file.type.startsWith('image/')) throw new Error('Use Import document to open a .excalidraw file.')
      assertImageSize(file)
    }
  } catch (cause) { event.preventDefault(); event.stopPropagation(); error(cause) }
}

async function exportDocument(format: 'png' | 'svg' | 'excalidraw') {
  if (!api) return
  const scene = props.readOnly ? props.scene : editorScene(api)
  const blob = format === 'excalidraw'
    ? new Blob([serializeScene(scene)], { type: 'application/vnd.excalidraw+json' })
    : await exportImage(scene, format)
  if (!disposed) download(blob, `${props.name.replace(/\.excalidraw$/i, '')}.${format}`)
}
function zoomToFit() {
  if (!api || disposed) return
  api.scrollToContent(undefined, { fitToContent: true, animate: true })
}
defineExpose({ exportDocument, zoomToFit })
watch(() => props.readOnly, readOnly => {
  if (readOnly) {
    // Published/imported drafts can be ahead of React; capture only unfinished interactions.
    if (api && (interacting || pointerDown || editingControl || api.getAppState().editingTextElement)) {
      try { emit('paused', editorScene(api)) }
      catch (cause) { error(cause) }
    }
    interacting = false
    pointerDown = false
    editingControl = null
    if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame)
    if (mountingFrame !== undefined) cancelAnimationFrame(mountingFrame)
    emit('gesture', false)
  }
  render()
})
watch(() => props.scene, scene => {
  if (interacting) return
  accepted = scene
  lastJSON = serializeScene(scene)
  if (!api) return
  applying = true
  applyScene(api, scene)
  if (props.resetHistory) api.history.clear()
  applying = false
})
watch(() => props.participants, participants => {
  if (!api) return
  const collaborators = new Map<SocketId, Collaborator>()
  for (const participant of participants ?? []) {
    collaborators.set(participant.id as SocketId, {
      username: participant.name,
      ...(participant.pointer ? { pointer: { ...participant.pointer, tool: 'pointer' as const } } : {}),
      color: { background: '#e4e2ff', stroke: '#6965db' },
    })
  }
  api.updateScene({ collaborators })
}, { deep: true })
onMounted(() => {
  window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'
  lastJSON = serializeScene(props.scene)
  root = createRoot(container.value!)
  container.value!.addEventListener('drop', guardFiles, true)
  container.value!.addEventListener('paste', guardFiles, true)
  container.value!.addEventListener('pointerdown', beginPointer, true)
  container.value!.addEventListener('focusin', beginControl, true)
  container.value!.addEventListener('focusout', endControl, true)
  container.value!.addEventListener('keydown', finishControl, true)
  window.addEventListener('pointerup', endPointer)
  window.addEventListener('pointercancel', endPointer)
  render()
})
onBeforeUnmount(() => {
  disposed = true
  if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame)
  if (mountingFrame !== undefined) cancelAnimationFrame(mountingFrame)
  container.value?.removeEventListener('drop', guardFiles, true)
  container.value?.removeEventListener('paste', guardFiles, true)
  container.value?.removeEventListener('pointerdown', beginPointer, true)
  container.value?.removeEventListener('focusin', beginControl, true)
  container.value?.removeEventListener('focusout', endControl, true)
  container.value?.removeEventListener('keydown', finishControl, true)
  window.removeEventListener('pointerup', endPointer)
  window.removeEventListener('pointercancel', endPointer)
  root?.unmount()
  root = undefined
  api = undefined
})
</script>

<template><div ref="container" class="editor-island" aria-label="Excalidraw drawing editor" /></template>
