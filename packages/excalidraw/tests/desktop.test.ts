import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppCommandHandler, WorkspaceHint } from '@verentis/sdk'
import { age, boardTitle, createRecentFeed, loadRecentBoards, recentBoards, visibleRows, type RecentFeedState } from '../app/lib/recent'
import { applyTheme, MENU_COMMANDS, openBoard, registerMenuCommands } from '../app/lib/desktop'
import { MIME_TYPE } from '../app/lib/limits'

const uuid = '00000000-0000-4000-8000-000000000001'
const packageFile = (path: string) => resolve(__dirname, '..', path)
afterEach(() => { vi.useRealTimers() })

describe('recent boards', () => {
  it('merges listings into unique boards, most recently changed first', () => {
    const boards = recentBoards([
      [
        { path: `Plan-${uuid}.excalidraw`, name: `Plan-${uuid}.excalidraw`, mimeType: 'application/octet-stream' },
        { path: 'notes.txt', name: 'notes.txt', mimeType: 'text/plain' },
        { path: 'Old.excalidraw', name: 'Old.excalidraw', mimeType: MIME_TYPE, updatedAt: '2026-01-01T00:00:00Z' },
      ],
      [
        { path: `/Plan-${uuid}.excalidraw`, name: `Plan-${uuid}.excalidraw`, mimeType: MIME_TYPE, updatedAt: '2026-03-01T00:00:00Z' },
        { path: '/team/Roadmap', name: 'Roadmap', mimeType: MIME_TYPE, updatedAt: '2026-02-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
        { path: '/team/Undated.excalidraw', name: 'Undated.excalidraw', mimeType: MIME_TYPE, updatedAt: null },
      ],
    ])
    expect(boards).toEqual([
      { path: `/Plan-${uuid}.excalidraw`, name: `Plan-${uuid}.excalidraw`, title: 'Plan', folder: '/', updatedAt: '2026-03-01T00:00:00Z' },
      { path: '/team/Roadmap', name: 'Roadmap', title: 'Roadmap', folder: '/team', updatedAt: '2026-02-01T00:00:00Z' },
      { path: '/Old.excalidraw', name: 'Old.excalidraw', title: 'Old', folder: '/', updatedAt: '2026-01-01T00:00:00Z' },
      { path: '/team/Undated.excalidraw', name: 'Undated.excalidraw', title: 'Undated', folder: '/team', updatedAt: null },
    ])
    expect(recentBoards([[...Array(30)].map((_, i) => ({ path: `/b${i}.excalidraw`, name: `b${i}.excalidraw`, mimeType: MIME_TYPE }))], 5)).toHaveLength(5)
  })

  it('lists the workspace root and searches, surviving one failed listing', async () => {
    const get = vi.fn().mockResolvedValue({ children: [{ path: '/a.excalidraw', name: 'a.excalidraw', mimeType: MIME_TYPE, size: 1 }] })
    const search = vi.fn().mockRejectedValue(new Error('search is down'))
    await expect(loadRecentBoards({ get, search })).resolves.toMatchObject([{ path: '/a.excalidraw', title: 'a' }])
    expect(get).toHaveBeenCalledWith('', { pageNo: 1, pageSize: 50, orderBy: 'name' })
    expect(search).toHaveBeenCalledWith('excalidraw', { pageSize: 100 })
    get.mockRejectedValue(new Error('forbidden'))
    await expect(loadRecentBoards({ get, search })).rejects.toThrow('forbidden')
  })

  it('formats titles, ages and how many rows fit the widget', () => {
    expect(boardTitle(`Sketch-${uuid}.excalidraw`)).toBe('Sketch')
    expect(boardTitle('.excalidraw')).toBe('.excalidraw')
    const now = Date.parse('2026-05-10T12:00:00Z')
    expect(['2026-05-10T11:59:40Z', '2026-05-10T11:15:00Z', '2026-05-10T07:00:00Z', '2026-05-07T12:00:00Z', '2026-04-01T09:00:00Z']
      .map(iso => age(iso, now))).toEqual(['now', '45m', '5h', '3d', '2026-04-01'])
    expect(age(null, now)).toBe('')
    expect([2, 4, 6].map(visibleRows)).toEqual([1, 3, 6])
  })
})

describe('recent boards feed', () => {
  function setup() {
    const files = { get: vi.fn().mockResolvedValue({ children: [] }), search: vi.fn().mockResolvedValue({ data: [] }) }
    let handler: ((hint: WorkspaceHint) => void) | undefined
    const unsubscribe = vi.fn()
    const hints = { subscribeHints: vi.fn((_topics: readonly ['files'], next: (hint: WorkspaceHint) => void) => { handler = next; return unsubscribe }) }
    const states: RecentFeedState[] = []
    const feed = createRecentFeed({ files, hints, onState: state => states.push(state), debounceMs: 100 })
    return { files, hints, unsubscribe, states, feed, hint: (hint: WorkspaceHint) => handler?.(hint) }
  }

  it('starts no work while the dashboard is being designed', async () => {
    const { files, hints, feed } = setup()
    feed.setDesigning(true)
    await feed.refresh()
    expect(files.get).not.toHaveBeenCalled()
    expect(hints.subscribeHints).not.toHaveBeenCalled()
  })

  it('lists on resume and refetches once for a burst of board hints', async () => {
    vi.useFakeTimers()
    const { files, hints, states, feed, hint } = setup()
    feed.setDesigning(false)
    await vi.runAllTimersAsync()
    expect(hints.subscribeHints).toHaveBeenCalledWith(['files'], expect.any(Function))
    expect(files.get).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toEqual({ boards: [], loading: false, error: '', loaded: true })
    hint({ topic: 'files', kind: 'changed', path: '/notes.txt' })
    hint({ topic: 'files', kind: 'changed', path: '/a.excalidraw' })
    hint({ topic: 'files', kind: 'changed', path: '/b.excalidraw' })
    await vi.runAllTimersAsync()
    expect(files.get).toHaveBeenCalledTimes(2)
    hint({ topic: 'files', kind: 'reconnected' })
    await vi.runAllTimersAsync()
    expect(files.get).toHaveBeenCalledTimes(3)
  })

  it('stops live updates when designing starts and on dispose', async () => {
    vi.useFakeTimers()
    const { files, unsubscribe, feed, hint } = setup()
    feed.setDesigning(false)
    await vi.runAllTimersAsync()
    hint({ topic: 'files', kind: 'changed', path: '/a.excalidraw' })
    feed.setDesigning(true)
    await vi.runAllTimersAsync()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(files.get).toHaveBeenCalledTimes(1)
    feed.setDesigning(false)
    await vi.runAllTimersAsync()
    expect(files.get).toHaveBeenCalledTimes(2)
    feed.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('reports a failed listing', async () => {
    const { files, states, feed } = setup()
    files.get.mockRejectedValue(new Error('forbidden'))
    files.search.mockRejectedValue(new Error('forbidden'))
    feed.setDesigning(false)
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ loading: false, loaded: true, error: 'forbidden' }))
  })
})

describe('workspace desktop', () => {
  const manifest = parse(readFileSync(packageFile('excalidraw.app.yaml'), 'utf8'))

  it('opens a board in a window, falling back to navigation', () => {
    const openWindow = vi.fn()
    const navigate = vi.fn()
    openBoard({ openWindow, navigate }, 'Plan.excalidraw')
    expect(openWindow).toHaveBeenCalledWith({ path: '/Plan.excalidraw' })
    openWindow.mockImplementation(() => { throw new Error('This workspace host cannot open app windows.') })
    openBoard({ openWindow, navigate }, '/team/Plan.excalidraw')
    openBoard({ navigate }, '/old-host.excalidraw')
    expect(navigate.mock.calls).toEqual([['/team/Plan.excalidraw'], ['/old-host.excalidraw']])
  })

  it('declares the Recent boards widget and a menu item for every registered command', () => {
    expect(manifest.spec.widgets).toEqual([expect.objectContaining({ id: 'recent', route: '/widgets/recent', 'default-size': { w: 4, h: 4 } })])
    expect(existsSync(packageFile('app/pages/widgets/recent.vue'))).toBe(true)
    const items = manifest.spec.menus.flatMap((menu: { items: { command?: string }[] }) => menu.items).filter((item: { command?: string }) => item.command)
    expect(items.map((item: { command: string }) => item.command).sort()).toEqual(MENU_COMMANDS.map(command => command.id).sort())
  })

  it('registers menu commands only while the board window is focused', () => {
    let focus: ((focused: boolean) => void) | undefined
    const registrations: { descriptor: AppCommand, update: ReturnType<typeof vi.fn>, dispose: ReturnType<typeof vi.fn> }[] = []
    const bridge = {
      registerCommand: vi.fn((descriptor: AppCommand, _handler: AppCommandHandler) => {
        const registration = { descriptor, update: vi.fn(), dispose: vi.fn() }
        registrations.push(registration)
        return registration
      }),
      onWindowFocus: vi.fn((listener: (focused: boolean) => void) => { focus = listener; return vi.fn() }),
    }
    let saving = false
    const handlers = Object.fromEntries(MENU_COMMANDS.map(command => [command.id, vi.fn()])) as never
    const commands = registerMenuCommands(bridge, {
      focused: false, handlers,
      state: () => ({ 'board.save': { enabled: saving, disabledReason: 'No unsaved changes.' } }),
    })
    expect(bridge.registerCommand).not.toHaveBeenCalled()
    focus!(true)
    expect(registrations.map(registration => registration.descriptor.id)).toEqual(MENU_COMMANDS.map(command => command.id))
    expect(registrations[0]!.descriptor).toMatchObject({ id: 'board.save', enabled: false, disabledReason: 'No unsaved changes.' })
    expect(bridge.registerCommand.mock.calls[2]![1]).toBe((handlers as Record<string, unknown>)['board.export-png'])
    saving = true
    commands.refresh()
    expect(registrations[0]!.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'board.save', enabled: true }))
    expect(registrations[0]!.update.mock.calls[0]![0]).not.toHaveProperty('disabledReason')
    focus!(false)
    expect(registrations.every(registration => registration.dispose.mock.calls.length === 1)).toBe(true)
    commands.dispose()
    focus!(true)
    expect(bridge.registerCommand).toHaveBeenCalledTimes(MENU_COMMANDS.length)
  })

  it('applies the host theme and drops variables it stops sending', () => {
    const root = document.createElement('div')
    applyTheme(root, { colorScheme: 'dark', variables: { '--card': '#111', 'bad name': 'x', '--muted-foreground': '#999' } })
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.getPropertyValue('--card')).toBe('#111')
    applyTheme(root, { colorScheme: 'light', variables: { '--card': '#fff' } })
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.getPropertyValue('--muted-foreground')).toBe('')
  })
})
