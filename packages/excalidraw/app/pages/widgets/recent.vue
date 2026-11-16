<script setup lang="ts">
import { age, createRecentFeed, visibleRows, type RecentBoard, type RecentFeed, type RecentFeedState } from '../../lib/recent'
import { openBoard, openLauncher } from '../../lib/desktop'

const { client, size, designing, loading, error } = useWidgetHost()
const state = shallowRef<RecentFeedState>({ boards: [], loading: false, error: '', loaded: false })
const now = ref(Date.now())
let feed: RecentFeed | undefined
let clock: ReturnType<typeof setInterval> | undefined

watch(client, current => {
  if (!current || feed) return
  feed = createRecentFeed({
    files: current.files,
    hints: current.bridge,
    onState: next => {
      state.value = next
      now.value = Date.now()
    },
  })
  feed.setDesigning(designing.value)
}, { immediate: true })

watch(designing, value => {
  feed?.setDesigning(value)
  if (clock !== undefined) clearInterval(clock)
  clock = value ? undefined : setInterval(() => { now.value = Date.now() }, 60_000)
}, { immediate: true })

onBeforeUnmount(() => {
  feed?.dispose()
  if (clock !== undefined) clearInterval(clock)
})

const shown = computed(() => state.value.boards.slice(0, visibleRows(size.value.h)))
const meta = computed(() => {
  if (state.value.loading && !state.value.loaded) return 'loading…'
  const count = state.value.boards.length
  return state.value.loaded ? `${count} board${count === 1 ? '' : 's'}` : ''
})

function open(board: RecentBoard) {
  if (!designing.value) openBoard(client.value?.bridge, board.path)
}
</script>

<template>
  <main class="recent-widget" :aria-busy="loading || state.loading">
    <header class="rw-header">
      <h1 class="rw-title">Recent boards</h1>
      <span class="rw-meta">{{ meta }}</span>
      <button type="button" class="rw-link" :disabled="designing || !client" @click="openLauncher(client?.bridge)">All boards</button>
    </header>
    <p v-if="loading" class="rw-note" role="status">Connecting to your workspace…</p>
    <p v-else-if="error" class="rw-note rw-error" role="alert">{{ error }}</p>
    <p v-else-if="state.error" class="rw-note rw-error" role="alert">{{ state.error }}</p>
    <p v-else-if="!state.loaded" class="rw-note">Your most recently changed boards appear here.</p>
    <p v-else-if="!state.boards.length" class="rw-note">No boards yet. Create one from Excalidraw.</p>
    <ul v-else class="rw-list" aria-label="Recently changed boards">
      <li v-for="board in shown" :key="board.path">
        <button type="button" class="rw-row" :disabled="designing" :title="board.path" @click="open(board)">
          <svg class="rw-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
            <rect x="3" y="14" width="7" height="7" />
            <circle cx="17.5" cy="17.5" r="3.5" />
          </svg>
          <span class="rw-text">
            <span class="rw-name">{{ board.title }}</span>
            <span class="rw-sub">{{ board.folder }}</span>
          </span>
          <time v-if="board.updatedAt" class="rw-time" :datetime="board.updatedAt">{{ age(board.updatedAt, now) }}</time>
        </button>
      </li>
    </ul>
  </main>
</template>
