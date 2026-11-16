<script setup lang="ts">
import type { HeaderAction, HeaderActionRegistration } from '@verentis/sdk'

const { client, context, loading, error } = useVerentis()

const content = ref('')
const originalContent = ref('')
const fileLoaded = ref(false)
const fileError = ref(false)
const { dirty, saving, saveError, save } = useDocumentSave(content, originalContent, async (snapshot) => {
  if (!client.value || !context.value?.file.path || !fileLoaded.value) throw new Error('No document is ready to save.')
  await client.value.files.write(context.value.file.path, {
    content: snapshot,
    contentType: context.value.file.mimeType || 'text/plain',
  })
})
const saveDescriptor = computed<HeaderAction>(() => ({
  id: 'document.save', label: 'Save', icon: 'lucide:save', variant: 'default',
  scopes: ['file.read', 'file.write'],
  enabled: fileLoaded.value && !fileError.value && dirty.value && !saving.value,
  busy: saving.value,
  disabledReason: !fileLoaded.value ? 'Loading document' : !dirty.value ? 'No unsaved changes' : undefined,
}))
let saveAction: HeaderActionRegistration | undefined
watch(() => client.value, (c, _, onCleanup) => {
  if (!c?.bridge) return
  saveAction = c.bridge.registerAction(saveDescriptor.value, save)
  onCleanup(() => { saveAction?.dispose(); saveAction = undefined })
}, { immediate: true })
watch(saveDescriptor, value => saveAction?.update(value))

// Infer Monaco language from MIME type
const language = computed(() => {
  const mime = context.value?.file.mimeType ?? ''
  const name = context.value?.file.name ?? ''
  return inferLanguage(mime, name)
})

// Notify host of dirty state
watch(dirty, (isDirty) => {
  client.value?.bridge?.setDirty(isDirty)
})

// Load file content once SDK is ready
watch(
  () => client.value,
  async (c) => {
    if (!c || !context.value) return
    try {
      const blob = await c.files.readContent(context.value.file.path)
      const text = await blob.text()
      content.value = text
      originalContent.value = text
      fileLoaded.value = true
    } catch (e: any) {
      console.error('[SmartEditor] Failed to load file:', e)
      fileError.value = true
    }
  },
  { immediate: true },
)

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    if (!saving.value && fileLoaded.value) {
      void save().catch(error => console.error('[SmartEditor] Save failed:', error))
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function inferLanguage(mimeType: string, fileName: string): string {
  // MIME-based mapping
  const mimeMap: Record<string, string> = {
    'application/json': 'json',
    'application/jsonl': 'json',
    'application/x-ndjson': 'json',
    'application/x-jsonlines': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'application/yaml': 'yaml',
    'text/yaml': 'yaml',
    'text/x-yaml': 'yaml',
    'application/x-yaml': 'yaml',
    'text/html': 'html',
    'text/css': 'css',
    'text/javascript': 'javascript',
    'application/javascript': 'javascript',
    'text/typescript': 'typescript',
    'application/typescript': 'typescript',
    'text/markdown': 'markdown',
    'text/x-markdown': 'markdown',
    'text/x-python': 'python',
    'application/x-python': 'python',
    'text/x-csharp': 'csharp',
    'text/x-java': 'java',
    'text/x-go': 'go',
    'text/x-rust': 'rust',
    'text/x-sql': 'sql',
    'application/sql': 'sql',
    'text/x-shellscript': 'shell',
    'application/x-sh': 'shell',
    'text/x-dockerfile': 'dockerfile',
  }

  const clean = (mimeType.split(';')[0] ?? '').trim().toLowerCase()
  if (mimeMap[clean]) return mimeMap[clean]

  // Extension-based fallback
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const extMap: Record<string, string> = {
    json: 'json',
    jsonl: 'json',
    ndjson: 'json',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cs: 'csharp',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    dockerfile: 'dockerfile',
    toml: 'ini',
    ini: 'ini',
    conf: 'ini',
    env: 'ini',
    graphql: 'graphql',
    gql: 'graphql',
    vue: 'html',
    svelte: 'html',
  }

  return extMap[ext] ?? 'plaintext'
}
</script>

<template>
  <div class="flex h-screen flex-col bg-background">
    <!-- Loading -->
    <div
      v-if="loading || (!fileLoaded && !fileError)"
      class="flex flex-1 items-center justify-center gap-2 text-muted-foreground"
    >
      <icon name="lucide:loader-2" class="size-5 animate-spin" />
      <span class="text-sm">{{ loading ? 'Connecting...' : 'Loading file...' }}</span>
    </div>

    <!-- Error -->
    <div
      v-else-if="error || fileError"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <icon name="lucide:triangle-alert" class="size-8 text-destructive" />
      <p class="text-sm font-medium">{{ error ? 'Failed to connect' : 'Failed to load file' }}</p>
      <p class="text-xs text-muted-foreground">{{ error ?? context?.file.name }}</p>
    </div>

    <!-- Editor -->
    <template v-else>
      <!-- Toolbar -->
      <div class="flex items-center justify-between border-b px-3 py-1.5">
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground">{{ context?.file.name }}</span>
          <span
            v-if="dirty"
            class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          >
            Modified
          </span>
          <span class="text-[10px] text-muted-foreground/60">{{ language }}</span>
        </div>
        <div class="flex items-center gap-1">
          <span
            v-if="saveError"
            class="mr-2 text-xs text-destructive"
          >
            {{ saveError }}
          </span>
        </div>
      </div>

      <!-- Monaco -->
      <div class="min-h-0 flex-1">
        <MonacoEditor
          v-model="content"
          :language="language"
        />
      </div>
    </template>
  </div>
</template>
