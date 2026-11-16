import { createVerentisClient, type AppContext, type VerentisClient } from '@verentis/sdk'
import { hostCleanupKey } from '../lib/host-lifecycle'

export function useHost() {
  const client = shallowRef<VerentisClient | null>(null)
  const context = shallowRef<AppContext | null>(null)
  const loading = ref(true)
  const error = ref('')
  let owned: VerentisClient | undefined
  let disposed = false
  const cleanups = new Set<() => Promise<void>>()
  provide(hostCleanupKey, cleanup => {
    cleanups.add(cleanup)
    return () => { cleanups.delete(cleanup) }
  })
  onBeforeUnmount(() => { disposed = true })
  onUnmounted(() => {
    void Promise.allSettled(Array.from(cleanups, cleanup => Promise.resolve().then(cleanup)))
      .finally(() => owned?.destroy())
  })
  onMounted(async () => {
    try {
      if (window.parent === window) throw new Error('Open Excalidraw from your authenticated Verentis workspace.')
      owned = createVerentisClient()
      await owned.whenReady()
      if (disposed) return
      const base = { workspace: owned.context.workspace, apiUrl: owned.context.apiUrl }
      context.value = owned.context.hasFile
        ? { ...base, surface: 'file', file: owned.context.file }
        : { ...base, surface: 'workspace' }
      client.value = owned
      owned.bridge?.setTitle('Excalidraw')
    } catch (cause) {
      if (!disposed) error.value = cause instanceof Error ? cause.message : 'Unable to connect to the workspace.'
    } finally { if (!disposed) loading.value = false }
  })
  return { client: shallowReadonly(client), context: shallowReadonly(context), loading: readonly(loading), error: readonly(error) }
}
