import { createVerentisClient, type VerentisClient, type WidgetSize } from '@verentis/sdk'
import { applyTheme } from '../lib/desktop'

/**
 * Host connection for a dashboard widget route (`context.surface === 'widget'`): the client, the widget's grid size,
 * whether the dashboard is being arranged (`designing`: render statically, start no work) and the host theme.
 */
export function useWidgetHost() {
  const client = shallowRef<VerentisClient | null>(null)
  const size = ref<WidgetSize>({ w: 4, h: 4 })
  const designing = ref(true)
  const loading = ref(true)
  const error = ref('')
  const stops: (() => void)[] = []
  let owned: VerentisClient | undefined
  let disposed = false

  onMounted(async () => {
    try {
      if (window.parent === window) throw new Error('Add this widget to a dashboard in your Verentis workspace.')
      owned = createVerentisClient()
      const bridge = owned.bridge
      if (bridge) {
        stops.push(bridge.on('verentis:theme', message => {
          if (message.type === 'verentis:theme') applyTheme(document.documentElement, message)
        }))
        stops.push(bridge.onWidgetResize((next, isDesigning) => {
          size.value = { ...next }
          designing.value = isDesigning
        }))
      }
      await owned.whenReady()
      if (disposed) return
      const widget = owned.context.widget
      if (widget) {
        size.value = widget.size
        designing.value = widget.designing
      } else {
        designing.value = false
      }
      client.value = owned
    } catch (cause) {
      if (!disposed) error.value = cause instanceof Error ? cause.message : 'Unable to connect to the workspace.'
    } finally {
      if (!disposed) loading.value = false
    }
  })

  onBeforeUnmount(() => {
    disposed = true
    for (const stop of stops.splice(0)) stop()
    owned?.destroy()
  })

  return {
    client: shallowReadonly(client),
    size: readonly(size),
    designing: readonly(designing),
    loading: readonly(loading),
    error: readonly(error),
  }
}
