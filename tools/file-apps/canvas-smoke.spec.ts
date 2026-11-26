// Renders the generated Canvas documents of the file-based apps in the real Canvas runtime. Run with
// tools/file-apps/smoke-canvas.sh; the script copies this file into a Canvas checkout, where the imports resolve.
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { ComponentRegistry, parseCanvasYaml } from '@verentis/canvas-core'
import type { CanvasRuntime } from '@verentis/canvas-core'
import { ActionEngine, CanvasDataGraph } from '@verentis/canvas-data'
import type { CanvasDataHost } from '@verentis/canvas-data'
import { CanvasDocumentView } from '@verentis/canvas-renderer'
import { firstPartyPacks } from '../src/index'

const PACKAGES = process.env.APPS_PACKAGES!
const RECORD = '/records/R-1.json'

type Entry = { path: string, data: Record<string, unknown> }
interface World { record?: Record<string, unknown>, folders?: Record<string, Entry[]>, files?: Record<string, unknown>, apps?: { app: string, operation: string, available: boolean }[], user?: { id: string, name: string, email?: string } }

export async function render(pkg: string, file: string, world: World = {}) {
  const parsed = parseCanvasYaml(readFileSync(`${PACKAGES}/${pkg}/canvas/${file}`, 'utf8').replaceAll('${var:canvas-origin}', 'https://canvas.example'))
  expect(parsed.issues.filter(issue => issue.severity === 'error'), `${pkg}/${file}`).toEqual([])
  const model = parsed.model!
  const errors: string[] = []
  const bound = (model.spec.binds ?? []).length > 0
  const record = JSON.stringify(world.record ?? { code: 'R-1', state: 'active' })
  // A folder's records carry the MIME its sources ask for, as the workspace would report them.
  const mimes: Record<string, string> = {}
  for (const source of Object.values(model.spec.data ?? {}) as { kind?: string, path?: string, 'mime-pattern'?: string, mimePattern?: string }[]) {
    const pattern = source['mime-pattern'] ?? source.mimePattern
    if (source.kind === 'folder' && source.path && pattern) mimes[source.path.replace(/\/$/, '')] = pattern
  }
  const stored = Object.values(world.folders ?? {}).flat()
  const entries = (path: string) => (world.folders?.[path.replace(/\/$/, '')] ?? []).map(entry => ({
    kind: 'file', name: entry.path.split('/').pop(), path: entry.path, mimeType: (entry as { mimeType?: string }).mimeType ?? mimes[path.replace(/\/$/, '')] ?? 'application/json',
  }))
  const host: CanvasDataHost = {
    readFile: async (path) => {
      if (path === RECORD) return { content: record, mimeType: 'application/json' }
      const entry = stored.find(candidate => candidate.path === path)
      if (entry) return { content: JSON.stringify(entry.data), mimeType: 'application/json' }
      if (world.files && path in world.files) return { content: JSON.stringify(world.files[path]), mimeType: 'application/json' }
      throw new Error(`File not found: ${path}`)
    },
    readFileSnapshot: async target => ({ ...target, nodeId: 'n1', branch: 'main', revision: 'r1', content: record, mimeType: 'application/json' }),
    writeFileSnapshot: vi.fn(), writeFile: vi.fn(), listFolder: async path => entries(path) as never,
    http: vi.fn(), runScript: vi.fn(), readSetting: async () => null,
    listAppOperations: async () => world.apps ?? [], callApp: vi.fn(async () => ({ result: {} })),
  }
  const ui = { openView: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), openApp: vi.fn(), confirm: vi.fn(async () => true), toast: vi.fn(), preflight: vi.fn(async () => 'ready' as const) }
  const graph = new CanvasDataGraph({ data: model.spec.data, state: model.spec.state }, {
    host,
    ctx: { ...(bound ? { file: { path: RECORD, name: 'R-1.json', dir: '/records' } } : {}), ...(world.user ? { user: world.user } : {}) },
    ...(bound ? { document: { path: RECORD, nodeId: 'n1', branch: 'main', mimeType: 'application/json' } } : {}),
    onError: (source, error) => errors.push(`${source}: ${String(error)}`),
  })
  await graph.start()
  const registry = new ComponentRegistry()
  for (const pack of firstPartyPacks()) registry.registerPack(pack)
  const engine = new ActionEngine({ graph, host, ui: ui as never, actions: model.spec.actions, onError: (_action, error) => errors.push(String(error)) })
  const runtime: CanvasRuntime = {
    registry, scope: graph.scope as Record<string, unknown>, write: (path, value) => graph.write(path, value),
    dispatch: (ref, payload, scope, roots) => engine.dispatch(ref, payload, scope, roots), actionStatus: ref => engine.status(ref),
  }
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const wrapper = mount(CanvasDocumentView, { props: { document: model, runtime }, attachTo: document.body })
  await flushPromises()
  const renderErrors = [...consoleError.mock.calls, ...consoleWarn.mock.calls].map(call => String(call[0])).filter(message => /Unhandled error|expression|Cannot read|is not a function|not defined/i.test(message))
  consoleError.mockRestore()
  consoleWarn.mockRestore()
  return { wrapper, errors, renderErrors, graph, host, ui, engine }
}

/** Errors that only say a file or folder is not there yet: an empty workspace, not a broken page. */
const absent = (message: string) => /not found|No such|ENOENT|missing/i.test(message)

const packages = readdirSync(PACKAGES).filter(name => existsSync(`${PACKAGES}/${name}/canvas`) && existsSync(`${PACKAGES}/${name}/src/pages.mjs`))

describe('every generated document renders in an empty workspace', () => {
  for (const pkg of packages) {
    const files = readdirSync(`${PACKAGES}/${pkg}/canvas`).filter(name => name.endsWith('.yaml'))
    it(`${pkg}: ${files.length} documents`, async () => {
      for (const file of files) {
        const { wrapper, errors, renderErrors } = await render(pkg, file)
        expect(renderErrors, `${pkg}/${file}`).toEqual([])
        expect(errors.filter(message => !absent(message)), `${pkg}/${file}`).toEqual([])
        if (file.endsWith('.page.yaml') && !file.includes('.widget.')) expect(wrapper.find('.cv-c-shell').exists(), `${pkg}/${file} has the app sidebar`).toBe(true)
        wrapper.unmount()
      }
    })
  }
})

const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()
const today = new Date().toISOString().slice(0, 10)

describe('design views draw from the records', () => {
  it('helpdesk: sidebar counts, SLA strip, workload chart, stage board', async () => {
    const tickets = [
      { path: '/tickets/TKT-1.json', data: { code: 'TKT-1', subject: 'Wrong timezone', stage: 'in-progress', priority: 'urgent', assignee: 'Thandi', slaDeadline: soon(-3), state: 'active' } },
      { path: '/tickets/TKT-2.json', data: { code: 'TKT-2', subject: 'Cannot log in', stage: 'new', priority: 'high', assignee: '', slaDeadline: soon(2), state: 'active' } },
      { path: '/tickets/TKT-3.json', data: { code: 'TKT-3', subject: 'Old one', stage: 'closed', priority: 'low', assignee: 'Thandi', slaDeadline: soon(-90), state: 'active' } },
    ]
    const world = { folders: { '/tickets': tickets } }
    const sla = await render('helpdesk', 'sla.page.yaml', world)
    expect([...sla.errors.filter(message => !absent(message)), ...sla.renderErrors]).toEqual([])
    expect(sla.wrapper.find('[data-slot="canvas-time-strip"], .cv-c-strip, .cv-c-timestrip').exists()).toBe(true)
    expect(sla.wrapper.find('.cv-c-shell').text()).toContain('Queue')
    expect(sla.wrapper.findAll('.cv-c-shell__count').map(count => count.text())).toEqual(expect.arrayContaining(['2', '1']))
    sla.wrapper.unmount()

    const workload = await render('helpdesk', 'workload.page.yaml', world)
    expect(workload.renderErrors).toEqual([])
    expect(workload.wrapper.text()).toContain('Unassigned')
    workload.wrapper.unmount()

    const boardPage = await render('helpdesk', 'tickets.page.yaml', world)
    expect(boardPage.renderErrors).toEqual([])
    expect(boardPage.wrapper.find('.cv-c-board').text()).toContain('Wrong timezone')
    await boardPage.wrapper.find('.cv-c-board__card').trigger('click')
    expect(boardPage.ui.openFile).toHaveBeenCalled()
    boardPage.wrapper.unmount()

    const home = await render('helpdesk', 'home.page.yaml', world)
    expect(home.renderErrors).toEqual([])
    expect(home.wrapper.find('.cv-c-table').text()).toContain('Cannot log in')
    home.wrapper.unmount()
  })

  it('appointments: the calendar shows a booked appointment', async () => {
    const world = { folders: { '/appointments': [{ path: '/appointments/APT-1.json', data: { code: 'APT-1', guestName: 'Ana Petersen', date: today, startTime: '10:00', host: 'Lindiwe', status: 'confirmed', state: 'active' } }] } }
    const page = await render('appointments', 'upcoming.page.yaml', world)
    expect([...page.errors.filter(message => !absent(message)), ...page.renderErrors]).toEqual([])
    expect(page.wrapper.find('.cv-c-calendar').text()).toContain('Ana Petersen')
    page.wrapper.unmount()
  })
})

/** One record per kind, shaped by the app's own template, with dates set so that date-based views have something to draw. */
async function seeded(pkg: string): Promise<World | null> {
  const contracts = await import(/* @vite-ignore */ `${PACKAGES}/${pkg}/src/contracts.mjs`).catch(() => null)
  if (!contracts?.containers || !contracts.templates) return null
  const folders: Record<string, Entry[]> = {}
  for (const container of Object.values(contracts.containers) as { path: string, holds?: string[] }[]) {
    folders[container.path] = (container.holds ?? []).filter(kind => contracts.templates[kind]).map((kind, index) => {
      const data: Record<string, unknown> = { ...contracts.templates[kind], code: `${kind.toUpperCase()}-${index + 1}`, state: 'active' }
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.includes('{{')) data[key] = /date|At$|deadline/i.test(key) ? today : 'Sample'
        else if (value === '' && /date|deadline/i.test(key)) data[key] = today
      }
      return { path: `${container.path}/${data.code}`, data }
    })
  }
  return { folders }
}

describe('every page renders with one record of each kind', () => {
  for (const pkg of packages) {
    it(pkg, async () => {
      const world = await seeded(pkg)
      if (!world) return
      for (const file of readdirSync(`${PACKAGES}/${pkg}/canvas`).filter(name => name.endsWith('.page.yaml'))) {
        const { wrapper, errors, renderErrors } = await render(pkg, file, world)
        expect(renderErrors, `${pkg}/${file}`).toEqual([])
        expect(errors.filter(message => !absent(message)), `${pkg}/${file}`).toEqual([])
        wrapper.unmount()
      }
    })
  }
})

describe('board cards move', () => {
  const ticket = (code: string, stage: string) => ({ path: `/tickets/${code}.json`, data: { code, subject: `Ticket ${code}`, stage, priority: 'normal', assignee: 'Thandi', slaDeadline: soon(8), state: 'active' } })
  const column = (wrapper: { findAll: (selector: string) => { text: () => string }[] }, label: string) =>
    wrapper.findAll('.cv-c-board__column').find(candidate => candidate.text().startsWith(label))!

  it('helpdesk: a drop on Waiting writes the stage; a drop on Solved runs Resolve; a refused script puts the card back', async () => {
    const world = { folders: { '/tickets': [ticket('TKT-1', 'in-progress'), ticket('TKT-2', 'in-progress')] } }
    const page = await render('helpdesk', 'tickets.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    const card = (code: string) => page.wrapper.findAll('.cv-c-board__card').find(candidate => candidate.text().includes(`Ticket ${code}`))!
    expect(card('TKT-1').attributes('draggable')).toBe('true')

    // In progress → Waiting: set directly, as the form would.
    await card('TKT-1').trigger('keydown', { key: 'ArrowRight', altKey: true })
    await flushPromises()
    const [path, content] = (page.host.writeFile as unknown as { mock: { calls: [string, string][] } }).mock.calls[0]!
    expect(path).toBe('/tickets/TKT-1.json')
    expect(JSON.parse(content)).toMatchObject({ code: 'TKT-1', stage: 'waiting', subject: 'Ticket TKT-1' })
    expect(page.ui.toast).toHaveBeenCalledWith('Moved to Waiting', 'success')

    // Solved is reached through the action script, never written directly.
    const runScript = page.host.runScript as unknown as { mockResolvedValueOnce: (value: unknown) => void, mockRejectedValueOnce: (value: unknown) => void, mock: { calls: [{ parameters: Record<string, unknown> }][] } }
    runScript.mockResolvedValueOnce({ message: 'TKT-2 resolved' })
    const confirm = page.ui.confirm as unknown as { mockResolvedValueOnce: (value: unknown) => void }
    confirm.mockResolvedValueOnce({ values: { resolution: 'Restarted the sync' } })
    const board = page.wrapper.findComponent({ name: 'CvBoard' })
    await (board.props('onMove') as (payload: unknown) => Promise<unknown>)({ row: world.folders['/tickets'][1], id: '/tickets/TKT-2.json', path: '/tickets/TKT-2.json', from: 'in-progress', to: 'solved', index: 0 })
    await flushPromises()
    expect(runScript.mock.calls.at(-1)![0].parameters).toEqual({ operation: 'resolve', path: '/tickets/TKT-2.json', resolution: 'Restarted the sync' })
    expect((page.host.writeFile as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    expect(page.ui.toast).toHaveBeenCalledWith('TKT-2 resolved', 'success')

    // The script refuses (no resolution text): the action fails, so the board puts the card back.
    confirm.mockResolvedValueOnce({ values: { resolution: 'x' } })
    runScript.mockRejectedValueOnce(new Error('Script failed: TKT-2 needs a resolution'))
    const outcome = await (board.props('onMove') as (payload: unknown) => Promise<unknown>)({ row: world.folders['/tickets'][1], id: '/tickets/TKT-2.json', path: '/tickets/TKT-2.json', from: 'in-progress', to: 'solved', index: 0 })
    expect(outcome).toBe(false)
    expect(page.errors.join(' ')).toContain('needs a resolution')
    page.wrapper.unmount()
  })

  it('field service: columns only a script reaches take drops; New takes none; done tasks stay put', async () => {
    const world = { folders: { '/field-tasks': [
      { path: '/field-tasks/FST-1.json', data: { code: 'FST-1', customer: 'Cedar', stage: 'new', state: 'active' } },
      { path: '/field-tasks/FST-2.json', data: { code: 'FST-2', customer: 'Harbour', stage: 'done', state: 'active' } },
    ] } }
    const page = await render('field-service', 'tasks.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    const board = page.wrapper.findComponent({ name: 'CvBoard' })
    expect((board.props('columns') as { value: string, locked?: boolean }[]).filter(item => item.locked).map(item => item.value)).toEqual(['new'])
    const done = page.wrapper.findAll('.cv-c-board__card').find(candidate => candidate.text().includes('FST-2'))!
    expect(done.attributes('draggable')).toBeUndefined()
    expect(column(page.wrapper, 'New')).toBeDefined()
    page.wrapper.unmount()
  })
})

describe('work views draw from the records and change them', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  type Mocked = { mock: { calls: unknown[][] }, mockResolvedValueOnce: (value: unknown) => void }

  it('employees: the org chart follows manager links', async () => {
    const people = [
      { path: '/employees/EMP-1.json', data: { code: 'EMP-1', name: 'Karin Botha', jobTitle: 'Director', manager: '', status: 'active', state: 'active' } },
      { path: '/employees/EMP-2.json', data: { code: 'EMP-2', name: 'Sipho Dube', jobTitle: 'Operations', manager: '/employees/EMP-1.json', status: 'active', state: 'active' } },
    ]
    const page = await render('employees', 'departments.page.yaml', { folders: { '/employees': people } })
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.find('.cv-c-org').text()).toContain('Karin Botha')
    expect(page.wrapper.find('.cv-c-org__level .cv-c-org__level').text()).toContain('Sipho Dube')
    page.wrapper.unmount()
  })

  it('knowledge: articles nest under their parents per space', async () => {
    const world = { folders: {
      '/knowledge-spaces': [{ path: '/knowledge-spaces/SPC-1.json', data: { code: 'SPC-1', name: 'Help centre', state: 'active' } }],
      '/articles': [
        { path: '/articles/ART-1.json', data: { code: 'ART-1', title: 'Getting started', space: '/knowledge-spaces/SPC-1.json', status: 'published', state: 'active' } },
        { path: '/articles/ART-2.json', data: { code: 'ART-2', title: 'Install', parent: '/articles/ART-1.json', space: '/knowledge-spaces/SPC-1.json', status: 'draft', state: 'active' } },
      ],
    } }
    const page = await render('knowledge', 'spaces.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.find('.cv-c-tree__heading').text()).toBe('Help centre')
    expect(page.wrapper.find('.cv-c-tree').text()).toContain('Install')
    page.wrapper.unmount()
  })

  it('quality: a measure check shows where the value sits in the tolerance band', async () => {
    const page = await render('quality', 'check.form.yaml', {
      record: { code: 'QC-1', status: 'pending', state: 'active', point: '/quality-control-points/CP-1.json', measuredValue: '5.12' },
      folders: { '/quality-control-points': [{ path: '/quality-control-points/CP-1.json', data: { title: 'Seed moisture', checkType: 'measure', toleranceMin: '4.90', toleranceMax: '5.10', state: 'active' } }] },
    })
    expect(page.renderErrors).toEqual([])
    const meter = page.wrapper.findComponent({ name: 'CvMeter' })
    expect(meter.exists()).toBe(true)
    expect(meter.props('tone')).toBe('danger')
    expect(page.wrapper.text()).toContain('Measured 5.12, outside tolerance by 0.02')
    page.wrapper.unmount()
  })

  it('timesheets: Validate week validates each draft entry of the week with hours', async () => {
    const world = { folders: {
      '/projects': [{ path: '/projects/PRJ-1.json', data: { code: 'PRJ-1', name: 'Fit-out', status: 'active', state: 'active' } }],
      '/timesheets': [
        { path: '/timesheets/TS-1.json', data: { code: 'TS-1', employee: 'Ana', project: '/projects/PRJ-1.json', date: day(0), hours: '4.00', status: 'draft', state: 'active' } },
        { path: '/timesheets/TS-2.json', data: { code: 'TS-2', employee: 'Ana', project: '/projects/PRJ-1.json', date: day(-1), hours: '3.00', status: 'validated', state: 'active' } },
        { path: '/timesheets/TS-3.json', data: { code: 'TS-3', project: '/projects/PRJ-1.json', date: day(-20), hours: '2.00', status: 'draft', state: 'active' } },
        { path: '/timesheets/TS-4.json', data: { code: 'TS-4', employee: 'Sipho', project: '/projects/PRJ-1.json', date: day(0), hours: '5.00', status: 'draft', state: 'active' } },
      ],
    } }
    const page = await render('timesheets', 'week.page.yaml', { ...world, files: { '/settings/timesheets.json': { employee: '' } } })
    expect(page.renderErrors).toEqual([])
    // Everyone's week until a person is picked; then only theirs.
    expect(page.wrapper.findAll('button').find(button => button.text().startsWith('Validate week'))!.text()).toBe('Validate week (2)')
    page.graph.write({ root: 'state', segments: ['employee'] } as never, 'Ana')
    await flushPromises()
    const validate = page.wrapper.findAll('button').find(button => button.text().startsWith('Validate week'))!
    expect(validate.text()).toBe('Validate week (1)')
    await validate.trigger('click')
    await flushPromises()
    const runs = (page.host.runScript as unknown as Mocked).mock.calls.map(call => call[0] as { parameters?: { operation?: string, path?: string } })
    expect(runs.map(run => [run.parameters?.operation, run.parameters?.path])).toEqual([['validate-entry', '/timesheets/TS-1.json']])
    page.wrapper.unmount()
  })

  it('timesheets: typing into a day changes its entry, or creates one through the create script', async () => {
    const world = { folders: {
      '/projects': [{ path: '/projects/PRJ-1.json', data: { code: 'PRJ-1', name: 'Fit-out', status: 'active', state: 'active' } }],
      '/timesheets': [
        { path: '/timesheets/TS-1.json', data: { code: 'TS-1', project: '/projects/PRJ-1.json', date: day(0), hours: '4.00', status: 'draft', state: 'active' } },
        { path: '/timesheets/TS-9.json', data: { code: 'TS-9', project: '', date: '', hours: '', status: 'draft', state: 'active' } },
      ],
    } }
    const page = await render('timesheets', 'week.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    const matrix = page.wrapper.findComponent({ name: 'CvMatrix' })
    expect(page.wrapper.find('.cv-c-matrix tbody').text()).toContain('Fit-out')
    const change = matrix.props('onChange') as (payload: unknown) => Promise<boolean>
    const records = (matrix.props('rows') as { path: string, date: string }[]).filter(row => row.path === '/timesheets/TS-1.json')
    expect(await change({ row: '/projects/PRJ-1.json', column: day(0), value: 6.5, previous: 4, records })).toBe(true)
    const writes = (page.host.writeFile as unknown as Mocked).mock.calls
    expect(writes[0]![0]).toBe('/timesheets/TS-1.json')
    expect(JSON.parse(writes[0]![1] as string)).toMatchObject({ hours: '6.50' })

    ;(page.host.runScript as unknown as Mocked).mockResolvedValueOnce({ path: '/timesheets/TS-9.json' })
    expect(await change({ row: '/projects/PRJ-1.json', column: day(-1), value: 2, previous: 0, records: [] })).toBe(true)
    const run = (page.host.runScript as unknown as Mocked).mock.calls.at(-1)![0] as { file: string, parameters: Record<string, unknown> }
    expect(run.file).toBe('/applications/timesheets/scripts/create')
    expect(run.parameters).toMatchObject({ operation: 'create', creatable: 'entry', parentPath: '/timesheets' })
    expect(JSON.parse(run.parameters.template as string)).toMatchObject({ kind: 'entry', id: '{{ id }}' })
    expect(JSON.parse(writes.at(-1)![1] as string)).toMatchObject({ code: 'TS-9', project: '/projects/PRJ-1.json', date: day(-1), hours: '2.00' })
    page.wrapper.unmount()
  })

  it('project: the board splits into lanes by assignee, and Add under a column creates a task there', async () => {
    const world = { folders: { '/tasks': [
      { path: '/tasks/TSK-1.json', data: { code: 'TSK-1', title: 'Order panels', stage: 'in-progress', assignee: 'Ana', state: 'active' } },
      { path: '/tasks/TSK-2.json', data: { code: 'TSK-2', title: 'Book crane', stage: 'backlog', assignee: 'Sipho', state: 'active' } },
    ] } }
    const page = await render('project', 'board.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.findAll('.cv-c-board-lanes__lane')).toHaveLength(0)
    page.graph.write({ root: 'state', segments: ['lanes'] } as never, 'data.assignee')
    await flushPromises()
    const lanes = page.wrapper.findAll('.cv-c-board-lanes__lane')
    expect(lanes.map(lane => lane.find('.cv-c-board-lanes__title').text())).toEqual(['Ana', 'Sipho'])
    ;(page.host.runScript as unknown as Mocked).mockResolvedValue({ result: { path: '/tasks/TSK-3.json' } } as never)
    await lanes[1]!.findAll('.cv-c-board__add')[1]!.trigger('click')
    await flushPromises()
    const run = (page.host.runScript as unknown as Mocked).mock.calls.at(-1)![0] as { parameters: { operation: string, creatable: string } }
    expect(run.parameters).toMatchObject({ operation: 'create', creatable: 'task' })
    page.wrapper.unmount()
  })

  it('project: dragging a task bar changes when it is due', async () => {
    const world = { folders: { '/tasks': [{ path: '/tasks/TSK-1.json', data: { code: 'TSK-1', title: 'Order panels', stage: 'in-progress', createdAt: `${day(-2)}T08:00:00Z`, dueDate: day(3), state: 'active' } }] } }
    const page = await render('project', 'board.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    const gantt = page.wrapper.findComponent({ name: 'CvGantt' })
    expect(page.wrapper.find('.cv-c-gantt__bar').text()).toBe('Order panels')
    expect(await (gantt.props('onReschedule') as (payload: unknown) => Promise<boolean>)({ path: '/tasks/TSK-1.json', start: day(-2), end: day(5) })).toBe(true)
    expect(JSON.parse((page.host.writeFile as unknown as Mocked).mock.calls.at(-1)![1] as string)).toMatchObject({ dueDate: day(5), createdAt: `${day(-2)}T08:00:00Z` })
    page.wrapper.unmount()
  })

  it('helpdesk: a drop on Solved asks for the resolution and hands it to Resolve', async () => {
    const world = { folders: { '/tickets': [{ path: '/tickets/TKT-1.json', data: { code: 'TKT-1', subject: 'Login', stage: 'in-progress', state: 'active', slaDeadline: soon(5) } }] } }
    const page = await render('helpdesk', 'tickets.page.yaml', world)
    ;(page.ui.confirm as unknown as Mocked).mockResolvedValueOnce({ values: { resolution: 'Reset the password' } })
    ;(page.host.runScript as unknown as Mocked).mockResolvedValueOnce({ message: 'TKT-1 resolved' })
    const board = page.wrapper.findComponent({ name: 'CvBoard' })
    expect(await (board.props('onMove') as (payload: unknown) => Promise<boolean>)({ row: world.folders['/tickets'][0], path: '/tickets/TKT-1.json', from: 'in-progress', to: 'solved' })).toBe(true)
    const asked = (page.ui.confirm as unknown as Mocked).mock.calls.at(-1)![0] as { fields: { key: string, required: boolean }[] }
    expect(asked.fields).toEqual([expect.objectContaining({ key: 'resolution', required: true })])
    expect(((page.host.runScript as unknown as Mocked).mock.calls.at(-1)![0] as { parameters: unknown }).parameters).toEqual({ operation: 'resolve', path: '/tickets/TKT-1.json', resolution: 'Reset the password' })
    page.wrapper.unmount()
  })

  it('helpdesk: the queue shows each open ticket’s SLA as time left', async () => {
    const world = { folders: { '/tickets': [
      { path: '/tickets/TKT-1.json', data: { code: 'TKT-1', subject: 'Late', stage: 'new', state: 'active', slaDeadline: soon(-3) } },
      { path: '/tickets/TKT-2.json', data: { code: 'TKT-2', subject: 'Done', stage: 'closed', state: 'active', slaDeadline: soon(-30) } },
    ] } }
    const page = await render('helpdesk', 'home.page.yaml', world)
    const pills = page.wrapper.findAll('.cv-c-countdown').map(pill => pill.text())
    expect(pills).toEqual(expect.arrayContaining(['Overdue 3h', 'Done']))
    page.wrapper.unmount()
  })
})

describe('record forms show the new work views', () => {
  it('sales quotation: the preview is the paper the customer gets, with estimated totals while drafting', async () => {
    const page = await render('sales', 'quotation.form.yaml', { record: {
      code: 'QUO-0003', state: 'active', status: 'draft', currency: 'ZAR', date: '2026-11-25', reference: 'Kitchen refit',
      customer: { name: 'Cedar Studio', legalName: 'Cedar Studio (Pty) Ltd', address: { lines: ['12 Bree Street'], city: 'Cape Town', postalCode: '8001', country: 'ZA' } },
      lines: [{ product: '', description: 'Workshop facilitation', quantity: '2', unitPrice: '450.00', discount: '10' }],
    } })
    expect(page.renderErrors).toEqual([])
    // The preview opens on demand.
    const preview = page.wrapper.findAll('.cv-c-card').find(card => card.text().startsWith('Preview'))!
    await preview.find('button').trigger('click')
    const paper = page.wrapper.find('.cv-c-doc__paper')
    expect(paper.find('.cv-c-doc__title').text()).toBe('Quotation QUO-0003')
    expect(paper.find('.cv-c-doc__party').text()).toContain('Cedar Studio (Pty) Ltd')
    expect(paper.find('.cv-c-doc__lines tbody').text()).toContain('810.00')
    expect(paper.find('.cv-c-doc__totals').text()).toContain('Total ZAR810.00')
    expect(paper.find('.cv-c-doc__stamp').text()).toBe('Draft')
    page.wrapper.unmount()
  })

  it('accounting period: the close checklist lists what is still open', async () => {
    const world = {
      record: { code: 'PER-2026-11', name: 'November 2026', startDate: '2026-11-01', endDate: '2026-11-30', status: 'open', state: 'active' },
      folders: {
        '/journals': [{ path: '/journals/JRN-7.json', data: { code: 'JRN-7', date: '2026-11-12', status: 'draft', state: 'active' } }],
        '/periods': [{ path: '/periods/PER-2026-10.json', data: { code: 'PER-2026-10', name: 'October 2026', startDate: '2026-10-01', endDate: '2026-10-31', status: 'closed', state: 'active' } }],
      },
    }
    const page = await render('accounting', 'period.form.yaml', world)
    expect(page.renderErrors).toEqual([])
    const checks = page.wrapper.findAll('.cv-c-checklist__item--check')
    expect(checks.map(check => check.classes().includes('cv-c-checklist__item--done'))).toEqual([false, true, true])
    expect(checks[0]!.text()).toContain('JRN-7')
    page.wrapper.unmount()
  })

  it('field service: the on-site checklist and the customer signature are on the task', async () => {
    const page = await render('field-service', 'task.form.yaml', { record: { code: 'FST-1', customerName: 'Harbour Cafe', stage: 'on-site', state: 'active', checklist: [], signature: '' } })
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.find('.cv-c-checklist').text()).toContain('Check the site is safe to work')
    expect(page.wrapper.find('.cv-c-checklist--touch').exists()).toBe(true)
    expect(page.wrapper.find('.cv-c-signature__signer').text()).toBe('Harbour Cafe')
    // Bound controls carry their field path, for the validation summary.
    expect(page.wrapper.find('[data-canvas-field="customerName"]').exists()).toBe(true)
    page.wrapper.unmount()
  })

  it('manufacturing: a confirmed order offers its BoM operations to tick and time', async () => {
    const world = {
      record: { code: 'MO-1', bom: '/bills-of-materials/BOM-1.json', productName: 'Oak shelf', quantity: '4', status: 'in-progress', state: 'active', operations: [] },
      folders: { '/bills-of-materials': [{ path: '/bills-of-materials/BOM-1.json', data: { code: 'BOM-1', productName: 'Oak shelf', state: 'active', routing: [{ operation: 'Cut', workcenter: 'Saw', minutes: '20' }, { operation: 'Edge band', workcenter: 'Bander', minutes: '15' }] } }] },
    }
    const page = await render('manufacturing', 'order.form.yaml', world)
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.findAll('.cv-c-checklist__label').map(label => label.text())).toEqual(['Cut · Saw', 'Edge band · Bander'])
    expect(page.wrapper.findAll('.cv-c-checklist__timer button').length).toBe(2)
    // In production the rest of the order is locked; a tick is written to the record straight away.
    await page.wrapper.find('.cv-c-checklist input[type="checkbox"]').setValue(true)
    await flushPromises()
    const [path, content] = (page.host.writeFile as unknown as { mock: { calls: [string, string][] } }).mock.calls.at(-1)!
    expect(path).toBe('/records/R-1.json')
    expect(JSON.parse(content).operations[0]).toMatchObject({ id: 'op-1', label: 'Cut · Saw', done: true })
    page.wrapper.unmount()
  })

  it('contract studio: the agreement reads as numbered points with its confirmed values', async () => {
    const page = await render('contract-studio', 'contract.form.yaml', { record: {
      kind: 'contract', version: 1, stage: 'draft', code: 'AGR-1', title: 'Services', state: 'active',
      points: [{ id: 'scope', origin: 'inline', wording: 'The work is {{ scope }}.', bindings: 'scope=a kitchen fit-out' }, { id: 'fees', origin: 'inline', wording: 'Fees follow {{ point:scope }}.' }],
    } })
    expect(page.renderErrors).toEqual([])
    const outline = page.wrapper.find('.cv-c-outline')
    expect(outline.findAll('.cv-c-outline__number').map(number => number.text())).toEqual(['1', '2'])
    expect(outline.text()).toContain('a kitchen fit-out')
    expect(outline.find('.cv-c-outline__ref').text()).toBe('point 1')
    await outline.findAll('.cv-c-outline__text--selectable')[1]!.trigger('click')
    await flushPromises()
    expect((page.graph.scope.state as Record<string, unknown>).pointId).toBe('fees')
    page.wrapper.unmount()
  })
})


describe('the remaining design views work with records', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  type Mocked = { mock: { calls: unknown[][] }, mockResolvedValueOnce: (value: unknown) => void }
  const writes = (host: unknown) => (host as { writeFile: Mocked }).writeFile.mock.calls

  it('manufacturing: a draft order shows each component needed against stock on hand', async () => {
    const page = await render('manufacturing', 'order.form.yaml', {
      record: { code: 'MO-1', status: 'draft', state: 'active', bom: '/bills-of-materials/BOM-1.json', quantity: '10' },
      folders: {
        '/bills-of-materials': [{ path: '/bills-of-materials/BOM-1.json', data: { productName: 'Seed mix', components: [{ product: '/products/P-1.json', name: 'Ryegrass', quantity: '2' }, { product: '/products/P-2.json', name: 'Clover', quantity: '0.5' }], state: 'active' } }],
        '/stock-moves': [
          { path: '/stock-moves/MV-1.json', data: { status: 'done', product: '/products/P-1.json', toWarehouse: '/warehouses/W-1.json', quantity: '12' } },
          { path: '/stock-moves/MV-2.json', data: { status: 'done', product: '/products/P-2.json', toWarehouse: '/warehouses/W-1.json', quantity: '9' } },
        ],
      },
    })
    expect(page.renderErrors).toEqual([])
    const text = page.wrapper.text()
    expect(text).toContain('Will it build?')
    expect(text).toContain('Ryegrass20.0012.008.00')
    expect(text).toContain('1 component(s) short')
    page.wrapper.unmount()
  })

  it('inventory: products at or below their reorder point are drafted into a purchase order by Purchase', async () => {
    const world = {
      folders: {
        '/products': [
          { path: '/products/P-1.json', data: { kind: 'product', code: 'P-1', name: 'Ryegrass 25 kg', sku: 'RYE-25', reorderPoint: '10', state: 'active' } },
          { path: '/products/P-2.json', data: { kind: 'product', code: 'P-2', name: 'Clover 10 kg', reorderPoint: '5', state: 'active' } },
        ],
        '/stock-moves': [
          { path: '/stock-moves/MV-1.json', data: { kind: 'move', status: 'done', product: '/products/P-1.json', toWarehouse: '/warehouses/W-1.json', quantity: '4', state: 'active' } },
          { path: '/stock-moves/MV-2.json', data: { kind: 'move', status: 'done', product: '/products/P-2.json', toWarehouse: '/warehouses/W-1.json', quantity: '20', state: 'active' } },
        ],
      },
      apps: [{ app: 'purchase', operation: 'create-draft-order', available: true }],
    }
    const page = await render('inventory', 'stock.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    ;(page.host.callApp as unknown as Mocked).mockResolvedValue({ result: { path: '/purchase-orders/PO-0004', code: 'PO-0004', created: true } } as never)
    const draft = page.wrapper.findAll('button').find(button => button.text().startsWith('Draft purchase order'))!
    expect(draft.text()).toBe('Draft purchase order (1)')
    await draft.trigger('click')
    await flushPromises()
    expect(page.errors).toEqual([])
    const call = (page.host.callApp as unknown as Mocked).mock.calls[0]![0] as { app: string, operation: string, input: { lines: unknown[] } }
    expect(call).toMatchObject({ app: 'purchase', operation: 'create-draft-order' })
    // Only the product at or below its reorder point, ordered up to twice it: 2 × 10 − 4 = 16.
    expect(call.input.lines).toEqual([{ description: 'Ryegrass 25 kg (RYE-25)', quantity: '16' }])
    expect((page.ui.openFile as unknown as Mocked).mock.calls.at(-1)![0]).toBe('/purchase-orders/PO-0004')
    page.wrapper.unmount()
  })

  it('sales: a product is added to the catalogue through Products, never written by Sales', async () => {
    const page = await render('sales', 'home.page.yaml', { apps: [{ app: 'products', operation: 'create-product', available: true }] })
    expect(page.renderErrors).toEqual([])
    ;(page.host.callApp as unknown as Mocked).mockResolvedValue({ result: { path: '/products/PRD-0004', code: 'PRD-0004', created: true, changed: [] } } as never)
    const add = () => page.wrapper.findAll('button').find(button => button.text() === 'Add product')!
    expect(add().attributes('disabled')).toBeDefined()
    page.graph.write({ root: 'state', segments: ['productname'] }, ' Standing desk ')
    page.graph.write({ root: 'state', segments: ['productprice'] }, '450')
    await flushPromises()
    await add().trigger('click')
    await flushPromises()
    expect(page.errors).toEqual([])
    const call = (page.host.callApp as unknown as Mocked).mock.calls[0]![0] as { app: string, operation: string, input: unknown }
    expect(call).toMatchObject({ app: 'products', operation: 'create-product', input: { name: 'Standing desk', unit: 'ea', listPrice: '450' } })
    expect(page.host.writeFile).not.toHaveBeenCalled()
    expect((page.ui.openFile as unknown as Mocked).mock.calls.at(-1)![0]).toBe('/products/PRD-0004')
    page.wrapper.unmount()
  })

  it('inventory: a reorder point is set through Products', async () => {
    const world = {
      folders: {
        '/products': [{ path: '/products/P-1.json', data: { kind: 'product', code: 'P-1', name: 'Ryegrass 25 kg', reorderPoint: '10', state: 'active' } }],
        '/stock-moves': [],
      },
      apps: [{ app: 'products', operation: 'update-product', available: true }],
    }
    const page = await render('inventory', 'stock.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    ;(page.host.callApp as unknown as Mocked).mockResolvedValue({ result: { path: '/products/P-1.json', code: 'P-1', changed: ['reorderPoint'] } } as never)
    page.graph.write({ root: 'state', segments: ['reorderproduct'] }, '/products/P-1.json')
    page.graph.write({ root: 'state', segments: ['reorderpoint'] }, '12')
    await flushPromises()
    await page.wrapper.findAll('button').find(button => button.text() === 'Set reorder point')!.trigger('click')
    await flushPromises()
    expect(page.errors).toEqual([])
    const call = (page.host.callApp as unknown as Mocked).mock.calls[0]![0] as { app: string, operation: string, input: unknown }
    expect(call).toMatchObject({ app: 'products', operation: 'update-product', input: { path: '/products/P-1.json', values: { reorderPoint: '12' } } })
    page.wrapper.unmount()
  })

  it('inventory: a move shows what is on hand at both ends and warns when it takes more than there is', async () => {
    const page = await render('inventory', 'move.form.yaml', {
      record: { code: 'MV-3', kind: 'move', status: 'draft', state: 'active', product: '/products/P-1.json', fromWarehouse: '/warehouses/W-1.json', toWarehouse: '/warehouses/W-2.json', quantity: '8' },
      folders: {
        '/products': [{ path: '/products/P-1.json', data: { kind: 'product', name: 'Ryegrass 25 kg', state: 'active' } }],
        '/warehouses': [{ path: '/warehouses/W-1.json', data: { kind: 'warehouse', name: 'Main', state: 'active' } }, { path: '/warehouses/W-2.json', data: { kind: 'warehouse', name: 'Branch', state: 'active' } }],
        '/stock-moves': [
          { path: '/stock-moves/MV-1.json', data: { kind: 'move', status: 'done', product: '/products/P-1.json', toWarehouse: '/warehouses/W-1.json', quantity: '5', state: 'active' } },
          { path: '/stock-moves/MV-2.json', data: { kind: 'move', status: 'done', product: '/products/P-1.json', toWarehouse: '/warehouses/W-2.json', quantity: '2', state: 'active' } },
        ],
      },
    })
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.text()).toContain('From Main: 5 on hand → to Branch: 2 on hand')
    expect(page.wrapper.text()).toContain('Only 5 on hand at the source')
    page.wrapper.unmount()
  })

  it('crm: a company’s timeline lists its emails, calls and notes by date', async () => {
    const crm = (kind: string) => `application/vnd.verentis.crm.${kind}+json`
    const page = await render('crm', 'company.form.yaml', {
      record: { code: 'CUS-1', name: 'Cedar Studio', state: 'active' },
      folders: {
        '/records/R-1.json/activities': [
          { path: '/records/R-1.json/activities/EM-1.json', mimeType: crm('email'), data: { subject: 'Quote follow-up', sentAt: '2026-11-20T09:00:00Z', status: 'sent', state: 'active' } },
          { path: '/records/R-1.json/activities/CA-1.json', mimeType: crm('call'), data: { subject: 'Intro call', startsAt: '2026-11-18T10:00:00Z', status: 'held', state: 'active' } },
        ],
        '/records/R-1.json/notes': [{ path: '/records/R-1.json/notes/NO-1.json', mimeType: crm('note'), data: { title: 'Prefers email', updatedAt: '2026-11-19T08:00:00Z', state: 'active' } }],
      },
    })
    expect(page.renderErrors).toEqual([])
    await page.wrapper.findAll('[role="tab"], button').find(node => node.text().trim() === 'Timeline')!.trigger('click')
    await flushPromises()
    const timeline = page.wrapper.findComponent({ name: 'CvTimeline' })
    expect(timeline.exists()).toBe(true)
    const text = timeline.text()
    expect(text).toContain('Quote follow-up')
    expect(text).toContain('Intro call')
    expect(text).toContain('Prefers email')
    expect(page.wrapper.findComponent({ name: 'CvValidationSummary' }).exists()).toBe(true)
    page.wrapper.unmount()
  })

  it('time off: a request warns who else is off and shows the days left of its leave type', async () => {
    const page = await render('time-off', 'request.form.yaml', {
      record: { code: 'LV-3', status: 'draft', state: 'active', employeeName: 'Ana', type: '/leave-types/annual.json', startDate: '2026-12-21', endDate: '2026-12-24' },
      folders: {
        '/leave-types': [{ path: '/leave-types/annual.json', data: { name: 'Annual', daysPerYear: '15', state: 'active' } }],
        '/leave-requests': [
          { path: '/leave-requests/LV-1.json', data: { employeeName: 'Sipho', status: 'approved', startDate: '2026-12-23', endDate: '2027-01-02', type: '/leave-types/annual.json', days: '6' } },
          { path: '/leave-requests/LV-2.json', data: { employeeName: 'Ana', status: 'approved', startDate: '2026-03-02', endDate: '2026-03-06', type: '/leave-types/annual.json', days: '5' } },
        ],
      },
    })
    expect(page.renderErrors).toEqual([])
    const alert = page.wrapper.findAll('[data-slot="canvas-alert"], .cv-c-alert').find(node => node.text().includes('Others are off'))
    expect(alert?.text()).toContain('Sipho (2026-12-23 to 2027-01-02)')
    expect(page.wrapper.text()).toContain('5 of 15 days of this leave type taken this year; 10 left before this request.')
    page.wrapper.unmount()
  })

  it('sales quotation: Confirm runs the confirm script once; the script has Invoicing draft the invoice', async () => {
    const page = await render('sales', 'quotation.form.yaml', {
      record: { code: 'QUO-0009', state: 'active', status: 'sent', currency: 'ZAR', date: '2026-11-25', customer: { name: 'Cedar Studio' },
        lines: [{ product: '', description: 'Workshop', quantity: '1', unitPrice: '450.00', discount: '' }] },
      apps: [{ app: 'invoicing', operation: 'create-draft-invoice', available: true }],
    })
    expect(page.renderErrors).toEqual([])
    ;(page.host.runScript as unknown as Mocked).mockResolvedValue({ message: 'Drafted invoice INV-0011 for QUO-0009', path: '/invoices/INV-0011' } as never)
    ;(page.ui.confirm as unknown as Mocked).mockResolvedValue({ values: { prices: true, delivery: true, po: false } } as never)
    await page.wrapper.findAll('button').find(button => button.text() === 'Confirm')!.trigger('click')
    await flushPromises()
    expect(page.errors).toEqual([])
    const runs = (page.host.runScript as unknown as Mocked).mock.calls.map(call => (call[0] as { parameters: Record<string, string> }).parameters.operation)
    expect(runs).toEqual(['confirm-quotation'])
    expect(page.host.callApp).not.toHaveBeenCalled()
    page.wrapper.unmount()
  })

  it('sales quotation: without Invoicing, Confirm only confirms and the page says how to get invoices', async () => {
    const page = await render('sales', 'quotation.form.yaml', {
      record: { code: 'QUO-0010', state: 'active', status: 'confirmed', currency: 'ZAR', customer: { name: 'Cedar Studio' }, lines: [] },
    })
    expect(page.wrapper.text()).toContain('Install Invoicing to draft an invoice from a confirmed quotation.')
    expect(page.wrapper.findAll('button').some(button => button.text() === 'Draft invoice')).toBe(false)
    page.wrapper.unmount()
  })

  it('sales quotation: Save PDF writes the paper to the record’s documents', async () => {
    const page = await render('sales', 'quotation.form.yaml', { record: {
      code: 'QUO-0004', state: 'active', status: 'draft', currency: 'ZAR', date: '2026-11-25',
      customer: { name: 'Cedar Studio', address: { lines: ['12 Bree Street'], city: 'Cape Town', country: 'ZA' } },
      lines: [{ product: '', description: 'Workshop facilitation', quantity: '2', unitPrice: '450.00', discount: '0' }],
    } })
    expect(page.renderErrors).toEqual([])
    await page.wrapper.findAll('button').find(button => button.text().includes('Save PDF'))!.trigger('click')
    await flushPromises()
    expect(page.errors).toEqual([])
    const [path, bytes, mime] = (page.host.writeFile as unknown as Mocked).mock.calls.at(-1)! as [string, Uint8Array, string]
    expect(path).toBe('/records/R-1.json/documents/QUO-0004.pdf')
    expect(mime).toBe('application/pdf')
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text).toContain('Quotation QUO-0004')
    expect(text).toContain('Workshop facilitation')
    page.wrapper.unmount()
  })

  it('invoicing: Issue shows the journal it will post; a payment allocates to the payer’s oldest invoices first', async () => {
    const invoice = await render('invoicing', 'invoice.form.yaml', {
      record: { code: 'INV-9', status: 'draft', state: 'active', currency: 'ZAR', lines: [{ description: 'Work', quantity: '2', unitPrice: '100.00', taxRate: '15' }] },
      files: { '/settings/invoicing.json': { receivableAccount: '/chart-of-accounts/AR.json', incomeAccount: '/chart-of-accounts/SALES.json', taxAccount: '/chart-of-accounts/VAT.json' } },
      folders: { '/chart-of-accounts': [
        { path: '/chart-of-accounts/AR.json', data: { name: 'Receivables', state: 'active' } }, { path: '/chart-of-accounts/SALES.json', data: { name: 'Sales', state: 'active' } }, { path: '/chart-of-accounts/VAT.json', data: { name: 'VAT', state: 'active' } },
      ] },
      // Issuing needs Accounting: without it the form asks nothing and does nothing.
      apps: [{ app: 'accounting', operation: 'post-journal', available: true }],
    })
    expect(invoice.renderErrors).toEqual([])
    const issue = invoice.wrapper.findAll('button').find(button => button.text().includes('Issue'))
    if (issue) {
      await issue.trigger('click')
      await flushPromises()
      const asked = (invoice.ui.confirm as unknown as Mocked).mock.calls.at(-1)?.[0] as { details?: { label: string, value: string }[] } | undefined
      expect(asked?.details).toEqual([
        { label: 'Debit Receivables', value: '230.00' }, { label: 'Credit Sales', value: '200.00' }, { label: 'Credit VAT', value: '30.00' },
      ])
    }
    invoice.wrapper.unmount()

    const issued = (code: string, due: string, gross: string) => ({ path: `/invoices/${code}.json`, data: { code, status: 'issued', state: 'active', currency: 'ZAR', dueDate: due, customer: { name: 'Cedar Studio' }, totals: { gross } } })
    const payment = await render('invoicing', 'payment.form.yaml', {
      record: { code: 'PAY-1', status: 'draft', state: 'active', currency: 'ZAR', payer: 'cedar studio', amount: '150.00', allocations: [] },
      folders: { '/invoices': [issued('INV-2', '2026-11-20', '100.00'), issued('INV-1', '2026-10-01', '80.00'), issued('INV-3', '2026-12-01', '500.00')] },
    })
    expect(payment.renderErrors).toEqual([])
    await payment.wrapper.findAll('button').find(button => button.text() === 'Allocate oldest first')!.trigger('click')
    await flushPromises()
    expect((payment.graph.scope.form as { values: { allocations: unknown[] } }).values.allocations).toEqual([
      { invoice: '/invoices/INV-1.json', amount: '80.00' }, { invoice: '/invoices/INV-2.json', amount: '70.00' },
    ])
    payment.wrapper.unmount()
  })

  it('spreadsheet BI: the builder reads the source’s fields, previews the tile and adds it to the dashboard', async () => {
    const page = await render('spreadsheet-bi', 'dashboard.form.yaml', {
      record: { code: 'BID-1', name: 'Sales', state: 'active', tiles: [{ sequence: '1', title: 'Count', source: '/tickets', kind: 'count', valueField: '', groupByField: '', filter: { field: '', equals: '' } }] },
      folders: { '/tickets': [
        { path: '/tickets/T1.json', data: { code: 'T1', stage: 'new', hours: '2', state: 'active' } },
        { path: '/tickets/T2.json', data: { code: 'T2', stage: 'new', hours: '3', state: 'active' } },
        { path: '/tickets/T3.json', data: { code: 'T3', stage: 'closed', hours: '1', state: 'active' } },
      ] },
    })
    expect(page.renderErrors).toEqual([])
    await page.wrapper.findAll('button').find(button => button.text() === 'Add tile')!.trigger('click')
    await flushPromises()
    expect(page.wrapper.find('.cv-c-dialog--side').exists()).toBe(true)
    const write = (key: string, value: unknown) => page.graph.write({ root: 'state', segments: ['draft', key] } as never, value)
    write('source', '/tickets'); write('kind', 'group-sum'); write('groupByField', 'stage'); write('valueField', 'hours'); write('title', 'Hours by stage')
    // The field pickers list the source's own fields; the value picker only the numeric ones.
    page.graph.write({ root: 'state', segments: ['step'] } as never, 'show')
    await flushPromises()
    const fields = (page.wrapper.find('.cv-c-dialog').findAllComponents({ name: 'CvSelect' }) as unknown as { props: (key: string) => unknown }[])
      .map(control => [control.props('label'), (control.props('options') as { value: string }[]).map(option => option.value)])
    expect(Object.fromEntries(fields)).toMatchObject({ 'Group by': ['code', 'hours', 'stage'], 'Value to add up': ['hours'] })
    page.graph.write({ root: 'state', segments: ['step'] } as never, 'check')
    await flushPromises()
    // The preview groups the live records: hours per stage.
    const chart = page.wrapper.find('.cv-c-dialog').findComponent({ name: 'CvChart' })
    expect(chart.props('rows')).toEqual([{ label: 'new', value: 5 }, { label: 'closed', value: 1 }])
    await page.wrapper.findAll('.cv-c-wizard__footer button').find(button => button.text() === 'Add tile')!.trigger('click')
    await flushPromises()
    const tiles = (page.graph.scope.form as { values: { tiles: { sequence: string, title: string, kind: string, groupByField: string }[] } }).values.tiles
    expect(tiles.at(-1)).toMatchObject({ sequence: '2', title: 'Hours by stage', kind: 'group-sum', groupByField: 'stage', valueField: 'hours', source: '/tickets' })
    page.wrapper.unmount()
  })

  it('field service: tasks with a location appear on the map', async () => {
    const world = { folders: { '/field-tasks': [
      { path: '/field-tasks/FST-1.json', data: { code: 'FST-1', customerName: 'Harbour Cafe', stage: 'scheduled', latitude: '-33.9249', longitude: '18.4241', technician: 'Pieter', state: 'active' } },
      { path: '/field-tasks/FST-2.json', data: { code: 'FST-2', customerName: 'Cedar', stage: 'new', latitude: '', longitude: '', state: 'active' } },
    ] } }
    const page = await render('field-service', 'home.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    const map = page.wrapper.findComponent({ name: 'CvMap' })
    expect(((map.props('layers') as { rows: unknown[] }[])[0]!.rows)).toEqual([expect.objectContaining({ lat: -33.9249, lng: 18.4241, technician: 'Pieter' })])
    expect(page.wrapper.text()).toContain('1 open tasks have no location yet')
    page.wrapper.unmount()
  })

  it('employees: the profile shows the person’s records from other installed apps', async () => {
    const page = await render('employees', 'employee.form.yaml', {
      record: { code: 'EMP-1', name: 'Thandi Khumalo', status: 'active', state: 'active' },
      folders: { '/leave-requests': [{ path: '/leave-requests/LR-1.json', data: { code: 'LR-1', employee: 'thandi khumalo', type: 'Annual', startDate: '2026-12-01', endDate: '2026-12-05', status: 'approved', state: 'active' } }] },
    })
    expect(page.renderErrors).toEqual([])
    const leave = page.wrapper.findAll('.cv-c-card').find(card => card.text().startsWith('Time off'))!
    expect(leave.text()).toContain('Annual')
    page.wrapper.unmount()
  })

  it('events: the door finds a confirmed attendee and checks them in', async () => {
    const world = { folders: { '/event-registrations': [
      { path: '/event-registrations/REG-1.json', data: { code: 'REG-1', attendeeName: 'Ana Petersen', status: 'confirmed', qty: 1, event: '', state: 'active' } },
    ] } }
    const page = await render('events', 'registrations.page.yaml', world)
    expect(page.renderErrors).toEqual([])
    page.graph.write({ root: 'state', segments: ['door'] } as never, 'ana')
    await flushPromises()
    await page.wrapper.findAll('button').find(button => button.text() === 'Check in')!.trigger('click')
    await flushPromises()
    expect(((page.host.runScript as unknown as Mocked).mock.calls.at(-1)![0] as { parameters: unknown }).parameters).toEqual({ operation: 'check-in', path: '/event-registrations/REG-1.json' })
    expect((page.graph.scope.state as Record<string, unknown>).door).toBe('')
    page.wrapper.unmount()
  })

  it('purchase: counting a line on a confirmed order writes it to the order', async () => {
    const page = await render('purchase', 'order.form.yaml', { record: { code: 'PO-1', status: 'confirmed', state: 'active', lines: [{ description: 'Edge banding', quantity: '12', unitPrice: '40.00' }] } })
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.find('.cv-c-counter__target').text()).toBe('12 short of 12')
    await page.wrapper.findAll('.cv-c-counter button').find(button => button.attributes('aria-label') === 'More')!.trigger('click')
    await flushPromises()
    expect(JSON.parse(writes(page.host).at(-1)![1] as string).lines[0]).toMatchObject({ description: 'Edge banding', received: '1' })
    page.wrapper.unmount()
  })

  it('planning: Publish week checks the drafts and publishes the clean ones one by one', async () => {
    const shift = (code: string, employee: string, start: string, end: string) => ({ path: `/shifts/${code}.json`, data: { code, employee, role: '/shift-roles/R1.json', date: day(1), startTime: start, endTime: end, status: 'draft', state: 'active' } })
    const page = await render('planning', 'shifts.page.yaml', { folders: {
      '/shifts': [shift('S1', 'Karin', '08:00', '12:00'), shift('S2', 'Karin', '11:00', '15:00'), shift('S3', 'Sipho', '09:00', '13:00')],
      '/shift-roles': [{ path: '/shift-roles/R1.json', data: { code: 'R1', name: 'Front desk', state: 'active' } }],
    } })
    expect(page.renderErrors).toEqual([])
    ;(page.ui.preflight as unknown as Mocked).mockResolvedValueOnce('ready')
    await page.wrapper.findAll('button').find(button => button.text() === 'Publish week')!.trigger('click')
    await flushPromises()
    const checked = (page.ui.preflight as unknown as Mocked).mock.calls.at(-1)![0] as { items: { status: string, message?: string }[] }
    expect(checked.items.map(item => item.status)).toEqual(['failed', 'failed', 'ready'])
    expect(checked.items[0]!.message).toContain('Overlaps S2')
    const runs = (page.host.runScript as unknown as Mocked).mock.calls.map(call => (call[0] as { parameters: { path: string } }).parameters.path)
    expect(runs).toEqual(['/shifts/S3.json'])
    page.wrapper.unmount()
  })

  it('social marketing: the post counter follows the account’s network', async () => {
    const page = await render('social-marketing', 'post.form.yaml', {
      record: { code: 'SOP-1', status: 'draft', state: 'active', account: '/social-accounts/X.json', content: 'x'.repeat(290) },
      folders: { '/social-accounts': [{ path: '/social-accounts/X.json', data: { code: 'SOA-1', handle: '@verentis', network: 'x', state: 'active' } }] },
    })
    expect(page.renderErrors).toEqual([])
    expect(page.wrapper.find('.cv-c-textarea-limit__count').text()).toBe('10 over the 280 limit')
    page.wrapper.unmount()
  })

  it('approvals: the request shows its decision trail', async () => {
    const page = await render('approvals', 'request.form.yaml', { record: {
      code: 'REQ-1', title: 'Laptop', status: 'approved', state: 'active', requester: 'Ana', submittedAt: '2026-11-20T08:00:00Z', decidedAt: '2026-11-21T09:00:00Z',
      approvals: [{ approver: 'Karin', date: '2026-11-21T09:00:00Z', decision: 'approve', comment: 'Within budget' }],
    } })
    expect(page.renderErrors).toEqual([])
    const trail = page.wrapper.find('.cv-c-timeline')
    expect(trail.text()).toContain('Submitted for approval')
    expect(trail.text()).toContain('Within budget')
    expect(trail.text()).toContain('Approved')
    page.wrapper.unmount()
  })

  it('surveys: the survey previews its questions, and a response is answered with the same controls', async () => {
    const questions = [{ sequence: 1, text: 'How was it?', kind: 'rating', choices: [], required: true }, { sequence: 2, text: 'What stood out?', kind: 'multi-choice', choices: ['Food', 'Service'], required: false }]
    const survey = await render('surveys', 'survey.form.yaml', { record: { code: 'SUR-1', title: 'Visit', status: 'draft', state: 'active', questions } })
    expect(survey.renderErrors).toEqual([])
    expect(survey.wrapper.find('.cv-c-dynamic').text()).toContain('1. How was it?')
    survey.wrapper.unmount()

    const response = await render('surveys', 'response.form.yaml', {
      record: { code: 'RES-1', survey: '/surveys/SUR-1.json', status: 'draft', state: 'active', answers: [{ sequence: 1, value: '4', values: [] }] },
      folders: { '/surveys': [{ path: '/surveys/SUR-1.json', data: { code: 'SUR-1', title: 'Visit', status: 'open', state: 'active', questions } }] },
    })
    expect(response.renderErrors).toEqual([])
    expect(response.wrapper.find('.cv-c-dynamic__score--on').text()).toBe('4')
    await response.wrapper.findAll('.cv-c-dynamic input[type="checkbox"]')[1]!.setValue(true)
    await flushPromises()
    expect((response.graph.scope.form as { values: { answers: unknown[] } }).values.answers).toEqual([
      { sequence: 1, value: '4', values: [] }, { sequence: 2, value: '', values: ['Service'] },
    ])
    response.wrapper.unmount()
  })

  it('sales: the customer address and phone are one control each, stored in the record’s shape', async () => {
    const page = await render('sales', 'quotation.form.yaml', { record: { code: 'QUO-1', status: 'draft', state: 'active', customer: { name: 'Cedar', phone: '', address: { lines: [], city: '', region: '', postalCode: '', country: 'ZA' } }, lines: [] } })
    expect(page.renderErrors).toEqual([])
    const phone = page.wrapper.findComponent({ name: 'CvPhone' })
    expect(phone.props('defaultCode')).toBe('+27')
    await phone.find('input').setValue('082 555 0123')
    await phone.find('input').trigger('change')
    await flushPromises()
    expect((page.graph.scope.form as { values: { customer: { phone: string } } }).values.customer.phone).toBe('+27825550123')
    await page.wrapper.findComponent({ name: 'CvAddress' }).findAll('input')[0]!.setValue('Cape Town')
    expect((page.graph.scope.form as { values: { customer: { address: { city: string, country: string } } } }).values.customer.address).toMatchObject({ city: 'Cape Town', country: 'ZA' })
    page.wrapper.unmount()
  })
})

describe('every form renders with a filled record of its kind', () => {
  for (const pkg of packages) {
    it(pkg, async () => {
      const contracts = await import(/* @vite-ignore */ `${PACKAGES}/${pkg}/src/contracts.mjs`).catch(() => null)
      const world = await seeded(pkg)
      if (!contracts?.templates || !world) return
      for (const file of readdirSync(`${PACKAGES}/${pkg}/canvas`).filter(name => name.endsWith('.form.yaml'))) {
        const kind = file.replace('.form.yaml', '')
        if (!contracts.templates[kind]) continue
        // The record a user would have open: the kind's template, filled as the seeded folders fill theirs.
        const record: Record<string, unknown> = { ...contracts.templates[kind], code: `${kind.toUpperCase()}-1`, state: 'active' }
        for (const [key, value] of Object.entries(record)) {
          if (typeof value === 'string' && value.includes('{{')) record[key] = /date|At$|deadline/i.test(key) ? today : 'Sample'
          else if (value === '' && /date|deadline/i.test(key)) record[key] = today
        }
        const { wrapper, errors, renderErrors } = await render(pkg, file, { ...world, record })
        expect(renderErrors, `${pkg}/${file}`).toEqual([])
        expect(errors.filter(message => !absent(message)), `${pkg}/${file}`).toEqual([])
        wrapper.unmount()
      }
    })
  }
})

describe('cross-app steps run in the app script: the page runs one step and calls no app', () => {
  // [package, form, action, script operation, issued copy saved afterwards]
  const actions: [pkg: string, file: string, action: string, operation: string, copy: boolean][] = [
    ['invoicing', 'invoice.form.yaml', 'issue', 'issue-invoice', true],
    ['invoicing', 'credit.form.yaml', 'issue', 'issue-credit', true],
    ['invoicing', 'payment.form.yaml', 'post', 'post-payment', false],
    ['invoicing', 'payment.form.yaml', 'reverse', 'reverse-payment', false],
    ['expenses', 'report.form.yaml', 'post', 'post-report', false],
    ['payroll', 'payrun.form.yaml', 'post', 'post-run', false],
    ['field-service', 'task.form.yaml', 'complete', 'complete', false],
    ['manufacturing', 'order.form.yaml', 'complete', 'complete-mo', false],
    ['purchase', 'order.form.yaml', 'receive', 'receive-order', false],
    ['rental', 'booking.form.yaml', 'return', 'return-booking', false],
  ]
  const record = { code: 'DOC-1', state: 'active', status: 'draft', lines: [], customer: { name: 'Cedar' }, totals: {} }
  const scripts = (page: Awaited<ReturnType<typeof render>>) => (page.host.runScript as unknown as Mocked).mock.calls.map(call => (call[0] as { parameters: { operation: string } }).parameters.operation)
  const pdfs = (page: Awaited<ReturnType<typeof render>>) => (page.host.writeFile as unknown as Mocked).mock.calls.filter(call => String(call[0]).endsWith('.pdf'))
  const toasts = (page: Awaited<ReturnType<typeof render>>) => (page.ui.toast as unknown as Mocked).mock.calls.map(call => [call[1], String(call[0])])
  const run = (page: Awaited<ReturnType<typeof render>>, action: string) => page.engine.dispatch(action, undefined, page.graph.scope as Record<string, unknown>)

  for (const [pkg, file, action, operation, copy] of actions) {
    const name = `${pkg} ${file.replace('.form.yaml', '')} ${action}`

    it(`${name}: one script run does the whole step`, async () => {
      const page = await render(pkg, file, { record })
      ;(page.host.runScript as unknown as Mocked).mockResolvedValue({ message: 'Done in one run', path: '/records/R-1.json' } as never)
      expect(await run(page, action)).toBe(true)
      expect(scripts(page)).toEqual([operation])
      expect(page.host.callApp).not.toHaveBeenCalled()
      expect(toasts(page).at(copy ? -2 : -1)).toEqual(['success', 'Done in one run'])
      expect(pdfs(page)).toHaveLength(copy ? 1 : 0)
      page.wrapper.unmount()
    })

    it(`${name}: when the script fails (the other app refused) nothing is marked done and no copy is saved`, async () => {
      const page = await render(pkg, file, { record })
      ;(page.host.runScript as unknown as Mocked).mockRejectedValue(new Error('Accounting is not available right now, so nothing was done.'))
      expect(await run(page, action)).toBe(false)
      expect(pdfs(page)).toEqual([])
      expect(toasts(page).filter(([variant]) => variant === 'success')).toEqual([])
      expect(page.errors.join(' ')).toContain('nothing was done')
      page.wrapper.unmount()
    })
  }
})

describe('the designed list pages show the right records', () => {
  const past = new Date(Date.now() - 3_600_000).toISOString()
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const rowsOf = (page: Awaited<ReturnType<typeof render>>) => {
    let rows: any[] = []
    page.wrapper.findAllComponents({ name: 'CvTable' }).forEach(table => { rows = rows.concat((table.props('rows') as any[]) || []) })
    return rows
  }
  it('helpdesk queues: unassigned, overdue, waiting and solved', async () => {
    const ticket = (code: string, stage: string, extra: object = {}) => ({ path: `/tickets/${code}`, data: { code, subject: `Ticket ${code}`, stage, priority: 'normal', state: 'active', ...extra } })
    const world = { folders: { '/tickets': [ticket('T1', 'new'), ticket('T2', 'in-progress', { assignee: 'Thandi', slaDeadline: past }), ticket('T3', 'waiting', { assignee: 'Ben', slaDeadline: future }), ticket('T4', 'solved', { assignee: 'Ben' })] } }
    const expected: Record<string, string[]> = { 'unassigned.page.yaml': ['T1'], 'overdue.page.yaml': ['T2'], 'waiting.page.yaml': ['T3'], 'solved.page.yaml': ['T4'] }
    for (const [file, codes] of Object.entries(expected)) {
      const page = await render('helpdesk', file, world)
      expect(page.renderErrors, file).toEqual([])
      expect(rowsOf(page).map(row => row.code), file).toEqual(codes)
      page.wrapper.unmount()
    }
  })

  it('time off: to approve shows who else is off at the same time', async () => {
    const request = (code: string, name: string, status: string, from: string, to: string) => ({ path: `/leave-requests/${code}`, data: { code, employeeName: name, status, startDate: from, endDate: to, days: 1, state: 'active' } })
    const page = await render('time-off', 'to-approve.page.yaml', { folders: { '/leave-requests': [
      request('R1', 'Ana', 'submitted', '2026-12-01', '2026-12-05'), request('R2', 'Ben', 'approved', '2026-12-04', '2026-12-08'), request('R3', 'Cy', 'approved', '2027-01-01', '2027-01-02')] } })
    expect(page.renderErrors).toEqual([])
    expect(rowsOf(page)).toEqual([expect.objectContaining({ code: 'R1', clash: 'Ben' })])
    page.wrapper.unmount()
  })

  it('manufacturing: the operation queue puts running before next before waiting, with the workcenter from the BoM', async () => {
    const page = await render('manufacturing', 'queue.page.yaml', { folders: {
      '/bills-of-materials': [{ path: '/bills-of-materials/B1', data: { code: 'B1', state: 'active', routing: [{ operation: 'Cut', workcenter: 'Saw' }, { operation: 'Glue', workcenter: 'Bench' }, { operation: 'Pack', workcenter: 'Dock' }] } }],
      '/manufacturing-orders': [{ path: '/manufacturing-orders/MO1', data: { code: 'MO1', status: 'in-progress', state: 'active', bom: '/bills-of-materials/B1', productName: 'Desk',
        operations: [{ label: 'Cut', done: true }, { label: 'Glue', startedAt: past }, { label: 'Pack' }] } }] } })
    expect(page.renderErrors).toEqual([])
    expect(rowsOf(page).map(row => [row.state, row.operation, row.workcenter])).toEqual([['Running', 'Glue', 'Bench'], ['Waiting', 'Pack', 'Dock']])
    page.wrapper.unmount()
  })
})

describe('"My" pages find the signed-in user', () => {
  const rowsOf = (page: Awaited<ReturnType<typeof render>>) => {
    let rows: any[] = []
    page.wrapper.findAllComponents({ name: 'CvTable' }).forEach(table => { rows = rows.concat((table.props('rows') as any[]) || []) })
    return rows
  }
  const staff = { '/employees': [{ path: '/employees/EMP-0001', data: { code: 'EMP-0001', name: 'Thandi Mokoena', workEmail: 'Thandi@Example.com', status: 'active', state: 'active' } }] }
  const request = (code: string, name: string, ref = '') => ({ path: `/leave-requests/${code}`, data: { code, employeeName: name, employeeRef: ref, status: 'submitted', startDate: '2026-12-01', endDate: '2026-12-02', state: 'active' } })
  const requests = [request('R1', 'T. Mokoena', '/employees/EMP-0001'), request('R2', 'thandi mokoena'), request('R3', 'tm'), request('R4', 'Ben Smith')]

  it('by their Employees record (work email) or by their employee or sign-in name', async () => {
    const page = await render('time-off', 'mine.page.yaml', { folders: { ...staff, '/leave-requests': requests }, user: { id: 'u-1', name: 'tm', email: 'thandi@example.com' } })
    expect(page.renderErrors).toEqual([])
    expect(rowsOf(page).map(row => row.code).sort()).toEqual(['R1', 'R2', 'R3'])
    page.wrapper.unmount()
  })

  it('by sign-in name alone when there is no email or Employees record, and nothing when nobody is signed in', async () => {
    const named = await render('time-off', 'mine.page.yaml', { folders: { '/leave-requests': requests }, user: { id: 'u-1', name: 'Ben Smith' } })
    expect(rowsOf(named).map(row => row.code)).toEqual(['R4'])
    named.wrapper.unmount()
    const nobody = await render('time-off', 'mine.page.yaml', { folders: { '/leave-requests': requests } })
    expect(rowsOf(nobody)).toEqual([])
    nobody.wrapper.unmount()
  })

  it('the timesheet week grid shows the signed-in employee before the settings default', async () => {
    const entry = (code: string, employee: string) => ({ path: `/timesheets/${code}`, data: { code, employee, date: new Date().toISOString().slice(0, 10), project: '', hours: '1', status: 'draft', state: 'active' } })
    const page = await render('timesheets', 'week.page.yaml', { folders: { ...staff, '/timesheets': [entry('E1', 'Thandi Mokoena'), entry('E2', 'Default Person')] },
      files: { '/settings/timesheets.json': { employee: 'Default Person' } }, user: { id: 'u-1', name: 'tm', email: 'thandi@example.com' } })
    expect(page.renderErrors).toEqual([])
    const picker = page.wrapper.findAllComponents({ name: 'CvSelect' }).find(select => select.props('label') === 'Employee')!
    expect(picker.props('value')).toBe('Thandi Mokoena')
    page.wrapper.unmount()
  })
})

describe('people link to their Employees record', () => {
  const staff = { '/employees': [
    { path: '/employees/EMP-0001', data: { code: 'EMP-0001', name: 'Thandi Mokoena', jobTitle: 'Engineer', workEmail: 'thandi@example.com', status: 'active', state: 'active' } },
    { path: '/employees/EMP-0002', data: { code: 'EMP-0002', name: 'Gone Person', status: 'terminated', state: 'active' } }] }
  const user = { id: 'u-1', name: 'tm', email: 'thandi@example.com' }

  it('timesheet entry: picking an employee fills the name, and "This is me" links the signed-in user', async () => {
    const page = await render('timesheets', 'entry.form.yaml', { record: { ...JSON.parse(JSON.stringify({ code: 'TS-1', kind: 'entry', status: 'draft', state: 'active', employee: '', employeeRef: '' })) }, folders: staff, user })
    expect(page.renderErrors).toEqual([])
    const picker = page.wrapper.findAllComponents({ name: 'CvSelect' }).find(select => select.props('label') === 'Employee record')!
    expect((picker.props('options') as { value: string }[]).map(option => option.value)).toEqual(['/employees/EMP-0001'])
    picker.vm.$emit('update', '/employees/EMP-0001')
    await flushPromises()
    expect(page.graph.scope.form.values).toMatchObject({ employeeRef: '/employees/EMP-0001', employee: 'Thandi Mokoena' })
    page.wrapper.unmount()

    const fresh = await render('timesheets', 'entry.form.yaml', { record: { code: 'TS-1', kind: 'entry', status: 'draft', state: 'active', employee: '', employeeRef: '' }, folders: staff, user })
    const me = fresh.wrapper.findAll('button').find(button => button.text().includes('This is me'))!
    await me.trigger('click')
    await flushPromises()
    expect(fresh.graph.scope.form.values).toMatchObject({ employeeRef: '/employees/EMP-0001', employee: 'Thandi Mokoena' })
    fresh.wrapper.unmount()
  })

  it.each([
    ['expenses', 'report.form.yaml', 'employeeRecord', 'employeeName', { kind: 'report', status: 'draft', lines: [] }],
    ['time-off', 'request.form.yaml', 'employeeRef', 'employeeName', { kind: 'request', status: 'draft' }],
    ['referrals', 'referral.form.yaml', 'referrerRef', 'referrerName', { kind: 'referral', status: 'submitted' }],
    ['appraisals', 'appraisal.form.yaml', 'employeeRef', 'employeeName', { kind: 'appraisal', status: 'draft', ratings: [] }],
    ['planning', 'shift.form.yaml', 'employeeRef', 'employee', { kind: 'shift', status: 'draft' }],
    ['payroll', 'profile.form.yaml', 'employeeRef', 'employeeName', { kind: 'profile' }],
  ])('%s: picking an employee fills the name, including one stored with given and family names', async (pkg, file, ref, name, record) => {
    const folders = { '/employees': [...staff['/employees'], { path: '/employees/EMP-0003', data: { code: 'EMP-0003', givenName: 'Ana', familyName: 'Silva', status: 'active', state: 'active' } }] }
    const page = await render(pkg, file, { record: { code: 'R-1', state: 'active', [ref]: '', [name]: '', ...record }, folders, user })
    expect(page.renderErrors).toEqual([])
    const picker = page.wrapper.findAllComponents({ name: 'CvSelect' }).find(select => select.props('value') === '' && (select.props('options') as { value: string }[] | undefined)?.some(option => option.value === '/employees/EMP-0003'))!
    picker.vm.$emit('update', '/employees/EMP-0003')
    await flushPromises()
    expect(page.graph.scope.form.values).toMatchObject({ [ref]: '/employees/EMP-0003', [name]: 'Ana Silva' })
    page.wrapper.unmount()
  })

  it('helpdesk: a ticket linked to me is mine even under another name, and a linked ticket is not unassigned', async () => {
    const ticket = { path: '/tickets/T1', data: { code: 'T1', subject: 'Linked', stage: 'new', assignee: 'T.M.', assigneeRef: '/employees/EMP-0001', state: 'active' } }
    const mine = await render('helpdesk', 'mine.page.yaml', { folders: { ...staff, '/tickets': [ticket] }, user })
    let rows: any[] = []
    mine.wrapper.findAllComponents({ name: 'CvTable' }).forEach(table => { rows = rows.concat((table.props('rows') as any[]) || []) })
    expect(rows.map(row => row.code)).toEqual(['T1'])
    mine.wrapper.unmount()
  })
})

