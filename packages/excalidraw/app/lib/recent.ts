import type { FileEntry, FilesModule, WorkspaceHint } from '@verentis/sdk'
import { listDocuments } from './launcher'
import { MIME_TYPE } from './limits'

/** Dashboard grid row height in pixels (the workspace dashboard uses 64px rows). */
const GRID_ROW = 64
/** The widget frame's vertical padding plus this widget's header. */
const CHROME = 32 + 44
const ROW = 46

/** Boards fetched per refresh; the widget shows as many as fit its height. */
export const RECENT_LIMIT = 20

export interface RecentBoard {
  path: string
  name: string
  title: string
  folder: string
  updatedAt: string | null
}

type ListedFile = Pick<FileEntry, 'path' | 'name' | 'mimeType'> & { updatedAt?: string | null, createdAt?: string | null }

/** A board's display name: the file name without `.excalidraw` and the launcher's `-<uuid>` collision suffix. */
export function boardTitle(name: string): string {
  return name.replace(/\.excalidraw$/i, '').replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '') || name
}

export function isBoardPath(path: string): boolean {
  return /\.excalidraw$/i.test(path)
}

const absolute = (path: string) => (path.startsWith('/') ? path : `/${path}`)

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? '/' : path.slice(0, slash)
}

function timestamp(entry: ListedFile): string | null {
  const value = entry.updatedAt ?? entry.createdAt
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

/** Excalidraw boards from any listings, deduplicated by path, most recently changed first. */
export function recentBoards(listings: readonly (readonly ListedFile[])[], limit = RECENT_LIMIT): RecentBoard[] {
  const boards = new Map<string, RecentBoard>()
  for (const entry of listings.flat()) {
    if (entry.mimeType !== MIME_TYPE && !isBoardPath(entry.name)) continue
    const path = absolute(entry.path)
    const board = { path, name: entry.name, title: boardTitle(entry.name), folder: folderOf(path), updatedAt: timestamp(entry) }
    const known = boards.get(path)
    if (!known || (board.updatedAt ?? '') > (known.updatedAt ?? '')) boards.set(path, board)
  }
  return [...boards.values()]
    .sort((a, b) => (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0) || a.title.localeCompare(b.title))
    .slice(0, limit)
}

/**
 * Lists the boards the app can see: the workspace root, where the launcher creates boards, and a name/path search
 * for "excalidraw". The SDK has no listing by MIME type or modification date, so both are filtered and sorted here.
 * Fails only when every listing fails.
 */
export async function loadRecentBoards(files: Pick<FilesModule, 'get' | 'search'>, limit = RECENT_LIMIT): Promise<RecentBoard[]> {
  const [root, found] = await Promise.allSettled([
    listDocuments(files, 1).then((result): ListedFile[] => result.entries),
    files.search('excalidraw', { pageSize: 100 }).then((page): ListedFile[] => page.data),
  ])
  if (root.status === 'rejected' && found.status === 'rejected') throw root.reason
  return recentBoards([root.status === 'fulfilled' ? root.value : [], found.status === 'fulfilled' ? found.value : []], limit)
}

/** How many board rows fit a widget `rows` grid units tall (at least one). */
export function visibleRows(rows: number): number {
  return Math.max(1, Math.floor((rows * GRID_ROW - CHROME) / ROW))
}

/** Whether a workspace hint may change the list of recent boards. */
export function affectsBoards(hint: WorkspaceHint): boolean {
  return hint.kind === 'reconnected' || !hint.path || isBoardPath(hint.path)
}

/** A compact age for the row's right-aligned time: `now`, `5m`, `3h`, `2d`, else the date. */
export function age(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`
  return iso.slice(0, 10)
}

export interface RecentFeedState {
  boards: RecentBoard[]
  loading: boolean
  error: string
  /** Whether a listing has completed at least once. */
  loaded: boolean
}

export interface HintSource {
  subscribeHints(topics: readonly ['files'], handler: (hint: WorkspaceHint) => void): () => void
}

export interface RecentFeed {
  /** Pauses (dashboard designer open) or resumes listing and live updates; resuming refetches. */
  setDesigning(designing: boolean): void
  refresh(): Promise<void>
  dispose(): void
}

/**
 * Keeps the recent-boards list current: lists on resume and refetches (debounced) when a `files` hint touches a
 * board. While the dashboard is being designed it starts no work and keeps showing what it last had.
 */
export function createRecentFeed(options: {
  files: Pick<FilesModule, 'get' | 'search'>
  hints?: HintSource | null
  onState: (state: RecentFeedState) => void
  debounceMs?: number
}): RecentFeed {
  let state: RecentFeedState = { boards: [], loading: false, error: '', loaded: false }
  let designing = true
  let disposed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  const set = (next: Partial<RecentFeedState>) => {
    state = { ...state, ...next }
    options.onState(state)
  }
  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const refresh = async () => {
    if (disposed || designing) return
    cancelTimer()
    const current = ++generation
    set({ loading: true, error: '' })
    try {
      const boards = await loadRecentBoards(options.files)
      if (!disposed && current === generation) set({ boards, loading: false, loaded: true })
    } catch (cause) {
      if (!disposed && current === generation) set({ loading: false, loaded: true, error: cause instanceof Error ? cause.message : 'Unable to list boards.' })
    }
  }
  const onHint = (hint: WorkspaceHint) => {
    if (disposed || designing || !affectsBoards(hint)) return
    cancelTimer()
    timer = setTimeout(() => { timer = undefined; void refresh() }, options.debounceMs ?? 400)
  }
  return {
    setDesigning(next) {
      if (disposed || next === designing) return
      designing = next
      if (designing) {
        cancelTimer()
        unsubscribe?.()
        unsubscribe = undefined
        return
      }
      try { unsubscribe = options.hints?.subscribeHints(['files'], onHint) }
      catch { unsubscribe = undefined }
      void refresh()
    },
    refresh,
    dispose() {
      disposed = true
      cancelTimer()
      unsubscribe?.()
      unsubscribe = undefined
    },
  }
}
