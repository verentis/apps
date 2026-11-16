import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilesModule, HttpTransport, TokenAuth } from '@verentis/sdk'
import { createDocument, createOnlyFiles, listDocuments, newDocumentPath } from '../app/lib/launcher'
import { MIME_TYPE } from '../app/lib/limits'

const uuid = '00000000-0000-4000-8000-000000000001'
afterEach(() => { vi.restoreAllMocks() })

describe('workspace launcher', () => {
  it('creates path-safe UUID-suffixed names', () => {
    expect(newDocumentPath('Plan.excalidraw', uuid)).toBe(`Plan-${uuid}.excalidraw`)
    for (const invalid of ['', '..', '../other', 'a/b', 'a\\b', '\u0000']) {
      expect(() => newDocumentPath(invalid, uuid)).toThrow()
    }
  })
  it('pages the source listing rather than assuming filtered results mean the end', async () => {
    const get = vi.fn().mockResolvedValue({ children: Array.from({ length: 50 }, (_, i) => ({
      name: i === 3 ? 'Plan.excalidraw' : `note${i}.txt`, path: `${i}`, mimeType: 'text/plain', size: 0,
    })) })
    const result = await listDocuments({ get }, 2)
    expect(result.entries).toHaveLength(1)
    expect(result.hasNext).toBe(true)
    expect(get).toHaveBeenCalledWith('', { pageNo: 2, pageSize: 50, orderBy: 'name' })
  })
  it('propagates collision and permission failures without retrying an overwrite', async () => {
    for (const status of [412, 403]) {
      const write = vi.fn().mockRejectedValue({ status })
      await expect(createDocument({ write }, 'Plan', 'blank')).rejects.toEqual({ status })
      expect(write).toHaveBeenCalledOnce()
      expect(write.mock.calls[0]![1].createOnly).toBe(true)
    }
  })
  it('writes valid portable content in one conditional operation without a preflight GET', async () => {
    const write = vi.fn()
    const get = vi.fn().mockResolvedValue({})
    const files = { write, get }
    const path = await createDocument(files, 'Plan', 'flowchart')
    expect(path).toMatch(/^Plan-[a-f0-9-]+\.excalidraw$/)
    expect(write).toHaveBeenCalledWith(path, expect.objectContaining({ contentType: MIME_TYPE, createOnly: true }))
    expect(write).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
    expect(JSON.parse(write.mock.calls[0]![1].content).type).toBe('excalidraw')
  })
  it('fails closed without a server-enforced create-only operation, including TOCTOU collisions', async () => {
    expect(createOnlyFiles({ get: vi.fn(), write: vi.fn() })).toBeNull()
    expect(createOnlyFiles({ get: vi.fn(), create: vi.fn() })).toBeNull()
    const write = vi.fn().mockRejectedValue({ status: 412 })
    await expect(createDocument({ write }, 'Plan', 'blank')).rejects.toEqual({ status: 412 })
  })
  it('uses the actual pinned SDK to send one conditional multipart write with encoded path segments', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetch)
    const files = new FilesModule(new HttpTransport('https://workspace.invalid', new TokenAuth('synthetic-token')), 'workspace-id')
    const creator = createOnlyFiles(files, 'https://workspace.invalid', 'https://workspace.invalid')
    expect(creator).not.toBeNull()
    const path = await createDocument(creator!, 'Design & 50% 日本', 'flowchart')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe(`https://workspace.invalid/v1/files/${encodeURIComponent(path)}`)
    expect(request).toMatchObject({ method: 'POST', headers: { 'If-None-Match': '*', 'X-Workspace-Id': 'workspace-id' } })
    expect(request.body).toBeInstanceOf(FormData)
    expect(JSON.parse(request.body.get('metadata'))).toMatchObject({ contentType: MIME_TYPE })
    expect(JSON.parse(await request.body.get('file').text()).type).toBe('excalidraw')
  })
  it('preserves a real SDK 412 collision without an unconditional retry', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 412, title: 'precondition_failed', code: 'precondition_failed', exists: true, detail: 'A file already exists.' }), {
      status: 412, headers: { 'Content-Type': 'application/problem+json' },
    }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetch)
    const files = new FilesModule(new HttpTransport('https://workspace.invalid', new TokenAuth('synthetic-token')), 'workspace-id')
    await expect(createDocument(createOnlyFiles(files, 'https://workspace.invalid', 'https://workspace.invalid')!, 'Existing', 'blank')).rejects.toMatchObject({ status: 412, code: 'precondition_failed', detail: 'A file already exists.' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![1].headers['If-None-Match']).toBe('*')
  })
  it('fails closed without an explicitly verified matching HTTPS API base', () => {
    const files = new FilesModule(new HttpTransport('https://workspace.invalid', new TokenAuth('synthetic-token')), 'workspace-id')
    expect(createOnlyFiles(files)).toBeNull()
    for (const [api, verified] of [
      ['https://workspace.invalid', ''],
      ['https://other.invalid', 'https://workspace.invalid'],
      ['https://workspace.invalid/api', 'https://workspace.invalid'],
      ['https://workspace.invalid/api/', 'https://workspace.invalid/api'],
      ['http://workspace.invalid', 'http://workspace.invalid'],
      ['https://user:password@workspace.invalid', 'https://user:password@workspace.invalid'],
      ['https://workspace.invalid?unverified=1', 'https://workspace.invalid?unverified=1'],
      ['https://workspace.invalid?', 'https://workspace.invalid?'],
    ]) expect(createOnlyFiles(files, api, verified)).toBeNull()
    expect(createOnlyFiles(files, 'https://workspace.invalid/api', 'https://workspace.invalid/api')).toBe(files)
  })
})
