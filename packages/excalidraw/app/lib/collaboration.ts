import { parseScene, serializeScene, type Scene } from './format'
import type { NativeChangeSet, NativeParticipant, NativeSnapshot, VerentisClient } from '@verentis/sdk'
export type { NativeElement, NativeScene } from '@verentis/sdk'
import type { NativeScene } from '@verentis/sdk'

export type NativePort = Pick<VerentisClient['collaboration'], 'join' | 'snapshot' | 'apply' | 'presence' | 'save' | 'close'>
export type Snapshot = NativeSnapshot
export type Participant = NativeParticipant
export type Changes = NativeChangeSet
export interface RoomState {
  scene: Scene | null
  participants: Participant[]
  connected: boolean
  readOnly: boolean
  dirty: boolean
  busy: boolean
  message: string
  resetHistory: boolean
}
export function nativePort(client: unknown): NativePort | null {
  if (!client || typeof client !== 'object' || !('collaboration' in client)) return null
  const value = client.collaboration
  if (!value || typeof value !== 'object') return null
  if (!['join', 'snapshot', 'apply', 'presence', 'save', 'close'].every(key => key in value && typeof Reflect.get(value, key) === 'function')) return null
  return value as NativePort
}
export function portableScene(scene: Scene): NativeScene {
  const portable = JSON.parse(serializeScene(scene)) as NativeScene
  const liveElements = new Map(portable.elements.map(element => [element.id, element]))
  return {
    // Portable exports prune tombstones; the native baseline must retain them.
    elements: scene.elements.map(element => element.isDeleted ? { ...element } : liveElements.get(element.id)!),
    files: Object.fromEntries(Object.entries(scene.files).map(([id, file]) => [id, {
      id: file.id, mimeType: file.mimeType, dataURL: file.dataURL, created: file.created,
    }])),
    // Grid/view preferences remain local; the native reducer shares only background.
    appState: typeof portable.appState.viewBackgroundColor === 'string'
      ? { viewBackgroundColor: portable.appState.viewBackgroundColor } : {},
  }
}
export function sceneChanges(base: NativeScene, next: NativeScene, operationId: string = crypto.randomUUID(), baselineSequence?: number): Changes | null {
  const before = new Map(base.elements.map(element => [element.id, element]))
  const after = new Map(next.elements.map(element => [element.id, element]))
  const changes: Changes['changes'] = []
  for (const [id, element] of after) {
    const previous = before.get(id)
    if (!previous && element.isDeleted) continue
    if (JSON.stringify(previous) !== JSON.stringify(element)) {
      changes.push({ id, expectedVersion: previous?.version ?? null, element })
    }
  }
  for (const [id, element] of before) {
    if (!after.has(id) && !element.isDeleted) changes.push({ id, expectedVersion: element.version, element: null })
  }
  const filesChanged = JSON.stringify(base.files) !== JSON.stringify(next.files)
  const background = typeof next.appState.viewBackgroundColor === 'string' ? next.appState.viewBackgroundColor : '#ffffff'
  const previousBackground = typeof base.appState.viewBackgroundColor === 'string' ? base.appState.viewBackgroundColor : '#ffffff'
  const appChanged = previousBackground !== background
  if (!changes.length && !filesChanged && !appChanged) return null
  if (appChanged && (!Number.isSafeInteger(baselineSequence) || baselineSequence! < 0)) {
    throw new Error('Shared background edits require a captured accepted sequence.')
  }
  return { operationId, changes, ...(filesChanged ? { files: next.files } : {}),
    ...(appChanged ? { appState: { viewBackgroundColor: background }, appStateExpectedSequence: baselineSequence } : {}) }
}

export class SharedEditor {
  private base: Snapshot | null = null
  private appliedBase: Snapshot | null = null
  private pending: Scene | null = null
  private pendingBase: NativeScene | null = null
  private pendingBaseSequence: number | null = null
  private localScene: Scene | null = null
  private localSignature: string | null = null
  private localGeneration = 0
  private saveGeneration = 0
  private savingLocalGeneration: number | null = null
  private saveSuperseded = false
  private connection = 0
  private inFlightScene: NativeScene | null = null
  private expectedOverrides = new Map<string, number | null>()
  private disposed = false
  private closed = false
  private closeSettled!: () => void
  private closeDone = new Promise<void>(resolve => { this.closeSettled = resolve })
  private running = false
  private gesturing = false
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private lastPresence = 0
  private state: RoomState = {
    scene: null, participants: [], connected: false, readOnly: true,
    dirty: false, busy: false, message: 'Joining the document room…', resetHistory: false,
  }
  constructor(private readonly port: NativePort, private readonly changed: (state: RoomState) => void) {}
  private notify(patch: Partial<RoomState>) {
    this.state = { ...this.state, ...patch }
    if (!this.disposed) this.changed(this.state)
  }
  private isOrdered(snapshot: Snapshot) {
    return !this.base || (snapshot.sequence >= this.base.sequence && snapshot.savedSequence >= this.base.savedSequence)
  }
  private accept(snapshot: Snapshot, resetHistory = true, forceHistoryReset = false, retainDirty = false) {
    const scene = parseScene(JSON.stringify({ type: 'excalidraw', version: 2, ...snapshot.scene }))
    const remoteChanged = !!this.base && JSON.stringify(this.base.scene) !== JSON.stringify(snapshot.scene)
    this.base = snapshot
    this.appliedBase = snapshot
    this.localScene = scene
    this.localSignature = JSON.stringify(portableScene(scene))
    this.notify({
      scene, participants: snapshot.participants, connected: true, readOnly: snapshot.readOnly,
      dirty: retainDirty || this.saveSuperseded || !!this.pending || snapshot.sequence > snapshot.savedSequence,
      message: snapshot.readOnly ? 'Read-only permission' : retainDirty || this.saveSuperseded || snapshot.sequence > snapshot.savedSequence ? 'Unsaved changes' : 'Saved',
      resetHistory: forceHistoryReset || (resetHistory && remoteChanged),
    })
  }
  private receive(snapshot: Snapshot, resetHistory = true, retainDirty = false) {
    if (!this.isOrdered(snapshot)) {
      if (snapshot.readOnly && !this.state.readOnly) this.fail(new Error('Edit permission was revoked.'))
      return
    }
    if (snapshot.readOnly && (this.pending || this.inFlightScene)) {
      this.base = snapshot
      this.notify({
        scene: this.localScene, participants: snapshot.participants, readOnly: true,
        dirty: true, resetHistory: false,
        message: 'Edit permission was revoked. Unconfirmed local edits are retained for download; reconnect reloads authoritative state.',
      })
      return
    }
    if (this.gesturing && !snapshot.readOnly) {
      this.notify({ participants: snapshot.participants })
      return
    }
    if (this.pending && !snapshot.readOnly) {
      this.base = snapshot
      this.notify({ participants: snapshot.participants, dirty: true, connected: true, readOnly: false, message: 'Unsaved changes' })
    } else {
      this.accept(snapshot, resetHistory, false, retainDirty)
    }
  }
  gesture(active: boolean) { this.gesturing = active; if (!active) this.scheduleFlush() }
  private scheduleFlush() {
    if (this.pending && this.state.connected && !this.state.readOnly && !this.disposed) {
      clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => { void this.flush() }, 0)
    }
  }
  async join() {
    if (this.disposed || this.running) return
    this.running = true
    const connection = ++this.connection
    try {
      const snapshot = await this.port.join()
      if (this.disposed || connection !== this.connection) return
      this.pending = null
      this.pendingBase = null
      this.pendingBaseSequence = null
      this.expectedOverrides.clear()
      this.gesturing = false
      this.saveSuperseded = false
      this.accept(snapshot, true, true)
      this.schedulePoll()
    } catch (cause) { this.fail(cause) }
    finally { this.finished() }
  }
  change(scene: Scene) {
    if (this.disposed || !this.state.connected || this.state.readOnly) return
    const next = portableScene(scene)
    const signature = JSON.stringify(next)
    this.localScene = scene
    if (signature === this.localSignature) {
      if (this.pending) this.pending = scene
      return
    }
    this.localSignature = signature
    this.localGeneration++
    const baseline = this.pendingBase ?? this.inFlightScene ?? this.appliedBase?.scene ?? next
    const baselineSequence = this.pendingBaseSequence ?? this.appliedBase?.sequence ?? 0
    if (!sceneChanges(baseline, next, undefined, baselineSequence)) {
      this.pending = null
      this.pendingBase = null
      this.pendingBaseSequence = null
      clearTimeout(this.flushTimer)
      const dirty = this.saveSuperseded || !!this.inFlightScene || (!!this.base && this.base.sequence > this.base.savedSequence) ||
        (this.savingLocalGeneration !== null && this.localGeneration !== this.savingLocalGeneration)
      if (dirty !== this.state.dirty) this.notify({ dirty, message: dirty ? 'Unsaved changes' : 'Saved' })
      return
    }
    this.pendingBase ??= baseline
    this.pendingBaseSequence ??= baselineSequence
    this.pending = scene
    this.notify({ dirty: true, message: 'Unsaved changes' })
    clearTimeout(this.flushTimer)
    clearTimeout(this.saveTimer)
    this.flushTimer = setTimeout(() => { void this.flush() }, 80)
    this.scheduleSave(2000)
  }
  retainForDownload(scene: Scene) {
    if (this.disposed || !this.state.readOnly || !this.base) return
    const baseline = this.pendingBase ?? this.appliedBase?.scene ?? this.base.scene
    const baselineSequence = this.pendingBaseSequence ?? this.appliedBase?.sequence ?? 0
    const next = portableScene(scene)
    if (!sceneChanges(baseline, next, undefined, baselineSequence)) return
    const signature = JSON.stringify(next)
    if (signature !== this.localSignature) this.localGeneration++
    this.localSignature = signature
    this.localScene = scene
    this.pending = scene
    this.pendingBase ??= baseline
    this.pendingBaseSequence ??= baselineSequence
    this.notify({ scene, dirty: true, resetHistory: false })
  }
  private scheduleSave(delay: number) {
    this.saveTimer = setTimeout(() => {
      if (this.disposed || !this.state.connected || this.state.readOnly) return
      if (this.gesturing) { this.scheduleSave(500); return }
      if (this.pending && !this.running) void this.flush()
      if (this.running || this.pending) { this.scheduleSave(500); return }
      if (this.state.dirty) void this.save().catch(() => {})
    }, delay)
  }
  private async flush() {
    if (this.disposed || this.running || this.gesturing || !this.pending || !this.base || !this.state.connected || this.state.readOnly) return
    const current = this.pending
    const baseline = this.pendingBase ?? this.base.scene
    const baselineSequence = this.pendingBaseSequence ?? this.appliedBase?.sequence ?? 0
    this.pending = null
    this.pendingBase = null
    this.pendingBaseSequence = null
    const next = portableScene(current)
    const changes = sceneChanges(baseline, next, undefined, baselineSequence)
    if (changes) {
      for (const change of changes.changes) {
        if (this.expectedOverrides.has(change.id)) change.expectedVersion = this.expectedOverrides.get(change.id)!
      }
    }
    this.expectedOverrides.clear()
    if (!changes) {
      const dirty = this.saveSuperseded || this.base.sequence > this.base.savedSequence
      this.notify({ dirty, message: dirty ? 'Unsaved changes' : 'Saved' })
      return
    }
    this.running = true
    const connection = this.connection
    this.inFlightScene = next
    this.notify({ busy: true })
    try {
      const snapshot = await this.port.apply(changes)
      if (this.disposed || connection !== this.connection) return
      if (!this.isOrdered(snapshot)) throw new Error('The platform returned an out-of-order change acknowledgement.')
      // A new edit made during this request is never marked saved or overwritten.
      if (this.pending) {
        for (const change of changes.changes) {
          // Only our submitted intent advances this baseline, never a later peer winner.
          this.expectedOverrides.set(change.id, change.element?.version ??
            (change.expectedVersion === null ? null : change.expectedVersion + 1))
        }
      }
      this.receive(snapshot, false)
    } catch (cause) {
      this.pending ??= current
      this.pendingBase ??= baseline
      this.pendingBaseSequence ??= baselineSequence
      this.fail(cause, !!changes.appState)
    }
    finally {
      this.inFlightScene = null
      this.finished()
    }
  }
  async save(): Promise<void> {
    if (this.disposed || !this.state.connected || this.state.readOnly) throw new Error('The document is not connected with edit permission.')
    if (this.running) throw new Error('Wait for the current document request before saving.')
    if (this.gesturing) throw new Error('Finish the current drawing or text edit before saving.')
    clearTimeout(this.flushTimer)
    await this.flush()
    if (this.running) throw new Error('Wait for the current document request before saving.')
    if (!this.state.connected || this.state.readOnly || !this.base) throw new Error('The document disconnected or lost edit permission before saving.')
    if (this.pending) throw new Error('Wait for the latest changes before saving.')
    const throughSequence = this.base.sequence
    if (this.saveGeneration === Number.MAX_SAFE_INTEGER) throw new Error('The save-attempt counter is exhausted. Reopen the document before saving.')
    const generation = ++this.saveGeneration
    const localGeneration = this.localGeneration
    const correlation = crypto.randomUUID()
    this.running = true
    this.savingLocalGeneration = localGeneration
    const connection = this.connection
    this.notify({ busy: true, message: 'Saving…' })
    try {
      const snapshot = await this.port.save(generation, correlation)
      if (this.disposed) return
      if (connection !== this.connection) throw new Error('The document disconnected during saving; no save is confirmed.')
      if (!this.isOrdered(snapshot)) throw new Error('The platform returned an out-of-order durable save snapshot.')
      if (snapshot.receipt.generation !== generation || snapshot.receipt.correlation !== correlation ||
          typeof snapshot.receipt.revision !== 'string' || !snapshot.receipt.revision || snapshot.savedSequence < throughSequence) {
        throw new Error('The platform did not confirm a matching durable save receipt.')
      }
      this.saveSuperseded = this.localGeneration !== localGeneration
      this.receive(snapshot, false, this.saveSuperseded)
    } catch (cause) { this.fail(cause); throw cause }
    finally {
      this.savingLocalGeneration = null
      this.finished()
    }
  }
  async presence(pointer: { x: number; y: number } | null) {
    if (this.disposed || this.running || !this.state.connected || Date.now() - this.lastPresence < 250) return
    this.lastPresence = Date.now()
    this.running = true
    const connection = this.connection
    try {
      const snapshot = await this.port.presence(pointer)
      if (!this.disposed && connection === this.connection) this.receive(snapshot)
    } catch (cause) { this.fail(cause) }
    finally { this.finished() }
  }
  private finished() {
    this.running = false
    this.notify({ busy: false })
    if (this.disposed) void this.close()
    else this.scheduleFlush()
  }
  private schedulePoll() {
    if (this.disposed) return
    clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => { void this.poll() }, 500)
  }
  private async poll() {
    if (this.disposed || !this.state.connected) return
    if (!this.running && !this.pending && !this.gesturing) {
      this.running = true
      const connection = this.connection
      try {
        const snapshot = await this.port.snapshot()
        if (!this.disposed && connection === this.connection) this.receive(snapshot)
      } catch (cause) { this.fail(cause) }
      finally { this.finished() }
    }
    if (this.state.connected) this.schedulePoll()
  }
  private fail(cause: unknown, backgroundIntent = false) {
    if (this.disposed) return
    clearTimeout(this.pollTimer)
    clearTimeout(this.flushTimer)
    clearTimeout(this.saveTimer)
    this.connection++
    if (this.inFlightScene) {
      this.pending ??= this.localScene
      this.pendingBase ??= this.base?.scene ?? null
      this.pendingBaseSequence ??= this.appliedBase?.sequence ?? null
    }
    this.gesturing = false
    const conflict = typeof cause === 'object' && cause !== null && 'code' in cause
      && typeof cause.code === 'string' && cause.code.toUpperCase() === 'CONFLICT'
    const message = conflict
      ? backgroundIntent
        ? 'Another participant changed the document after your background edit began. Your batch was rejected; reconnect to reload the server winner.'
        : 'Another participant changed an element. Your batch was rejected; reconnect to reload the server winner.'
      : cause instanceof Error ? cause.message : 'The document connection failed.'
    this.notify({
      scene: this.pending ? this.localScene : this.state.scene, resetHistory: false,
      connected: false, readOnly: true, busy: this.running,
      message: `${message} Editing paused. Unconfirmed local edits are retained for download. Reconnect reloads authoritative state; unconfirmed changes are not merged.`,
    })
  }
  disconnect() { this.fail(new Error('Connection interrupted.')) }
  async reconnect() {
    if (this.running || this.disposed) return
    this.notify({ connected: false, readOnly: true, message: 'Reloading authoritative document state…' })
    await this.join()
  }
  private async close() {
    if (this.closed) return
    this.closed = true
    try { await this.port.close() }
    catch {}
    finally { this.closeSettled() }
  }
  dispose(): Promise<void> {
    if (this.disposed) return this.closeDone
    this.disposed = true
    clearTimeout(this.pollTimer)
    clearTimeout(this.flushTimer)
    clearTimeout(this.saveTimer)
    this.pending = null
    this.pendingBase = null
    this.expectedOverrides.clear()
    if (!this.running) void this.close()
    return this.closeDone
  }
}
