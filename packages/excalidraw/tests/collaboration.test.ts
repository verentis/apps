import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativePort, portableScene, sceneChanges, SharedEditor, type Changes, type NativePort, type RoomState, type Snapshot } from '../app/lib/collaboration'
import { createTemplate } from '../app/lib/templates'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { serializeScene } from '../app/lib/format'
import type { BinaryFileData } from '@excalidraw/excalidraw/types'
import { isNativeSnapshot, isNativeSaveResult, NativeCollaborationClient, validateNativeCommand, type Bridge } from '@verentis/sdk'

function snapshot(sequence = 0): Snapshot {
  return { sequence, savedSequence: 0, revision: 'revision-1', readOnly: false, participants: [],
    scene: portableScene(createTemplate('blank')) }
}
function port(initial = snapshot()) {
  let latest = initial
  const api: NativePort = {
    join: vi.fn().mockResolvedValue(initial),
    snapshot: vi.fn().mockImplementation(async () => latest),
    apply: vi.fn().mockImplementation(async changes => (latest = {
      ...latest, sequence: latest.sequence + 1, scene: {
        elements: changes.changes.filter((c: { element: unknown }) => c.element).map((c: { element: unknown }) => c.element),
        appState: changes.appState ?? latest.scene.appState, files: changes.files ?? latest.scene.files,
      },
    })),
    presence: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockImplementation(async (generation, correlation) => {
      latest = { ...latest, savedSequence: latest.sequence, revision: 'revision-2' }
      return { ...latest, receipt: { generation, correlation, revision: 'revision-2' } }
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
  return api
}
afterEach(() => { vi.useRealTimers() })

describe('typed native editor adapter', () => {
  it('uses the actual pinned SDK to forward the exact captured background sequence', async () => {
    const initial = snapshot(7)
    const next = { ...initial.scene, appState: { viewBackgroundColor: '#112233' } }
    const changes = sceneChanges(initial.scene, next, 'captured-background', initial.sequence)!
    const request = vi.fn().mockResolvedValue(snapshot(19))
    const client = new NativeCollaborationClient({ requestNativeCollaboration: request } as unknown as Bridge)
    await client.apply(changes)
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'apply', changes })
    expect(request.mock.calls[0]![0].changes.appStateExpectedSequence).toBe(7)
    expect(() => validateNativeCommand({ operation: 'apply', changes })).not.toThrow()
  })
  it('rejects missing, unsafe or unpaired background baselines with the actual SDK validator', () => {
    const changes = { operationId: 'background-validation', changes: [], appState: { viewBackgroundColor: '#112233' } }
    for (const appStateExpectedSequence of [undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateNativeCommand({
        operation: 'apply', changes: { ...changes, appStateExpectedSequence },
      })).toThrow('Invalid collaboration changes.')
    }
    for (const appStateExpectedSequence of [0, Number.MAX_SAFE_INTEGER]) {
      expect(() => validateNativeCommand({
        operation: 'apply', changes: { ...changes, appStateExpectedSequence },
      })).not.toThrow()
    }
    expect(() => validateNativeCommand({
      operation: 'apply', changes: { operationId: 'unpaired-baseline', changes: [], appStateExpectedSequence: 7 },
    })).toThrow('Invalid collaboration changes.')
    expect(() => validateNativeCommand({
      operation: 'apply', changes: { operationId: 'unchanged-background', changes: [] },
    })).not.toThrow()
  })
  it('fails closed on registry SDKs without native collaboration', () => {
    expect(nativePort({ files: {} })).toBeNull()
    expect(nativePort({ collaboration: {} })).toBeNull()
    const api = port()
    expect(nativePort({ collaboration: api })).toBe(api)
  })
  it('validates the frozen SDK protocol without accepting obsolete snapshots or duplicate connection IDs', () => {
    const current = { ...snapshot(2), savedSequence: 1, revision: 'opaque revision: not-a-guid',
      participants: [
        { id: 'tab-one', name: 'Same user', readOnly: false, pointer: null },
        { id: 'tab-two', name: 'Same user', readOnly: false, pointer: null },
      ] }
    expect(isNativeSnapshot(current)).toBe(true)
    expect(isNativeSaveResult({ ...current, receipt: { generation: 1, correlation: 'save-correlation', revision: current.revision } })).toBe(true)
    expect(isNativeSnapshot({ ...current, participants: [current.participants[0], current.participants[0]] })).toBe(false)
    expect(isNativeSnapshot({ ...current, sequence: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
    expect(isNativeSnapshot({ ...current, revision: '' })).toBe(false)
    expect(isNativeSnapshot({ sessionId: 'obsolete', epoch: 1, acceptedRevision: 2, durableRevision: 1,
      elementRevisions: {}, scene: current.scene, readOnly: false })).toBe(false)
    expect(isNativeSaveResult({ ...current, receipt: { generation: 1, correlation: 'save-correlation', revision: '' } })).toBe(false)
  })
  it('preserves distinct connection presence IDs for two tabs with the same name', async () => {
    const initial = snapshot()
    initial.participants = [
      { id: 'connection-one', name: 'Same user', readOnly: false, pointer: { x: 1, y: 2 } },
      { id: 'connection-two', name: 'Same user', readOnly: false, pointer: { x: 3, y: 4 } },
    ]
    const states: RoomState[] = []
    const room = new SharedEditor(port(initial), state => states.push(state))
    await room.join()
    expect(states.at(-1)?.participants.map(participant => participant.id)).toEqual(['connection-one', 'connection-two'])
    await room.dispose()
  })
  it('discards snapshots that regress either accepted or durable sequence', async () => {
    vi.useFakeTimers()
    const initial = { ...snapshot(5), savedSequence: 3, scene: portableScene(createTemplate('flowchart')) }
    const latest = portableScene(createTemplate('wireframe'))
    const api = port(initial)
    api.snapshot = vi.fn()
      .mockResolvedValueOnce({ ...snapshot(4), savedSequence: 3 })
      .mockResolvedValueOnce({ ...snapshot(5), savedSequence: 2 })
      .mockResolvedValueOnce({ ...snapshot(6), savedSequence: 3, scene: latest })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(500)
      expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(initial.scene.elements.map(element => element.id))
    }
    await vi.advanceTimersByTimeAsync(500)
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(latest.elements.map(element => element.id))
    api.presence = vi.fn().mockResolvedValue(initial)
    await room.presence({ x: 1, y: 2 })
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(latest.elements.map(element => element.id))
    await room.dispose()
  })
  it('retains local edits and pauses on a regressing change acknowledgement', async () => {
    vi.useFakeTimers()
    const initial = { ...snapshot(5), savedSequence: 3, scene: portableScene(createTemplate('flowchart')) }
    const api = port(initial)
    api.apply = vi.fn().mockResolvedValue({ ...snapshot(4), savedSequence: 3 })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const local = createTemplate('wireframe')
    room.change(local)
    await vi.advanceTimersByTimeAsync(100)
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    expect(states.at(-1)?.message).toContain('out-of-order')
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(local.elements.map(element => element.id))
    await room.dispose()
  })
  it('honors read-only revocation without accepting an older scene', async () => {
    const initial = { ...snapshot(5), savedSequence: 3, scene: portableScene(createTemplate('flowchart')) }
    const api = port(initial)
    api.presence = vi.fn().mockResolvedValue({ ...snapshot(4), savedSequence: 3, readOnly: true })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    await room.presence({ x: 1, y: 2 })
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true })
    expect(states.at(-1)?.message).toContain('revoked')
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(initial.scene.elements.map(element => element.id))
    await room.dispose()
  })
  it('sends per-element expected versions, creations and deletions', () => {
    const before = portableScene(createTemplate('wireframe'))
    const next = { ...before, elements: before.elements.slice(1) }
    next.elements[0] = { ...next.elements[0]!, version: next.elements[0]!.version + 1, x: 999 }
    const changes = sceneChanges(before, next, 'operation-1')!
    expect(changes.operationId).toBe('operation-1')
    expect(changes.changes).toContainEqual({ id: before.elements[0]!.id, expectedVersion: before.elements[0]!.version, element: null })
    expect(changes.changes.find(c => c.id === next.elements[0]!.id)?.expectedVersion).toBe(before.elements[1]!.version)
    expect(sceneChanges(before, before)).toBeNull()
  })
  it('retains tombstones and embedded assets in native baselines while exporting upstream portable JSON', () => {
    const scene = createTemplate()
    const id = 'deleted-image' as BinaryFileData['id']
    scene.files[id] = {
      id, mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=' as BinaryFileData['dataURL'], created: 1,
    }
    scene.elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: id }])
      .map(element => ({ ...element, isDeleted: true, version: element.version + 1 }))
    const native = portableScene(scene)
    expect(native.elements).toHaveLength(1)
    expect(native.elements[0]).toMatchObject({ id: scene.elements[0]!.id, isDeleted: true })
    expect(native.files[id]).toEqual(scene.files[id])
    expect(sceneChanges(native, portableScene(scene))).toBeNull()
    expect(JSON.parse(serializeScene(scene)).elements).toEqual([])
  })
  it('uses tombstone versions for resurrection and omits never-submitted deleted creations', () => {
    const scene = portableScene(createTemplate('flowchart'))
    const element = { ...scene.elements[0]!, version: 4, isDeleted: true }
    const before = { ...scene, elements: [element] }
    const next = { ...scene, elements: [{ ...element, version: 5, isDeleted: false }] }
    expect(sceneChanges(before, next)?.changes).toEqual([{ id: element.id, expectedVersion: 4, element: next.elements[0] }])
    expect(sceneChanges({ ...scene, elements: [] }, before)).toBeNull()
    expect(sceneChanges(before, { ...scene, elements: [] })).toBeNull()
  })
  it('does not resubmit authoritative tombstones when editing another element', async () => {
    vi.useFakeTimers()
    const scene = createTemplate('flowchart')
    const tombstoneId = scene.elements[0]!.id
    scene.elements = scene.elements.map((element, i) => i === 0 ? { ...element, isDeleted: true } : element)
    const api = port({ ...snapshot(), scene: portableScene(scene) })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const restored = states.at(-1)!.scene!
    const added = convertToExcalidrawElements([{ type: 'rectangle', x: 2000, y: 2000, width: 100, height: 100 }])[0]!
    room.change({ ...restored, elements: [...restored.elements, added] })
    await vi.advanceTimersByTimeAsync(100)
    const changes = vi.mocked(api.apply).mock.calls[0]![0].changes
    expect(changes.some(change => change.id === tombstoneId)).toBe(false)
    expect(changes).toContainEqual(expect.objectContaining({ id: added.id, expectedVersion: null }))
    await room.dispose()
  })
  it('never rebases queued same-element intent onto a later remote winner in the acknowledgement', async () => {
    vi.useFakeTimers()
    const scene = createTemplate('wireframe')
    const original = scene.elements[0]!
    let complete: ((value: Snapshot) => void) | undefined
    const api = port({ ...snapshot(), scene: portableScene(scene) })
    api.apply = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockRejectedValueOnce(Object.assign(new Error('Stale intent'), { code: 'CONFLICT' }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const edited = (version: number, x: number) => ({
      ...scene, elements: scene.elements.map(element => element.id === original.id ? { ...element, version, x } : element),
    })
    const submittedVersion = original.version + 1
    const localX = original.x + 200
    room.change(edited(submittedVersion, original.x + 100))
    await vi.advanceTimersByTimeAsync(100)
    room.change(edited(submittedVersion + 2, localX))
    complete!({ ...snapshot(2), scene: portableScene(edited(submittedVersion + 1, 999)) })
    await vi.advanceTimersByTimeAsync(100)
    expect(api.apply).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.apply).mock.calls[1]![0].changes.find(change => change.id === original.id)).toMatchObject({
      expectedVersion: submittedVersion, element: { version: submittedVersion + 2, x: localX },
    })
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    expect(states.at(-1)?.scene?.elements.find(element => element.id === original.id)?.x).toBe(localX)
    await room.dispose()
  })
  it('keeps local grid preferences out of the shared-state whitelist', () => {
    const scene = createTemplate()
    scene.appState = { viewBackgroundColor: '#ffffff', gridSize: 50, gridStep: 5, gridModeEnabled: true }
    expect(portableScene(scene).appState).toEqual({ viewBackgroundColor: '#ffffff' })
  })
  it('requires the captured safe accepted sequence only for changed backgrounds', () => {
    const before = portableScene(createTemplate())
    const next = { ...before, appState: { viewBackgroundColor: '#112233' } }
    expect(sceneChanges(before, next, 'background', 0)).toMatchObject({
      appState: { viewBackgroundColor: '#112233' }, appStateExpectedSequence: 0,
    })
    for (const invalid of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => sceneChanges(before, next, 'background', invalid)).toThrow('captured accepted sequence')
    }
    const elements = portableScene(createTemplate('flowchart')).elements
    const unchanged = sceneChanges({ ...before, appState: {} }, { ...before, elements }, 'elements', 20)!
    expect(unchanged).not.toHaveProperty('appState')
    expect(unchanged).not.toHaveProperty('appStateExpectedSequence')
  })
  it('rejects a concurrent stale background atomically and retains the local gesture draft', async () => {
    vi.useFakeTimers()
    let server = { ...snapshot(10), savedSequence: 10 }
    const apply = async (changes: Changes) => {
      if (changes.appState && changes.appStateExpectedSequence !== server.sequence) {
        throw Object.assign(new Error('Background sequence conflict'), { code: 'CONFLICT' })
      }
      server = { ...server, sequence: server.sequence + 1, scene: {
        ...server.scene,
        elements: [...server.scene.elements, ...changes.changes.flatMap(change => change.element ? [change.element] : [])],
        appState: changes.appState ?? server.scene.appState,
      } }
      return server
    }
    const makeApi = () => ({ ...port(), join: vi.fn(async () => server), presence: vi.fn(async () => server), apply: vi.fn(apply) })
    const winnerApi = makeApi()
    const staleApi = makeApi()
    const states: RoomState[] = []
    const winner = new SharedEditor(winnerApi, () => {})
    const stale = new SharedEditor(staleApi, state => states.push(state))
    await winner.join()
    await stale.join()
    stale.gesture(true)
    const local = createTemplate('flowchart')
    local.appState.viewBackgroundColor = '#112233'
    stale.change(local)
    const remote = createTemplate()
    remote.appState.viewBackgroundColor = '#aabbcc'
    winner.change(remote)
    await vi.advanceTimersByTimeAsync(100)
    await stale.presence({ x: 1, y: 2 })
    stale.gesture(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(staleApi.apply).toHaveBeenCalledWith(expect.objectContaining({
      appStateExpectedSequence: 10, appState: { viewBackgroundColor: '#112233' },
    }))
    expect(server.sequence).toBe(11)
    expect(server.scene.appState.viewBackgroundColor).toBe('#aabbcc')
    expect(server.scene.elements).toHaveLength(0)
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    expect(states.at(-1)?.message).toContain('background edit began')
    expect(states.at(-1)?.message).toContain('retained for download')
    expect(states.at(-1)?.scene?.appState.viewBackgroundColor).toBe('#112233')
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(local.elements.map(element => element.id))
    await Promise.all([winner.dispose(), stale.dispose()])
  })
  it('does not rebase a queued background intent onto the preceding element acknowledgement', async () => {
    vi.useFakeTimers()
    const api = port({ ...snapshot(30), savedSequence: 30 })
    let complete: ((value: Snapshot) => void) | undefined
    api.apply = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockRejectedValueOnce(Object.assign(new Error('Background sequence conflict'), { code: 'CONFLICT' }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const local = createTemplate('flowchart')
    room.change(local)
    await vi.advanceTimersByTimeAsync(100)
    expect(vi.mocked(api.apply).mock.calls[0]![0]).not.toHaveProperty('appState')
    expect(vi.mocked(api.apply).mock.calls[0]![0]).not.toHaveProperty('appStateExpectedSequence')
    const background = { ...local, appState: { ...local.appState, viewBackgroundColor: '#112233' } }
    room.change(background)
    complete!({ ...snapshot(31), savedSequence: 30, scene: portableScene(local) })
    await vi.advanceTimersByTimeAsync(100)
    expect(vi.mocked(api.apply).mock.calls[1]![0]).toMatchObject({
      changes: [], appState: { viewBackgroundColor: '#112233' }, appStateExpectedSequence: 30,
    })
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    expect(states.at(-1)?.scene?.appState.viewBackgroundColor).toBe('#112233')
    await room.dispose()
  })
  it('keeps the rendered background baseline after a newer poll and local revert', async () => {
    vi.useFakeTimers()
    const initial = { ...snapshot(40), savedSequence: 40 }
    const api = port(initial)
    let complete: ((value: Snapshot) => void) | undefined
    api.snapshot = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve }))
    api.apply = vi.fn().mockRejectedValue(Object.assign(new Error('Background sequence conflict'), { code: 'CONFLICT' }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    await vi.advanceTimersByTimeAsync(500)
    const red = createTemplate()
    red.appState.viewBackgroundColor = '#ff0000'
    room.change(red)
    const remote = createTemplate('wireframe')
    remote.appState.viewBackgroundColor = '#00ff00'
    complete!({ ...snapshot(42), savedSequence: 40, scene: portableScene(remote) })
    await Promise.resolve()
    await Promise.resolve()
    room.change(createTemplate())
    const blue = createTemplate()
    blue.appState.viewBackgroundColor = '#112233'
    room.change(blue)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({
      appStateExpectedSequence: 40, appState: { viewBackgroundColor: '#112233' },
    }))
    expect(states.at(-1)?.scene?.appState.viewBackgroundColor).toBe('#112233')
    expect(states.at(-1)?.message).toContain('background edit began')
    await room.dispose()
  })
  it('does not mark local-only appState preferences dirty', async () => {
    vi.useFakeTimers()
    const api = port()
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const local = createTemplate()
    local.appState = { ...local.appState, gridSize: 50, gridModeEnabled: true, theme: 'dark' }
    room.change(local)
    await vi.advanceTimersByTimeAsync(100)
    expect(states.at(-1)?.dirty).toBe(false)
    expect(api.apply).not.toHaveBeenCalled()
    local.appState.viewBackgroundColor = '#fef3c7'
    room.change(local)
    expect(states.at(-1)?.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({ appState: { viewBackgroundColor: '#fef3c7' } }))
    room.dispose()
  })
  it('does not submit transient image retrieval timestamps as asset mutations', () => {
    const scene = createTemplate()
    const id = 'asset' as BinaryFileData['id']
    scene.files[id] = {
      id, mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=' as BinaryFileData['dataURL'],
      created: 1, lastRetrieved: 2,
    }
    scene.elements = convertToExcalidrawElements([{ type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: id }])
    const before = portableScene(scene)
    scene.files[id]!.lastRetrieved = 3
    expect(sceneChanges(before, portableScene(scene))).toBeNull()
    expect(before.files.asset).toEqual({ id, mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=', created: 1 })
  })
  it('pauses a rejected same-element batch and explains server-winner recovery', async () => {
    vi.useFakeTimers()
    const api = port()
    api.apply = vi.fn().mockRejectedValue(Object.assign(new Error('Conflict'), { code: 'CONFLICT' }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    room.change(createTemplate('flowchart'))
    await vi.advanceTimersByTimeAsync(100)
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    expect(states.at(-1)?.message).toContain('server winner')
    expect(states.at(-1)?.scene?.elements).toHaveLength(createTemplate('flowchart').elements.length)
    expect(states.at(-1)?.resetHistory).toBe(false)
    room.dispose()
  })
  it('retains queued edits on disconnect and ignores a late acknowledgement', async () => {
    vi.useFakeTimers()
    const api = port()
    let resolve: ((value: Snapshot) => void) | undefined
    api.apply = vi.fn().mockImplementation(() => new Promise(done => { resolve = done }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const local = createTemplate('flowchart')
    room.change(local)
    await vi.advanceTimersByTimeAsync(100)
    room.disconnect()
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(local.elements.map(element => element.id))
    resolve!(snapshot(1))
    await Promise.resolve()
    await Promise.resolve()
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true, busy: false })
    room.dispose()
  })
  it('retains an interrupted drawing gesture for download without offline submission', async () => {
    const api = port()
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    room.gesture(true)
    room.disconnect()
    const local = createTemplate('flowchart')
    room.retainForDownload(local)
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true, resetHistory: false })
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(local.elements.map(element => element.id))
    expect(api.apply).not.toHaveBeenCalled()
    room.dispose()
  })
  it('freezes pending edits on revoked permission without submitting or restoring', async () => {
    vi.useFakeTimers()
    const api = port()
    let resolve: ((value: Snapshot) => void) | undefined
    api.presence = vi.fn().mockImplementation(() => new Promise(done => { resolve = done }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const presence = room.presence({ x: 1, y: 2 })
    const local = createTemplate('wireframe')
    room.change(local)
    resolve!({ ...snapshot(), readOnly: true })
    await presence
    await vi.advanceTimersByTimeAsync(100)
    expect(states.at(-1)).toMatchObject({ readOnly: true, dirty: true })
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual(local.elements.map(element => element.id))
    expect(api.apply).not.toHaveBeenCalled()
    room.dispose()
  })
  it('waits for an in-flight request before closing on disposal', async () => {
    const api = port()
    let resolve: ((value: Snapshot) => void) | undefined
    api.presence = vi.fn().mockImplementation(() => new Promise(done => { resolve = done }))
    const room = new SharedEditor(api, () => {})
    await room.join()
    const presence = room.presence({ x: 1, y: 2 })
    const disposed = room.dispose()
    const settled = vi.fn()
    void disposed.then(settled)
    expect(api.close).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    resolve!(snapshot())
    await presence
    await disposed
    expect(api.close).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  })
  it('does not claim durable save for an unmatched receipt', async () => {
    const api = port(snapshot(1))
    api.save = vi.fn().mockResolvedValue({ ...snapshot(1), receipt: { generation: 1, correlation: 'wrong', revision: 'revision-1' } })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    await expect(room.save()).rejects.toThrow('durable')
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    room.dispose()
  })
  it.each([0, 200])('uses distinct save-attempt counters independently of accepted sequence %s', async sequence => {
    const api = port({ ...snapshot(sequence), savedSequence: Math.max(0, sequence - 1) })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    await room.save()
    await room.save()
    const calls = vi.mocked(api.save).mock.calls
    expect(calls.map(([generation]) => generation)).toEqual([1, 2])
    expect(calls[0]![1]).not.toBe(calls[1]![1])
    expect(states.at(-1)).toMatchObject({ connected: true, dirty: false })
    await room.dispose()
  })
  it('requires the captured accepted frontier rather than the save-attempt counter to become durable', async () => {
    const initial = { ...snapshot(200), savedSequence: 199 }
    const api = port(initial)
    api.save = vi.fn().mockImplementation(async (generation, correlation) => ({
      ...initial, receipt: { generation, correlation, revision: initial.revision },
    }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    await expect(room.save()).rejects.toThrow('durable save receipt')
    expect(api.save).toHaveBeenCalledWith(1, expect.any(String))
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true, dirty: true })
    await room.dispose()
  })
  it.each([false, true])('accepts an immutable receipt despite a later coauthor head, fencing newer local edits=%s', async edited => {
    const api = port({ ...snapshot(20), savedSequence: 10 })
    let complete: ((value: Awaited<ReturnType<NativePort['save']>>) => void) | undefined
    let receipt: { generation: number; correlation: string; revision: string } | undefined
    api.save = vi.fn().mockImplementation((generation, correlation) => {
      receipt = { generation, correlation, revision: 'immutable-captured-commit' }
      return new Promise(resolve => { complete = resolve })
    })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const saving = room.save()
    await Promise.resolve()
    const local = createTemplate('flowchart')
    if (edited) room.change(local)
    const latest = portableScene(createTemplate('wireframe'))
    complete!({ ...snapshot(25), savedSequence: 25, revision: 'later-coauthor-head', scene: latest, receipt: receipt! })
    await expect(saving).resolves.toBeUndefined()
    expect(states.at(-1)).toMatchObject({ connected: true, readOnly: false, dirty: edited })
    if (edited) room.disconnect()
    expect(states.at(-1)?.scene?.elements.map(element => element.id)).toEqual((edited ? local.elements : latest.elements).map(element => element.id))
    await room.dispose()
  })
  it('does not exceed one native request when Save is invoked repeatedly in the same turn', async () => {
    const api = port()
    const room = new SharedEditor(api, () => {})
    await room.join()
    const results = await Promise.allSettled(Array.from({ length: 7 }, () => room.save()))
    expect(api.save).toHaveBeenCalledOnce()
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(6)
    await room.dispose()
  })
  it.each(['save', 'apply'] as const)('skips polls and presence while %s consumes the native request budget', async operation => {
    vi.useFakeTimers()
    const api = port()
    let release: (() => void) | undefined
    if (operation === 'save') {
      api.save = vi.fn().mockImplementation((generation, correlation) => new Promise(resolve => {
        release = () => resolve({ ...snapshot(generation), savedSequence: generation, revision: 'saved',
          receipt: { generation, correlation, revision: 'saved' } })
      }))
    } else {
      api.apply = vi.fn().mockImplementation(() => new Promise(resolve => {
        release = () => resolve({ ...snapshot(1), scene: portableScene(createTemplate('flowchart')) })
      }))
    }
    const room = new SharedEditor(api, () => {})
    await room.join()
    let saving: Promise<void> | undefined
    if (operation === 'save') {
      saving = room.save()
      await Promise.resolve()
    } else {
      room.change(createTemplate('flowchart'))
      await vi.advanceTimersByTimeAsync(100)
    }
    await room.presence({ x: 1, y: 2 })
    await vi.advanceTimersByTimeAsync(1500)
    expect(api.presence).not.toHaveBeenCalled()
    expect(api.snapshot).not.toHaveBeenCalled()
    expect(api[operation]).toHaveBeenCalledOnce()
    release!()
    if (saving) await saving
    await Promise.resolve()
    await room.dispose()
  })
  it('preserves dirty state when a newer edit arrives during durable save', async () => {
    const api = port(snapshot(1))
    let complete: ((value: Awaited<ReturnType<NativePort['save']>>) => void) | undefined
    let receipt: { generation: number; correlation: string; revision: string } | undefined
    api.save = vi.fn().mockImplementation((generation, correlation) => {
      receipt = { generation, correlation, revision: 'revision-2' }
      return new Promise(resolve => { complete = resolve })
    })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const saving = room.save()
    await Promise.resolve()
    room.change(createTemplate('flowchart'))
    complete!({ ...snapshot(1), savedSequence: 1, revision: 'revision-2', receipt: receipt! })
    await saving
    expect(states.at(-1)).toMatchObject({ connected: true, dirty: true, message: 'Unsaved changes' })
    room.dispose()
  })
  it('checks the current local generation even when newer edits are reverted before receipt', async () => {
    vi.useFakeTimers()
    const api = port(snapshot(1))
    let complete: ((value: Awaited<ReturnType<NativePort['save']>>) => void) | undefined
    let receipt: { generation: number; correlation: string; revision: string } | undefined
    api.save = vi.fn().mockImplementation((generation, correlation) => {
      receipt = { generation, correlation, revision: 'revision-2' }
      return new Promise(resolve => { complete = resolve })
    })
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    const saving = room.save()
    await Promise.resolve()
    room.change(createTemplate('flowchart'))
    room.change(createTemplate('blank'))
    const saved = { ...snapshot(1), savedSequence: 1, revision: 'revision-2' }
    complete!({ ...saved, receipt: receipt! })
    await saving
    expect(states.at(-1)?.dirty).toBe(true)
    api.snapshot = vi.fn().mockResolvedValue(saved)
    await vi.advanceTimersByTimeAsync(500)
    expect(states.at(-1)?.dirty).toBe(true)
    api.save = port(saved).save
    await room.save()
    expect(states.at(-1)?.dirty).toBe(false)
    await room.dispose()
  })
  it('does not treat a newer accepted sequence as durably saved', async () => {
    const api = port(snapshot(1))
    api.save = vi.fn().mockImplementation(async (generation, correlation) => ({
      ...snapshot(2), savedSequence: 1, revision: 'revision-2',
      receipt: { generation, correlation, revision: 'revision-2' },
    }))
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    await room.save()
    expect(states.at(-1)).toMatchObject({ connected: true, dirty: true, message: 'Unsaved changes' })
    await room.dispose()
  })
  it('stops editing on disconnect and reloads instead of offline merging', async () => {
    const api = port()
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    room.disconnect()
    room.change(createTemplate('flowchart'))
    expect(api.apply).not.toHaveBeenCalled()
    expect(states.at(-1)).toMatchObject({ connected: false, readOnly: true })
    await room.reconnect()
    expect(states.at(-1)).toMatchObject({ connected: true, readOnly: false, dirty: false })
    room.dispose()
  })
  it('cleans all timers and closes exactly once, including late admission', async () => {
    vi.useFakeTimers()
    const api = port()
    let complete: ((value: Snapshot) => void) | undefined
    api.join = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const changed = vi.fn()
    const room = new SharedEditor(api, changed)
    const joining = room.join()
    room.dispose()
    room.dispose()
    complete!(snapshot())
    await joining
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.close).toHaveBeenCalledTimes(1)
    expect(api.snapshot).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })
  it('autosaves acknowledged changes only and fences read-only rooms', async () => {
    vi.useFakeTimers()
    const api = port()
    const room = new SharedEditor(api, () => {})
    await room.join()
    room.change(createTemplate('flowchart'))
    await vi.advanceTimersByTimeAsync(100)
    expect(api.apply).toHaveBeenCalledTimes(1)
    room.dispose()
    const readonly = port({ ...snapshot(), readOnly: true })
    const observer = new SharedEditor(readonly, () => {})
    await observer.join()
    observer.change(createTemplate('wireframe'))
    await vi.advanceTimersByTimeAsync(2500)
    expect(readonly.apply).not.toHaveBeenCalled()
    await expect(observer.save()).rejects.toThrow('edit permission')
    observer.dispose()
  })
  it('flushes edits queued during presence without deleting independent remote elements', async () => {
    vi.useFakeTimers()
    const api = port()
    let complete: ((value: Snapshot) => void) | undefined
    api.presence = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const room = new SharedEditor(api, () => {})
    await room.join()
    const presence = room.presence({ x: 1, y: 2 })
    const local = createTemplate('flowchart')
    room.change(local)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.apply).not.toHaveBeenCalled()
    const remote = portableScene(createTemplate('wireframe'))
    complete!({ ...snapshot(1), scene: remote })
    await presence
    await vi.advanceTimersByTimeAsync(10)
    expect(api.apply).toHaveBeenCalledTimes(1)
    const changes = vi.mocked(api.apply).mock.calls[0]![0]
    expect(changes.changes.every(change => change.element !== null && change.expectedVersion === null)).toBe(true)
    expect(changes.changes.map(change => change.id).some(id => remote.elements.some(element => element.id === id))).toBe(false)
    room.dispose()
  })
  it('does not replace an in-progress drawing gesture with a remote snapshot', async () => {
    vi.useFakeTimers()
    const api = port()
    const states: RoomState[] = []
    const room = new SharedEditor(api, state => states.push(state))
    await room.join()
    room.gesture(true)
    room.change(createTemplate('flowchart'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(api.apply).not.toHaveBeenCalled()
    expect(api.snapshot).not.toHaveBeenCalled()
    room.gesture(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.apply).toHaveBeenCalledTimes(1)
    room.dispose()
  })
})
