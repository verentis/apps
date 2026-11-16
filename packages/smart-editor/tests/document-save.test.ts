import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useDocumentSave } from '../app/composables/useDocumentSave'

describe('document saving', () => {
  it('persists the submitted snapshot without marking later edits saved', async () => {
    const content = ref('first')
    const original = ref('')
    let complete!: () => void
    const write = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
    const document = useDocumentSave(content, original, write)
    const request = document.save()
    content.value = 'second'
    await expect(document.save()).rejects.toThrow('already in progress')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('first')
    complete()
    await request
    expect(original.value).toBe('first')
    expect(document.dirty.value).toBe(true)
    expect(document.saving.value).toBe(false)
  })

  it('reports a failed write and retains unsaved content', async () => {
    const original = ref('old')
    const document = useDocumentSave(ref('new'), original, async () => { throw new Error('Write denied') })
    await expect(document.save()).rejects.toThrow('Write denied')
    expect(original.value).toBe('old')
    expect(document.saveError.value).toBe('Write denied')
    expect(document.dirty.value).toBe(true)
    expect(document.saving.value).toBe(false)
  })

  it('clears dirty only after persistence and skips clean saves', async () => {
    const write = vi.fn(async () => {})
    const document = useDocumentSave(ref('new'), ref('old'), write)
    await document.save()
    await document.save()
    expect(document.dirty.value).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
  })
})
