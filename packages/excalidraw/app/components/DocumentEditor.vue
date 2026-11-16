<script setup lang="ts">
import type { FileInfo, HeaderActionRegistration, VerentisClient } from '@verentis/sdk'
import { parseDocument, type Scene } from '../lib/format'
import { nativePort, SharedEditor, type RoomState } from '../lib/collaboration'
import { createTemplate, templates, type TemplateId } from '../lib/templates'
import { hostCleanupKey } from '../lib/host-lifecycle'
import { registerMenuCommands, type MenuCommandId, type MenuCommands, type MenuCommandState } from '../lib/desktop'

const props = defineProps<{ client: VerentisClient; file: FileInfo }>()
const scene = shallowRef<Scene | null>(null)
const error = ref('')
const status = shallowRef<RoomState>({
  scene: null, connected: false, readOnly: true, dirty: false, busy: false,
  participants: [], message: 'Loading document…', resetHistory: false,
})
const replacement = ref<TemplateId | null>(null)
const pendingImport = shallowRef<Scene | null>(null)
const confirmReconnect = ref(false)
const importInput = ref<HTMLInputElement>()
const editor = ref<{ exportDocument: (format: 'png' | 'svg' | 'excalidraw') => Promise<void>, zoomToFit: () => void }>()
let disposed = false
let saveAction: HeaderActionRegistration | undefined
let menuCommands: MenuCommands | undefined
let shared: SharedEditor | undefined
const registerCleanup = inject(hostCleanupKey, undefined)
let unregisterCleanup: (() => void) | undefined
const readOnly = computed(() => !status.value.connected || status.value.readOnly)
const saveDescriptor = computed(() => ({
  id: 'document.save', label: 'Save', icon: 'lucide:save', scopes: [],
  enabled: !readOnly.value && status.value.dirty && !status.value.busy,
  busy: status.value.busy,
  disabledReason: readOnly.value ? 'The document is read-only or disconnected.' : !status.value.dirty ? 'No unsaved changes.' : undefined,
}))
watch(saveDescriptor, descriptor => saveAction?.update(descriptor))
const menuState = computed((): Record<MenuCommandId, MenuCommandState> => {
  const ready = { enabled: !!scene.value, disabledReason: 'The document is still loading.' }
  const { enabled, busy, disabledReason } = saveDescriptor.value
  return { 'board.save': { enabled, busy, disabledReason }, 'board.download': ready, 'board.export-png': ready, 'board.export-svg': ready, 'view.zoom-to-fit': ready }
})
watch(menuState, () => menuCommands?.refresh())
watch(() => status.value.dirty, dirty => props.client.bridge?.setDirty(dirty))
async function save() {
  try {
    if (!shared) throw new Error('Native collaboration is unavailable.')
    await shared.save()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Save failed.'
    throw cause
  }
}
function saveFromUI() { void save().catch(() => {}) }
function change(next: Scene) {
  try { shared?.change(next) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Invalid document change.' }
}
async function importDocument(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || readOnly.value) return
  try { pendingImport.value = await parseDocument(file) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Import failed.' }
  finally { if (importInput.value) importInput.value.value = '' }
}
function replace() {
  if (readOnly.value) return
  const next = pendingImport.value ?? (replacement.value ? createTemplate(replacement.value) : null)
  if (!next) return
  scene.value = next
  change(next)
  pendingImport.value = null
  replacement.value = null
}
function disconnect() { shared?.disconnect() }
function paused(scene: Scene) {
  try { shared?.retainForDownload(scene) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to retain the paused drawing.' }
}
function requestReconnect() {
  if (status.value.dirty) confirmReconnect.value = true
  else void shared?.reconnect()
}
function reconnect() {
  confirmReconnect.value = false
  void shared?.reconnect()
}
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (saveDescriptor.value.enabled) saveFromUI()
  }
}
async function exportDocument(format: 'png' | 'svg' | 'excalidraw') {
  try { await editor.value?.exportDocument(format) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Export failed.' }
}
onMounted(async () => {
  try {
    const blob = await props.client.files.readContent(props.file.path, props.file.branch)
    const parsed = await parseDocument(blob)
    if (disposed) return
    scene.value = parsed
    props.client.bridge?.setTitle(props.file.name)
    saveAction = props.client.bridge?.registerAction(saveDescriptor.value, save)
    // The menu bar's Board and View menus (`spec.menus`) run these while this board's window is focused.
    if (props.client.bridge) {
      menuCommands = registerMenuCommands(props.client.bridge, {
        focused: props.client.context.window?.focused ?? true,
        handlers: {
          'board.save': save,
          'board.download': () => exportDocument('excalidraw'),
          'board.export-png': () => exportDocument('png'),
          'board.export-svg': () => exportDocument('svg'),
          'view.zoom-to-fit': () => editor.value?.zoomToFit(),
        },
        state: () => menuState.value,
      })
    }
    const port = nativePort(props.client)
    if (!port) {
      status.value = { ...status.value, message: 'Read-only: this SDK build does not provide native collaboration.' }
      return
    }
    shared = new SharedEditor(port, next => {
      if (disposed) return
      status.value = next
      if (next.scene) scene.value = next.scene
    })
    const owned = shared
    unregisterCleanup = registerCleanup?.(() => owned.dispose())
    window.addEventListener('offline', disconnect)
    window.addEventListener('keydown', keydown)
    await shared.join()
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : 'Unable to open document.'
  }
})
onBeforeUnmount(() => {
  disposed = true
  saveAction?.dispose()
  menuCommands?.dispose()
  if (shared) void shared.dispose().finally(() => unregisterCleanup?.())
  else unregisterCleanup?.()
  window.removeEventListener('offline', disconnect)
  window.removeEventListener('keydown', keydown)
})
</script>
<template>
  <main class="document-shell">
    <header class="toolbar">
      <span class="status">{{ file.name }}</span>
      <button :disabled="!saveDescriptor.enabled" @click="saveFromUI">Save</button>
      <button v-if="shared && (!status.connected || status.readOnly)" :disabled="status.busy" @click="requestReconnect">Reconnect</button>
      <label class="import-label"><span>Import document</span>
        <input ref="importInput" type="file" accept=".excalidraw,application/vnd.excalidraw+json" :disabled="readOnly || status.busy" @change="importDocument">
      </label>
      <select aria-label="Replace with template" :disabled="readOnly || status.busy" @change="replacement = ($event.target as HTMLSelectElement).value as TemplateId">
        <option value="">Templates…</option>
        <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button :disabled="!scene" @click="exportDocument('excalidraw')">Download document</button>
      <button :disabled="!scene" @click="exportDocument('png')">Export PNG</button>
      <button :disabled="!scene" @click="exportDocument('svg')">Export SVG</button>
    </header>
    <p class="notice" role="status">{{ status.message }} <span v-if="status.participants.length">{{ status.participants.length }} participants</span></p>
    <div v-if="confirmReconnect" class="notice">
      Reload authoritative state and discard unconfirmed local edits? Download your document first to retain a copy. No offline merge is performed.
      <button :disabled="status.busy" @click="reconnect">Discard local edits and reconnect</button>
      <button @click="confirmReconnect = false">Keep local edits</button>
    </div>
    <div v-if="pendingImport || replacement" class="notice">
      Replace the entire current scene? This affects the shared document and is not saved until the platform confirms it.
      <button :disabled="readOnly || status.busy" @click="replace">Replace scene</button>
      <button @click="pendingImport = null; replacement = null">Cancel</button>
    </div>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <ExcalidrawEditor v-if="scene" ref="editor" :scene="scene" :name="file.name" :read-only="readOnly"
      :participants="status.participants" :reset-history="status.resetHistory"
      @change="change" @paused="paused" @gesture="shared?.gesture($event)" @pointer="shared?.presence($event.pointer)" @error="error = $event" />
    <p v-else-if="!error" class="message">Loading document…</p>
  </main>
</template>
