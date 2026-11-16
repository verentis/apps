<script setup lang="ts">
import type { HeaderAction, HeaderActionRegistration } from '@verentis/sdk'
const { client, context, loading, error } = useVerentis()
const { render } = useMarkdown()
const colorMode = useColorMode()

const content = ref('')
const fileLoaded = ref(false)
const fileError = ref(false)
const viewMode = ref<'preview' | 'source'>('preview')
const tocOpen = ref(true)
const activeId = ref('')

const scrollContainer = ref<HTMLElement | null>(null)

const hasFile = computed(() => !!context.value?.file?.path)
const rendered = computed(() => render(content.value))
const toc = computed(() => rendered.value.toc.filter((h) => h.level >= 1 && h.level <= 3))
const hasToc = computed(() => toc.value.length >= 2)

const wordCount = computed(() => (content.value.trim().match(/\S+/g) ?? []).length)
const readingTime = computed(() => Math.max(1, Math.round(wordCount.value / 200)))

const phase = computed(() => {
  if (loading.value) return 'connecting'
  if (error.value) return 'sdk-error'
  if (fileError.value) return 'file-error'
  if (!hasFile.value) return 'empty'
  if (!fileLoaded.value) return 'loading-file'
  return 'ready'
})
const copyDescriptor = computed<HeaderAction>(() => ({
  id: 'document.copy', label: 'Copy markdown source', icon: 'lucide:copy',
  scopes: [], kind: 'clipboard', enabled: phase.value === 'ready',
  disabledReason: phase.value !== 'ready' ? 'No document is ready to copy' : undefined,
}))
let copyAction: HeaderActionRegistration | undefined
watch(() => client.value, (c, _, onCleanup) => {
  if (!c?.bridge) return
  copyAction = c.bridge.registerAction(copyDescriptor.value, () => {
    if (phase.value !== 'ready') throw new Error('No document is ready to copy.')
    return { clipboardText: content.value }
  })
  onCleanup(() => { copyAction?.dispose(); copyAction = undefined })
}, { immediate: true })
watch(copyDescriptor, value => copyAction?.update(value))

let unsubscribeTheme: (() => void) | undefined
let observer: IntersectionObserver | null = null

watch(
  () => client.value,
  async (c) => {
    if (!c) return

    // Follow the host's colour scheme when running inside the workspace iframe.
    if (c.bridge) {
      unsubscribeTheme = c.bridge.on('verentis:theme', (msg) => {
        const scheme = (msg as { colorScheme?: string }).colorScheme
        if (scheme === 'light' || scheme === 'dark') colorMode.preference = scheme
      })
    }

    if (!context.value?.file?.path) {
      fileLoaded.value = true
      return
    }

    try {
      c.bridge?.setTitle(context.value.file.name)
    } catch {
      /* host title is best-effort */
    }

    try {
      const blob = await c.files.readContent(context.value.file.path)
      content.value = await blob.text()
      fileLoaded.value = true
    } catch (e: unknown) {
      console.error('[MarkdownViewer] Failed to load file:', e)
      fileError.value = true
    }
  },
  { immediate: true },
)

function setupScrollSpy() {
  observer?.disconnect()
  const container = scrollContainer.value
  if (!container || !hasToc.value || viewMode.value !== 'preview') return

  const headings = Array.from(
    container.querySelectorAll<HTMLElement>('.markdown-body :is(h1, h2, h3)[id]'),
  )
  if (!headings.length) return

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activeId.value = (entry.target as HTMLElement).id
      }
    },
    { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 },
  )
  headings.forEach((h) => observer!.observe(h))
}

watch(
  [() => rendered.value.html, viewMode, fileLoaded],
  async () => {
    await nextTick()
    // Give MarkdownDocument a frame to inject its DOM before observing it.
    requestAnimationFrame(setupScrollSpy)
  },
)

function scrollTo(id: string) {
  const container = scrollContainer.value
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
  container?.querySelector(`#${escaped}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeId.value = id
}

onUnmounted(() => {
  unsubscribeTheme?.()
  observer?.disconnect()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-background text-foreground">
    <!-- Connecting -->
    <div
      v-if="phase === 'connecting'"
      class="flex flex-1 items-center justify-center gap-2 text-muted-foreground"
    >
      <icon name="lucide:loader-2" class="size-5 animate-spin" />
      <span class="text-sm">Connecting to Verentis...</span>
    </div>

    <!-- SDK / file errors -->
    <div
      v-else-if="phase === 'sdk-error' || phase === 'file-error'"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <icon name="lucide:triangle-alert" class="size-8 text-destructive" />
      <p class="text-sm font-medium">
        {{ phase === 'sdk-error' ? 'Failed to connect' : 'Failed to load document' }}
      </p>
      <p class="max-w-md px-6 text-xs text-muted-foreground">
        {{ phase === 'sdk-error' ? error : context?.file?.name }}
      </p>
    </div>

    <!-- No file (standalone / nothing opened) -->
    <div
      v-else-if="phase === 'empty'"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <icon name="lucide:file-text" class="size-8 text-muted-foreground" />
      <p class="text-sm font-medium">No markdown file open</p>
      <p class="max-w-xs px-6 text-xs text-muted-foreground">
        Open a Markdown (.md) file from your workspace to preview it here.
      </p>
    </div>

    <!-- Loading file -->
    <div
      v-else-if="phase === 'loading-file'"
      class="flex flex-1 items-center justify-center gap-2 text-muted-foreground"
    >
      <icon name="lucide:loader-2" class="size-5 animate-spin" />
      <span class="text-sm">Loading document...</span>
    </div>

    <!-- Viewer -->
    <template v-else>
      <!-- Toolbar -->
      <div class="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div class="flex min-w-0 items-center gap-2">
          <icon name="lucide:file-text" class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate text-xs font-medium">{{ context?.file?.name || 'document.md' }}</span>
          <span v-if="wordCount" class="hidden shrink-0 text-[11px] text-muted-foreground/70 sm:inline">
            {{ readingTime }} min read · {{ wordCount }} words
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            v-if="hasToc"
            class="hidden rounded p-1.5 md:inline-flex"
            :class="tocOpen
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
            title="Toggle outline"
            @click="tocOpen = !tocOpen"
          >
            <icon name="lucide:list-tree" class="size-4" />
          </button>

          <div class="mx-1 h-4 w-px bg-border" />

          <!-- Preview / Source toggle -->
          <div class="flex items-center rounded-md border p-0.5">
            <button
              class="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
              :class="viewMode === 'preview'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'"
              @click="viewMode = 'preview'"
            >
              <icon name="lucide:eye" class="size-3.5" />
              Preview
            </button>
            <button
              class="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
              :class="viewMode === 'source'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'"
              @click="viewMode = 'source'"
            >
              <icon name="lucide:code" class="size-3.5" />
              Source
            </button>
          </div>

        </div>
      </div>

      <!-- Body -->
      <div class="flex min-h-0 flex-1">
        <!-- Table of contents -->
        <aside
          v-if="hasToc && tocOpen"
          class="hidden w-60 shrink-0 overflow-auto border-r md:block"
        >
          <p class="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            On this page
          </p>
          <nav class="p-2">
            <button
              v-for="heading in toc"
              :key="heading.id"
              class="block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors"
              :class="activeId === heading.id
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'"
              :style="{ paddingLeft: `${0.5 + (heading.level - 1) * 0.75}rem` }"
              @click="scrollTo(heading.id)"
            >
              {{ heading.text }}
            </button>
          </nav>
        </aside>

        <!-- Document / source -->
        <div ref="scrollContainer" class="min-h-0 flex-1 overflow-auto">
          <div class="mx-auto max-w-3xl px-6 py-8">
            <MarkdownDocument
              v-if="viewMode === 'preview'"
              :html="rendered.html"
              :base-path="context?.file?.path"
              :client="client"
            />
            <pre
              v-else
              class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-foreground"
            >{{ content }}</pre>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
