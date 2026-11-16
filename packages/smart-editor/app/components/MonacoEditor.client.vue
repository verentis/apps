<script setup lang="ts">
import * as monaco from 'monaco-editor'

const props = defineProps<{
  modelValue: string
  language: string
  readOnly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null

const colorMode = useColorMode()

onMounted(() => {
  if (!containerRef.value) return

  editor = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: props.language,
    theme: colorMode.value === 'dark' ? 'vs-dark' : 'vs',
    readOnly: props.readOnly ?? false,
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineNumbers: 'on',
    wordWrap: 'on',
    tabSize: 2,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    padding: { top: 8, bottom: 8 },
  })

  editor.onDidChangeModelContent(() => {
    const value = editor?.getValue() ?? ''
    emit('update:modelValue', value)
  })
})

// Sync theme with color mode
watch(() => colorMode.value, (mode) => {
  monaco.editor.setTheme(mode === 'dark' ? 'vs-dark' : 'vs')
})

// Sync language changes
watch(() => props.language, (lang) => {
  const model = editor?.getModel()
  if (model) {
    monaco.editor.setModelLanguage(model, lang)
  }
})

// Sync external value changes (e.g., file reload)
watch(() => props.modelValue, (newValue) => {
  if (!editor) return
  const currentValue = editor.getValue()
  if (currentValue !== newValue) {
    editor.setValue(newValue)
  }
})

onUnmounted(() => {
  editor?.dispose()
  editor = null
})
</script>

<template>
  <div ref="containerRef" class="h-full w-full" />
</template>
