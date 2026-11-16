import { computed, ref, type Ref } from 'vue'

export function useDocumentSave(
  content: Ref<string>,
  original: Ref<string>,
  write: (snapshot: string) => Promise<void>,
) {
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const dirty = computed(() => content.value !== original.value)

  async function save() {
    if (saving.value) throw new Error('A save is already in progress.')
    if (!dirty.value) return
    const snapshot = content.value
    saving.value = true
    saveError.value = null
    try {
      await write(snapshot)
      original.value = snapshot
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : 'Save failed'
      throw error
    } finally {
      saving.value = false
    }
  }

  return { dirty, saving, saveError, save }
}
