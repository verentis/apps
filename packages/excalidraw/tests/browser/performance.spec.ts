import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus, platform, release, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { performanceElements } from '../../app/lib/performance-fixture'

interface TraceEvent { name: string; ts: number }
interface Capture { timestamp: number; data: string }
const scenario = 'desktop-1000-1440x900'
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] ?? Infinity

test('original desktop fixture: confirmed compositor pan/zoom paint with 1000 elements', async ({ page, browser }) => {
  test.skip(process.env.PERFORMANCE !== '1', 'Run npm run test:performance for scenario-local evidence.')
  test.setTimeout(120_000)
  const out = resolve(`tests/scenarios/${scenario}/outcomes`)
  await mkdir(out, { recursive: true })
  const fixture = JSON.stringify({
    type: 'excalidraw', version: 2, source: 'verentis-synthetic-original-fixture',
    elements: performanceElements(), appState: { viewBackgroundColor: '#ffffff' }, files: {},
  })
  await writeFile(resolve(out, '../original.excalidraw'), fixture)
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:3303') && !request.url().startsWith('data:')) external.push(request.url())
  })
  await page.route('**/desktop-1000-host', route => route.fulfill({
    contentType: 'text/html',
    body: `<html><body style="margin:0"><iframe src="/" style="width:100vw;height:100vh;border:0"></iframe><script>
      window.addEventListener('message',event=>{
        if(event.source!==document.querySelector('iframe').contentWindow)return;
        if(event.data.type==='verentis:ready')event.source.postMessage({
          type:'verentis:init',version:1,sessionId:'desktop-fixture',
          context:{surface:'file',workspace:{id:'fixture-workspace',slug:'fixture',name:'Synthetic fixture'},
            apiUrl:location.origin,file:{path:'desktop-1000.excalidraw',name:'Original fixture.excalidraw',
            mimeType:'application/vnd.excalidraw+json',size:${Buffer.byteLength(fixture)}}},
          token:{accessToken:'synthetic-fixture-token',expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:['file.read']}
        },location.origin);
        if(event.data.type==='verentis:collaboration:request')event.source.postMessage({
          type:'verentis:collaboration:response',version:1,sessionId:'desktop-fixture',requestId:event.data.requestId,
          error:'Read-only fixture: native service not connected.',code:'UNAVAILABLE'
        },location.origin);
      });
    </script></body></html>`,
  }))
  await page.route('**/v1/files/raw/desktop-1000.excalidraw?*', route => route.fulfill({ body: fixture, contentType: 'application/vnd.excalidraw+json' }))
  await page.goto('/desktop-1000-host')
  const app = page.frameLocator('iframe')
  await expect(app.locator('.excalidraw canvas').first()).toBeVisible()
  await expect(app.getByRole('status')).toContainText('Read-only fixture')
  const download = page.waitForEvent('download')
  await app.getByRole('button', { name: 'Download document' }).click()
  const contents: Buffer[] = []
  const downloaded = await (await download).createReadStream()
  for await (const chunk of downloaded!) contents.push(Buffer.from(chunk))
  const loaded = JSON.parse(Buffer.concat(contents).toString('utf8')) as { elements: Array<{ type: string }> }
  expect(loaded.elements).toHaveLength(1000)
  expect(loaded.elements.every(element => element.type === 'rectangle')).toBe(true)
  const frame = page.frames()[1]!
  await frame.evaluate(async () => { await document.fonts.ready })
  const viewport = await frame.evaluate(() => ({
    width: innerWidth, height: innerHeight, devicePixelRatio,
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
  }))
  expect(viewport.width).toBe(1440)
  expect(viewport.height).toBe(900)
  const bounds = (await app.locator('.excalidraw canvas').first().boundingBox())!
  await page.screenshot({ path: resolve(out, 'before.png') })
  const cdp = await page.context().newCDPSession(page)
  const version = await cdp.send('Browser.getVersion')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const captures: Capture[] = []
  cdp.on('Page.screencastFrame', event => {
    if (event.metadata.timestamp !== undefined) captures.push({ timestamp: event.metadata.timestamp * 1000, data: event.data })
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  })
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.frame',
    transferMode: 'ReturnAsStream',
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 720, maxHeight: 450, everyNthFrame: 1 })
  const anchor = await frame.evaluate(() => {
    const mark = performance.mark('verentis-clock-anchor')
    return performance.timeOrigin + mark.startTime
  })
  await frame.evaluate(() => {
    const target = document.querySelector('.excalidraw canvas')
    const prototype = CanvasRenderingContext2D.prototype
    const save = prototype.save
    const restore = prototype.restore
    const depths = new WeakMap<CanvasRenderingContext2D, number>()
    let input = 0
    let completed = 0
    const mark = (kind: string) => { performance.mark(`verentis-input:${kind}:${++input}`) }
    const pointer = (event: PointerEvent) => {
      if (event.isTrusted && event.buttons === 1 && (event.movementX !== 0 || event.movementY !== 0) &&
          event.target instanceof HTMLCanvasElement) mark('pan')
    }
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return
      const label = event.target.closest('button')?.getAttribute('aria-label')
      if (label === 'Zoom in' || label === 'Zoom out') mark('zoom')
    }
    prototype.save = function () { depths.set(this, (depths.get(this) ?? 0) + 1); save.call(this) }
    prototype.restore = function () {
      restore.call(this)
      const depth = Math.max(0, (depths.get(this) ?? 1) - 1)
      depths.set(this, depth)
      if (this.canvas === target && depth === 0 && input > completed) {
        completed = input
        const id = input
        queueMicrotask(() => performance.mark(`verentis-render:${id}`))
      }
    }
    window.addEventListener('pointermove', pointer, true)
    window.addEventListener('click', click, true)
    Object.assign(window, { stopFixtureMeasurement: () => {
      prototype.save = save
      prototype.restore = restore
      window.removeEventListener('pointermove', pointer, true)
      window.removeEventListener('click', click, true)
    } })
  })
  const began = performance.now()
  let gesture = 0
  let atHigh = true
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .65)
  await page.mouse.down()
  while (performance.now() - began < 10_000) {
    gesture++
    await page.mouse.move(bounds.x + bounds.width * (atHigh ? .4 : .7), bounds.y + bounds.height * (atHigh ? .4 : .65), { steps: 20 })
    atHigh = !atHigh
    if (gesture % 3 === 0) {
      await page.mouse.up()
      await app.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await page.waitForTimeout(500)
      await app.getByRole('button', { name: 'Zoom out', exact: true }).click()
      await page.waitForTimeout(500)
      await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .65)
      atHigh = true
      await page.mouse.down()
    }
    await page.waitForTimeout(100)
  }
  await page.mouse.up()
  for (let i = 0; i < 15; i++) {
    await app.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await page.waitForTimeout(500)
    await app.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await page.waitForTimeout(500)
  }
  const measurementDurationMs = performance.now() - began
  await page.waitForTimeout(300)
  await frame.evaluate(() => (window as unknown as { stopFixtureMeasurement(): void }).stopFixtureMeasurement())
  await cdp.send('Page.stopScreencast')
  const done = new Promise<{ stream?: string }>(resolveDone => cdp.once('Tracing.tracingComplete', resolveDone))
  await cdp.send('Tracing.end')
  const { stream } = await done
  if (!stream) throw new Error('Chromium did not return the renderer trace.')
  const chunks: Buffer[] = []
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream })
    chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'))
    if (chunk.eof) break
  }
  await cdp.send('IO.close', { handle: stream })
  const trace = Buffer.concat(chunks)
  await writeFile(resolve(out, 'renderer-trace.json.gz'), gzipSync(trace))
  await page.screenshot({ path: resolve(out, 'after.png') })
  const events = (JSON.parse(trace.toString()) as { traceEvents: TraceEvent[] }).traceEvents
  const origin = events.find(event => event.name === 'verentis-clock-anchor')!
  const offset = anchor - origin.ts / 1000
  const inputs = events.filter(event => /^verentis-input:(pan|zoom):\d+$/.test(event.name))
    .map(event => ({ id: Number(event.name.split(':')[2]), kind: event.name.split(':')[1]!, timestamp: event.ts / 1000 + offset }))
    .sort((a, b) => a.timestamp - b.timestamp)
  const renders = events.filter(event => /^verentis-render:\d+$/.test(event.name))
    .map(event => ({ id: Number(event.name.split(':')[1]), timestamp: event.ts / 1000 + offset }))
    .sort((a, b) => a.timestamp - b.timestamp)
  const contentCrop = { x: bounds.x + 80, y: bounds.y + 120, width: 240, height: 150 }
  const hashes: number[] = []
  for (let start = 0; start < captures.length; start += 16) {
    hashes.push(...await page.evaluate(async ({ images, crop, screen }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 90
      const context = canvas.getContext('2d')!
      const values: number[] = []
      for (const data of images) {
        const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
        context.drawImage(image, crop.x * image.width / screen.width, crop.y * image.height / screen.height,
          crop.width * image.width / screen.width, crop.height * image.height / screen.height, 0, 0, 160, 90)
        let hash = 2166136261
        for (const byte of context.getImageData(0, 0, 160, 90).data) hash = Math.imul(hash ^ byte, 16777619)
        values.push(hash >>> 0)
        image.close()
      }
      return values
    }, { images: captures.slice(start, start + 16).map(capture => capture.data), crop: contentCrop, screen: { width: 1440, height: 900 } }))
  }
  const painted = captures.map((capture, i) => ({ timestamp: capture.timestamp, hash: hashes[i]! }))
    .filter((capture, i, all) => i === 0 || capture.hash !== all[i - 1]!.hash)
  const samples = inputs.flatMap(input => {
    const paint = painted.find(paint => paint.timestamp >= input.timestamp)
    return paint ? [{ ...input, paintTimestamp: paint.timestamp, latencyMs: paint.timestamp - input.timestamp }] : []
  })
  const packageJSON = JSON.parse(await readFile('package.json', 'utf8')) as { dependencies: Record<string, string> }
  const sdk = packageJSON.dependencies['@verentis/sdk']!.slice('file:'.length)
  const metrics = {
    inputCount: inputs.length, confirmedPaintSamples: samples.length,
    panSamples: samples.filter(sample => sample.kind === 'pan').length,
    zoomSamples: samples.filter(sample => sample.kind === 'zoom').length,
    compositorFrames: captures.length, changedCanvasFrames: painted.length,
    p95InputToNextPaintMs: p95(samples.map(sample => sample.latencyMs)),
    p95PanInputToNextPaintMs: p95(samples.filter(sample => sample.kind === 'pan').map(sample => sample.latencyMs)),
    p95ZoomInputToNextPaintMs: p95(samples.filter(sample => sample.kind === 'zoom').map(sample => sample.latencyMs)),
    measurementDurationMs,
  }
  const passed = samples.length > 100 && metrics.panSamples > 0 && metrics.zoomSamples >= 30 &&
    metrics.p95InputToNextPaintMs <= 100 && metrics.p95PanInputToNextPaintMs <= 100 &&
    metrics.p95ZoomInputToNextPaintMs <= 100 && errors.length === 0 && external.length === 0
  await writeFile(resolve(out, 'report.json'), JSON.stringify({
    schemaVersion: 1, scenarioId: scenario, status: passed ? 'passed' : 'failed', recordedAt: new Date().toISOString(),
    environment: { browser: version, viewport, headless: true, cpuThrottlingRate: 1,
      compositorEvidence: { width: 720, height: 450, jpegQuality: 40, everyNthFrame: 1, reason: 'Downsample evidence only; reduce readback overhead while renderer remains 1440×900.' },
      os: platform(), kernel: release(),
      node: process.version, availableLogicalCpus: availableParallelism(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], totalMemoryBytes: totalmem(),
      sdkArtifact: sdk, sdkSHA256: createHash('sha256').update(await readFile(sdk)).digest('hex') },
    fixture: { elements: 1000, rectangles: 1000, loadedElementCount: loaded.elements.length, layout: '40 columns × 25 rows; original 100×80 spacing, 80×60 rectangles',
      sha256: createHash('sha256').update(fixture).digest('hex'), path: '../original.excalidraw' },
    metrics, target: { p95InputToNextPaintMs: 100 },
    checks: [
      { id: 'loaded-original-fixture', actual: loaded.elements.length, expected: 1000, passed: loaded.elements.length === 1000 },
      { id: 'pan-p95-ms', actual: metrics.p95PanInputToNextPaintMs, maximum: 100, passed: metrics.p95PanInputToNextPaintMs <= 100 },
      { id: 'zoom-p95-ms', actual: metrics.p95ZoomInputToNextPaintMs, maximum: 100, passed: metrics.p95ZoomInputToNextPaintMs <= 100 },
      { id: 'combined-p95-ms', actual: metrics.p95InputToNextPaintMs, maximum: 100, passed: metrics.p95InputToNextPaintMs <= 100 },
      { id: 'javascript-errors', actual: errors.length, expected: 0, passed: errors.length === 0 },
      { id: 'external-requests', actual: external.length, expected: 0, passed: external.length === 0 },
    ],
    definition: 'Trusted pan pointermove or zoom click capture to first subsequent Chromium compositor frame with changed pixels in a fixed document-content crop away from the cursor and toolbar. Coalesced inputs share their next content paint. This confirms compositor paint, including CSS-transformed cached canvas, not hardware display telemetry or a two-rAF opportunity proxy.',
    documentContentCrop: contentCrop,
    workload: 'At least 10 seconds of trusted direct drag-pan on the read-only surface, followed by 30 additional zoom clicks for separate p95 coverage; zoom transitions settle for 500 ms before the next gesture. Destinations alternate from the actual reset position, zero-displacement pointer events are excluded, and no Space shortcut is sent to focused zoom controls.',
    diagnosticBoundary: 'Retained failed diagnostic runs counted stationary post-zoom pointer moves awaiting paints that should not occur and also required static 2D redraw instead of compositor content paint. Their traces are retained. This settled direct-drag scenario does not establish responsiveness for overlapping zoom/pan or Space shortcuts while toolbar controls retain focus.',
    evidence: ['before.png', 'after.png', 'renderer-trace.json.gz', 'paint-samples.json', 'unit-tests.json'],
    testBoundary: { renderer: 'real upstream React island in Nuxt/Vue', host: 'synthetic local handshake and file fixture', native: 'not connected; deliberately read-only',
      installedPlatformMultiplayer: 'not_run: real native service is gated by SF/signed consent/Node epoch contracts',
      creation: 'Default disabled until an operator verifies and configures the matching HTTPS API base. Separate browser smoke explicitly opts in only intercepted synthetic Node responses; no deployed endpoint acceptance.' },
    errors, externalRequests: external,
  }, null, 2))
  await writeFile(resolve(out, 'paint-samples.json'), JSON.stringify({ inputs, renders, frames: painted, samples }, null, 2))
  console.log(JSON.stringify(metrics))
  expect(errors).toEqual([])
  expect(external).toEqual([])
  expect(samples.length).toBeGreaterThan(100)
  expect(metrics.zoomSamples).toBeGreaterThanOrEqual(30)
  expect(metrics.p95InputToNextPaintMs).toBeLessThanOrEqual(100)
  expect(metrics.p95PanInputToNextPaintMs).toBeLessThanOrEqual(100)
  expect(metrics.p95ZoomInputToNextPaintMs).toBeLessThanOrEqual(100)
})
