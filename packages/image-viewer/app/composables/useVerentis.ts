import { createVerentisClient, type VerentisClient } from '@verentis/sdk'

/**
 * Core composable for Verentis app integration.
 *
 * Initialises the SDK client (auto-detects iframe vs standalone mode)
 * and provides reactive state for workspace/file context and loading status.
 */
export function useVerentis() {
  const config = useRuntimeConfig()

  const client = shallowRef<VerentisClient | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)
  const context = ref<{
    workspace: { id: string; slug: string; name: string }
    file: { path: string; name: string; mimeType: string; size: number }
  } | null>(null)

  onMounted(async () => {
    try {
      const apiUrl = config.public.verentisApiUrl as string
      const apiKey = config.public.verentisApiKey as string

      const c = createVerentisClient(
        apiUrl && apiKey
          ? { apiUrl, auth: { apiKey } }
          : undefined,
      )

      // Wait for the client to be ready (in iframe mode, waits for the init handshake)
      await c.whenReady()

      client.value = c

      try {
        const ws = c.context.workspace
        const file = c.context.hasFile ? c.context.file : null

        context.value = {
          workspace: {
            id: ws.id,
            slug: ws.slug ?? '',
            name: ws.name ?? '',
          },
          file: {
            path: file?.path ?? '',
            name: file?.name ?? '',
            mimeType: file?.mimeType ?? '',
            size: file?.size ?? 0,
          },
        }
      } catch {
        // Context not available (standalone mode without workspace set)
        context.value = null
      }
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to initialise Verentis SDK'
      console.error('[useVerentis] Initialisation failed:', e)
    } finally {
      loading.value = false
    }
  })

  return {
    // Use shallowReadonly for client to prevent breaking internal state (e.g., bridge.listeners)
    // while still protecting the ref from external reassignment
    client: shallowReadonly(client),
    context: readonly(context),
    loading: readonly(loading),
    error: readonly(error),
  }
}
