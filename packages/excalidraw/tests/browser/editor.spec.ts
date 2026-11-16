import { expect, test, type Page } from '@playwright/test'

test.beforeEach(() => {
  test.info().annotations.push({
    type: 'test-boundary',
    description: 'Real Chromium/Nuxt/upstream React/pinned SDK; parent handshakes and workspace/native API fixtures are synthetic. No installed-platform multiplayer or real workspace writes.',
  })
})
async function host(page: Page, surface: 'file' | 'workspace', apiUrl?: string) {
  const apiExpression = apiUrl ? JSON.stringify(apiUrl) : surface === 'workspace' ? "'https://workspace.synthetic.test'" : 'location.origin'
  await page.route('**/test-host', route => route.fulfill({
    contentType: 'text/html',
    body: `<html><body style="margin:0"><iframe src="/" style="width:100vw;height:100vh;border:0"></iframe><script>
      window.messages = [];
      window.addEventListener('message', event => {
        if(event.source !== document.querySelector('iframe').contentWindow) return;
        window.messages.push(event.data);
        if(event.data.type === 'verentis:collaboration:request') event.source.postMessage({
          type:'verentis:collaboration:response',version:1,sessionId:'test-session',requestId:event.data.requestId,
          error:'Read-only: native collaboration unavailable in this fixture.',code:'unsupported'
        }, location.origin);
        if(event.data.type === 'verentis:ready') event.source.postMessage({
          type:'verentis:init',version:1,sessionId:'test-session',
          context:{surface:'${surface}',workspace:{id:'test-workspace',slug:'test',name:'Test'},apiUrl:${apiExpression},
          ${surface === 'file' ? "file:{path:'test.excalidraw',name:'Test.excalidraw',mimeType:'application/vnd.excalidraw+json',size:1}," : ''}},
          token:{accessToken:'synthetic-test-token',expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:['file.read']}
        }, location.origin);
      });
    </script></body></html>`,
  }))
  await page.goto('/test-host')
  return page.frameLocator('iframe')
}

test('direct access is not an anonymous editor', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('authenticated Verentis workspace')
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('workspace launch pages listings and uses host navigation', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/v1/files/?*', route => {
    requests.push(route.request().url())
    return route.fulfill({ json: { children: [
      { path: 'test.excalidraw', name: 'Test.excalidraw', size: 200, mimeType: 'application/vnd.excalidraw+json' },
      { path: 'note.txt', name: 'Note', size: 20, mimeType: 'text/plain' },
    ] } })
  })
  const app = await host(page, 'workspace')
  await expect(app.getByRole('button', { name: 'New document', exact: true })).toBeEnabled()
  await app.getByRole('button', { name: 'Test.excalidraw' }).click()
  expect(requests[0]).toContain('pageSize=50')
  await expect.poll(() => page.evaluate(() => (window as unknown as { messages: Array<{ type: string; path: string }> }).messages
    .some(message => message.type === 'verentis:navigate' && message.path === 'test.excalidraw'))).toBe(true)
  await expect(app.getByRole('button', { name: 'Note', exact: true })).toHaveCount(0)
})

test('workspace creation stays disabled for an unverified API target', async ({ page }) => {
  let writes = 0
  await page.route('**/v1/files/**', route => {
    if (route.request().method() === 'POST') writes++
    return route.fulfill({ json: { children: [] } })
  })
  const app = await host(page, 'workspace', 'https://unverified.synthetic.test')
  await expect(app.getByRole('button', { name: 'New document', exact: true })).toBeDisabled()
  await expect(app.getByRole('status')).toContainText('verified create-only support on this API target')
  expect(writes).toBe(0)
})

test('workspace creation sends a conditional portable upload and never retries a collision', async ({ page }) => {
  let collision = false
  const uploads: Array<{ path: string; condition: string | undefined; body: string }> = []
  await page.route('**/v1/files/**', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: { children: [] } })
    uploads.push({
      path: decodeURIComponent(new URL(request.url()).pathname.slice('/v1/files/'.length)),
      condition: request.headers()['if-none-match'], body: request.postData() ?? '',
    })
    return collision
      ? route.fulfill({ status: 412, contentType: 'application/problem+json', json: { status: 412, title: 'precondition_failed', code: 'precondition_failed', exists: true, detail: 'A file already exists.' } })
      : route.fulfill({ status: 204, body: '' })
  })
  const app = await host(page, 'workspace')
  await expect(app.getByRole('button', { name: 'New document', exact: true })).toBeEnabled()
  await app.getByLabel('Document name').fill('Board & 50% 日本')
  await app.getByRole('button', { name: 'New document', exact: true }).click()
  await expect.poll(() => uploads.length).toBe(1)
  expect(uploads[0]!.condition).toBe('*')
  expect(uploads[0]!.path).toMatch(/^Board & 50% 日本-[a-f0-9-]+\.excalidraw$/)
  expect(uploads[0]!.body).toMatch(/"type"\s*:\s*"excalidraw"/)
  expect(uploads[0]!.body).toContain('application/vnd.excalidraw+json')
  await expect.poll(() => page.evaluate(path => (window as unknown as { messages: Array<{ type: string; path?: string }> }).messages
    .some(message => message.type === 'verentis:navigate' && message.path === path), uploads[0]!.path)).toBe(true)
  collision = true
  await app.getByLabel('Document name').fill('Existing')
  await app.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(app.getByRole('alert')).toContainText('A file already exists.')
  expect(uploads).toHaveLength(2)
  expect(uploads[1]!.condition).toBe('*')
  const navigationCount = await page.evaluate(() => (window as unknown as { messages: Array<{ type: string }> }).messages
    .filter(message => message.type === 'verentis:navigate').length)
  expect(navigationCount).toBe(1)
})

test('real React island renders 1000 elements with local fonts, exports and cleans up', async ({ page }) => {
  const errors: string[] = []
  const external: string[] = []
  const fonts: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:3303') && !request.url().startsWith('data:')) external.push(request.url())
    if (request.url().includes('/excalidraw-assets/fonts/')) fonts.push(request.url())
  })
  const elements = Array.from({ length: 1000 }, (_, i) => ({
    id: `fixture-${i}`, type: 'rectangle', x: i % 40 * 100, y: Math.floor(i / 40) * 80,
    width: 80, height: 60, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
    fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: i + 1, version: 1, versionNonce: i + 1,
    isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
  }))
  const fixtureElements = [{
    ...elements[0], type: 'text', width: 200, height: 23, text: 'Synthetic fixture', originalText: 'Synthetic fixture',
    fontFamily: 5, fontSize: 20, textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25,
  }, ...elements.slice(1)]
  await page.route('**/v1/files/raw/test.excalidraw?*', route => route.fulfill({
    json: { type: 'excalidraw', version: 2, source: 'synthetic-test', elements: fixtureElements, appState: { viewBackgroundColor: '#ffffff' }, files: {} },
  }))
  const app = await host(page, 'file')
  await expect(app.locator('.excalidraw canvas').first()).toBeVisible({ timeout: 30000 })
  await expect.poll(() => fonts.some(url => url.includes('/Excalifont/'))).toBe(true)
  await expect(app.getByRole('status')).toContainText('Read-only')
  const documentDownload = page.waitForEvent('download')
  await app.getByRole('button', { name: 'Download document' }).click()
  expect((await documentDownload).suggestedFilename()).toBe('Test.excalidraw')
  const svgDownload = page.waitForEvent('download')
  await app.getByRole('button', { name: 'Export SVG' }).click()
  expect((await svgDownload).suggestedFilename()).toBe('Test.svg')
  const pngDownload = page.waitForEvent('download')
  await app.getByRole('button', { name: 'Export PNG' }).click()
  expect((await pngDownload).suggestedFilename()).toBe('Test.png')
  expect(errors).toEqual([])
  expect(external).toEqual([])
  await page.goto('/')
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('synthetic authenticated bridge drives two real islands, durable Save and disconnect pause', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/native-host', route => route.fulfill({
    contentType: 'text/html',
    body: `<html><body style="display:flex;margin:0">
    <iframe src="/" style="width:50vw;height:100vh;border:0"></iframe>
    <iframe src="/" style="width:50vw;height:100vh;border:0"></iframe>
    <script>
      window.messages=[]; window.sequence=20; window.savedSequence=20;
      window.scene={elements:[],files:{},appState:{viewBackgroundColor:'#ffffff'}};
      window.addEventListener('message', event => {
        const index=Array.from(document.querySelectorAll('iframe')).findIndex(frame=>frame.contentWindow===event.source);
        if(index<0)return;
        const id='native-session-'+index;
        window.messages.push(event.data);
        const snapshot=()=>({sequence:window.sequence,savedSequence:window.savedSequence,revision:'revision-'+window.savedSequence,
          readOnly:false,scene:window.scene,participants:[{id:'participant-0',name:'Alice',readOnly:false,pointer:null},{id:'participant-1',name:'Bob',readOnly:false,pointer:null}]});
        if(event.data.type==='verentis:ready')event.source.postMessage({
          type:'verentis:init',version:1,sessionId:id,
          context:{surface:'file',workspace:{id:'test-workspace',slug:'test',name:'Test'},apiUrl:location.origin,
            file:{path:'native.excalidraw',name:'Native.excalidraw',mimeType:'application/vnd.excalidraw+json',size:1}},
          token:{accessToken:'synthetic-test-token',expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:['file.read']}
        },location.origin);
        if(event.data.type==='verentis:collaboration:request'){
          const command=event.data.command;
          if(command.operation==='apply'){
            if(command.changes.appState && window.backgroundWinnerBeforeNextApply){
              window.backgroundWinnerBeforeNextApply=false;
              window.sequence++;
              window.savedSequence=window.sequence;
              window.scene={...window.scene,appState:{viewBackgroundColor:'#aabbcc'}};
            }
            if(command.changes.appState && command.changes.appStateExpectedSequence!==window.sequence){
              event.source.postMessage({type:'verentis:collaboration:response',version:1,sessionId:id,
                requestId:event.data.requestId,error:'Synthetic stale background sequence',code:'CONFLICT'},location.origin);
              return;
            }
            if(window.rejectApply){
              event.source.postMessage({type:'verentis:collaboration:response',version:1,sessionId:id,
                requestId:event.data.requestId,error:'Synthetic same-element conflict',code:'CONFLICT'},location.origin);
              return;
            }
            const elements=new Map(window.scene.elements.map(element=>[element.id,element]));
            for(const change of command.changes.changes)change.element?elements.set(change.id,change.element):elements.delete(change.id);
            window.scene={elements:[...elements.values()],appState:command.changes.appState||window.scene.appState,files:command.changes.files||window.scene.files};
            window.sequence++;
          }
          if(command.operation==='save')window.savedSequence=window.sequence;
          const result=command.operation==='close'?null:snapshot();
          if(command.operation==='save')result.receipt={generation:command.generation,correlation:command.correlation,revision:'immutable-captured-commit-'+window.savedSequence};
          event.source.postMessage({type:'verentis:collaboration:response',version:1,sessionId:id,requestId:event.data.requestId,result},location.origin);
        }
      });
    </script></body></html>`,
  }))
  await page.route('**/v1/files/raw/native.excalidraw?*', route => route.fulfill({
    json: { type: 'excalidraw', version: 2, source: 'synthetic-test', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} },
  }))
  await page.goto('/native-host')
  const first = page.frameLocator('iframe').nth(0)
  const second = page.frameLocator('iframe').nth(1)
  await expect.poll(() => page.evaluate(() => (window as unknown as { messages: Array<{ type: string }> }).messages
    .some(message => message.type === 'verentis:collaboration:request'))).toBe(true)
  await expect(first.getByRole('status')).toContainText('Saved')
  await expect(second.getByRole('status')).toContainText('2 participants')
  const canvas = first.locator('.excalidraw canvas').first()
  await expect(canvas).toBeVisible()
  const bounds = (await canvas.boundingBox())!
  await first.getByRole('radio', { name: 'Rectangle', exact: true }).locator('..').click()
  await page.mouse.move(bounds.x + 450, bounds.y + 300)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 600, bounds.y + 420, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as unknown as { scene: { elements: unknown[] } }).scene.elements.length)).toBe(1)
  await expect(second.getByRole('status')).toContainText('Unsaved changes')
  let peerElements: Array<{ type: string }> = []
  await expect.poll(async () => {
    const download = page.waitForEvent('download')
    await second.getByRole('button', { name: 'Download document' }).click()
    const stream = await (await download).createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    peerElements = JSON.parse(Buffer.concat(chunks).toString('utf8')).elements
    return peerElements.length
  }).toBe(1)
  expect(peerElements[0]!.type).toBe('rectangle')
  await expect(first.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await first.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { savedSequence: number; sequence: number }).savedSequence ===
    (window as unknown as { sequence: number }).sequence)).toBe(true)
  await expect(first.getByRole('status')).toContainText('Saved')
  expect(await page.evaluate(() => (window as unknown as {
    messages: Array<{ command?: { operation: string; generation?: number } }>
  }).messages.find(message => message.command?.operation === 'save')?.command?.generation)).toBe(1)
  const backgroundDocument = await page.evaluate(() => ({
    type: 'excalidraw', version: 2, source: 'synthetic-background-intent',
    ...(window as unknown as { scene: Record<string, unknown> }).scene,
    appState: { viewBackgroundColor: '#112233' },
  }))
  const backgroundBaseline = await page.evaluate(() => {
    const host = window as unknown as { sequence: number; backgroundWinnerBeforeNextApply: boolean }
    host.backgroundWinnerBeforeNextApply = true
    return host.sequence
  })
  await first.getByLabel('Import document').setInputFiles({
    name: 'background.excalidraw', mimeType: 'application/vnd.excalidraw+json',
    buffer: Buffer.from(JSON.stringify(backgroundDocument)),
  })
  await first.getByRole('button', { name: 'Replace scene', exact: true }).click()
  await expect(first.getByRole('status')).toContainText('background edit began')
  const backgroundDownload = page.waitForEvent('download')
  await first.getByRole('button', { name: 'Download document' }).click()
  const backgroundStream = await (await backgroundDownload).createReadStream()
  const backgroundChunks: Buffer[] = []
  for await (const chunk of backgroundStream!) backgroundChunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(backgroundChunks).toString('utf8')).appState.viewBackgroundColor).toBe('#112233')
  const backgroundProof = await page.evaluate(() => {
    const host = window as unknown as {
      scene: { appState: { viewBackgroundColor: string } };
      messages: Array<{ command?: { operation: string; changes?: { appStateExpectedSequence?: number; appState?: unknown } } }>
    }
    return {
      winner: host.scene.appState.viewBackgroundColor,
      expected: host.messages.find(message => message.command?.changes?.appState)?.command?.changes?.appStateExpectedSequence,
    }
  })
  expect(backgroundProof).toEqual({ winner: '#aabbcc', expected: backgroundBaseline })
  await first.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await first.getByRole('button', { name: 'Keep local edits' }).click()
  await expect(first.getByRole('status')).toContainText('Editing paused')
  await first.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await first.getByRole('button', { name: 'Discard local edits and reconnect' }).click()
  await expect(first.getByRole('status')).toContainText('Saved')
  await page.evaluate(() => { (window as unknown as { rejectApply: boolean }).rejectApply = true })
  await first.getByRole('radio', { name: 'Rectangle', exact: true }).locator('..').click()
  await page.mouse.move(bounds.x + 300, bounds.y + 500)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 450, bounds.y + 600, { steps: 10 })
  await page.mouse.up()
  await expect(first.getByRole('status')).toContainText('server winner')
  const localDownload = page.waitForEvent('download')
  await first.getByRole('button', { name: 'Download document' }).click()
  const localStream = await (await localDownload).createReadStream()
  const localChunks: Buffer[] = []
  for await (const chunk of localStream!) localChunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(localChunks).toString('utf8')).elements).toHaveLength(2)
  expect(await page.evaluate(() => (window as unknown as { scene: { elements: unknown[] } }).scene.elements.length)).toBe(1)
  await first.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Discard local edits and reconnect' })).toBeVisible()
  await first.getByRole('button', { name: 'Keep local edits' }).click()
  await expect(first.getByRole('status')).toContainText('Editing paused')
  await first.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await first.getByRole('button', { name: 'Discard local edits and reconnect' }).click()
  await expect(first.getByRole('status')).toContainText('Saved')
  const firstFrame = page.frames().find(frame => frame.parentFrame() && frame === page.frames()[1])!
  await firstFrame.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(first.getByRole('status')).toContainText('Editing paused')
  await expect(first.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('portable embedded images survive real editor downloads and PNG export', async ({ page }) => {
  const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  await page.route('**/v1/files/raw/test.excalidraw?*', route => route.fulfill({
    json: {
      type: 'excalidraw', version: 2, source: 'synthetic-image-fixture',
      elements: [{
        id: 'image-fixture', type: 'image', x: 200, y: 200, width: 100, height: 100, angle: 0,
        strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1,
        strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
        seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1,
        link: null, locked: false, fileId: 'asset', status: 'saved', scale: [1, 1], crop: null,
      }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: { asset: { id: 'asset', mimeType: 'image/png', dataURL, created: 1 } },
    },
  }))
  const app = await host(page, 'file')
  await expect(app.locator('.excalidraw canvas').first()).toBeVisible()
  const download = page.waitForEvent('download')
  await app.getByRole('button', { name: 'Download document' }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const portable = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(portable.files.asset.dataURL).toBe(dataURL)
  expect(portable.elements[0].fileId).toBe('asset')
  const png = page.waitForEvent('download')
  await app.getByRole('button', { name: 'Export PNG' }).click()
  expect((await png).suggestedFilename()).toBe('Test.png')
})
