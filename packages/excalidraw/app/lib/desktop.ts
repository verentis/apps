import type { AppCommand, AppCommandHandler, AppCommandRegistration, OpenWindowTarget } from '@verentis/sdk'

/** This app's `metadata.id`. */
export const EXCALIDRAW_APP_ID = 'excalidraw'

/** The subset of the SDK bridge used to open things. `openWindow` is missing on SDK bridges older than 1.1. */
export interface WindowBridge {
  openWindow?: (target: OpenWindowTarget) => void
  navigate(path: string): void
}

/** Opens (or focuses) a board in its own window; hosts without window layouts navigate to it instead. */
export function openBoard(bridge: WindowBridge | null | undefined, path: string): void {
  if (!bridge) return
  const absolute = path.startsWith('/') ? path : `/${path}`
  try {
    if (!bridge.openWindow) throw new Error('No window support.')
    bridge.openWindow({ path: absolute })
  } catch {
    bridge.navigate(absolute)
  }
}

/** Opens the Excalidraw launcher window. */
export function openLauncher(bridge: WindowBridge | null | undefined): void {
  if (!bridge?.openWindow) return
  try { bridge.openWindow({ app: EXCALIDRAW_APP_ID, entryPoint: 'home' }) } catch { /* the host cannot open app windows */ }
}

export type MenuCommandId = 'board.save' | 'board.download' | 'board.export-png' | 'board.export-svg' | 'view.zoom-to-fit'

/** Commands behind the manifest's Board and View menus (`spec.menus`); ids must match the manifest. */
export const MENU_COMMANDS: readonly (AppCommand & { id: MenuCommandId })[] = [
  { id: 'board.save', label: 'Save', group: 'Excalidraw', icon: 'lucide:save', keywords: ['store', 'persist'] },
  { id: 'board.download', label: 'Download document', group: 'Excalidraw', icon: 'lucide:download', keywords: ['excalidraw', 'json', 'copy'] },
  { id: 'board.export-png', label: 'Export PNG', group: 'Excalidraw', icon: 'lucide:image', keywords: ['image', 'picture', 'png'] },
  { id: 'board.export-svg', label: 'Export SVG', group: 'Excalidraw', icon: 'lucide:file-image', keywords: ['vector', 'svg'] },
  { id: 'view.zoom-to-fit', label: 'Zoom to fit', group: 'Excalidraw', icon: 'lucide:scan', keywords: ['fit', 'zoom', 'view all'] },
]

export type MenuCommandState = Pick<AppCommand, 'enabled' | 'busy' | 'disabledReason'>

export interface CommandBridge {
  registerCommand(descriptor: AppCommand, handler: AppCommandHandler): AppCommandRegistration
  onWindowFocus?(listener: (focused: boolean) => void): () => void
}

export interface MenuCommands {
  /** Re-sends the enabled/busy state of the registered commands. */
  refresh(): void
  dispose(): void
}

/**
 * Registers the menu commands while this window is focused and removes them when it loses focus, so the menu bar
 * drives the focused board even with several boards open. On hosts without windows the commands stay registered.
 */
export function registerMenuCommands(
  bridge: CommandBridge,
  options: {
    focused: boolean
    handlers: Record<MenuCommandId, AppCommandHandler>
    state: () => Partial<Record<MenuCommandId, MenuCommandState>>
  },
): MenuCommands {
  let registrations: { command: AppCommand, registration: AppCommandRegistration }[] = []
  let disposed = false
  const describe = (command: AppCommand): AppCommand => {
    const state = options.state()[command.id as MenuCommandId] ?? {}
    return {
      ...command,
      ...(state.enabled === undefined ? {} : { enabled: state.enabled }),
      ...(state.busy === undefined ? {} : { busy: state.busy }),
      ...(state.enabled === false && state.disabledReason ? { disabledReason: state.disabledReason } : {}),
    }
  }
  const register = () => {
    if (disposed || registrations.length) return
    registrations = MENU_COMMANDS.map(command => ({
      command,
      registration: bridge.registerCommand(describe(command), options.handlers[command.id]),
    }))
  }
  const unregister = () => {
    for (const { registration } of registrations.splice(0)) registration.dispose()
  }
  const stopFocus = bridge.onWindowFocus?.(focused => { if (focused) register(); else unregister() })
  if (options.focused) register()
  return {
    refresh() {
      for (const { command, registration } of registrations) registration.update(describe(command))
    },
    dispose() {
      disposed = true
      stopFocus?.()
      unregister()
    },
  }
}

const VARIABLE_NAME = /^--[A-Za-z0-9_-]{1,64}$/
const applied = new WeakMap<HTMLElement, Set<string>>()

/**
 * Applies the host's `verentis:theme`: the colour scheme as the `dark` class and the workspace's resolved CSS
 * variables on the root element. Variables the host stops sending fall back to the app's own defaults.
 */
export function applyTheme(root: HTMLElement, message: { colorScheme?: unknown, variables?: unknown }): void {
  root.classList.toggle('dark', message.colorScheme === 'dark')
  const previous = applied.get(root) ?? new Set<string>()
  const next = new Set<string>()
  const variables = message.variables && typeof message.variables === 'object' ? message.variables as Record<string, unknown> : {}
  for (const [name, value] of Object.entries(variables)) {
    if (!VARIABLE_NAME.test(name) || typeof value !== 'string' || !value.trim() || value.length > 1000) continue
    root.style.setProperty(name, value)
    next.add(name)
  }
  for (const name of previous) if (!next.has(name)) root.style.removeProperty(name)
  applied.set(root, next)
}
