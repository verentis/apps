<script setup lang="ts">
import { ApiError, type FileEntry, type VerentisClient } from '@verentis/sdk'
import { createDocument, createOnlyFiles, listDocuments } from '../lib/launcher'
import { templates, type TemplateId } from '../lib/templates'

const props = defineProps<{ client: VerentisClient }>()
const entries = shallowRef<FileEntry[]>([])
const page = ref(1)
const hasNext = ref(false)
const busy = ref(false)
const error = ref('')
const name = ref('Untitled')
const template = ref<TemplateId>('blank')
const config = useRuntimeConfig()
const creator = createOnlyFiles(props.client.files, props.client.context.apiUrl, config.public.createOnlyApiUrl)
let generation = 0
onBeforeUnmount(() => { generation++ })

async function load(next = page.value) {
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    const result = await listDocuments(props.client.files, next)
    if (current !== generation) return
    entries.value = result.entries
    hasNext.value = result.hasNext
    page.value = next
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : 'Unable to list workspace files.'
  } finally { if (current === generation) busy.value = false }
}

async function create() {
  if (busy.value || !creator) return
  busy.value = true
  error.value = ''
  const current = generation
  try {
    const path = await createDocument(creator!, name.value, template.value)
    if (current === generation) props.client.bridge?.navigate(path)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof ApiError ? cause.detail : cause instanceof Error ? cause.message : 'Unable to create document.'
  } finally { if (current === generation) busy.value = false }
}
onMounted(() => { void load() })
</script>

<template>
  <main class="launcher">
    <h1>Excalidraw</h1>
    <p>Whiteboards, diagrams and wireframes in your workspace.</p>
    <form class="new-document" @submit.prevent="create">
      <label>Document name <input v-model="name" maxlength="110" required :disabled="busy"></label>
      <label>Template <select v-model="template" :disabled="busy">
        <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select></label>
      <button type="submit" :disabled="busy || !creator">New document</button>
    </form>
    <p v-if="!creator" class="notice" role="status">New documents require verified create-only support on this API target. Creation is disabled rather than risking an existing file.</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <section aria-labelledby="documents-heading" :aria-busy="busy">
      <h2 id="documents-heading">Workspace documents</h2>
      <ul class="documents">
        <li v-for="entry in entries" :key="entry.path">
          <button :disabled="busy" @click="client.bridge?.navigate(entry.path)">{{ entry.name }}</button>
          <small>{{ Math.ceil(entry.size / 1024) }} KiB</small>
        </li>
      </ul>
      <p v-if="!busy && !entries.length">No Excalidraw documents on this page.</p>
      <nav aria-label="Document pages">
        <button :disabled="busy || page === 1" @click="load(page - 1)">Previous</button>
        <span>Page {{ page }}</span>
        <button :disabled="busy || !hasNext" @click="load(page + 1)">Next</button>
        <button :disabled="busy" @click="load()">Refresh</button>
      </nav>
    </section>
  </main>
</template>
