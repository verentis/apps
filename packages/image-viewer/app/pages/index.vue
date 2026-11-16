<script setup lang="ts">
const { client, context, loading, error } = useVerentis()

const imageUrl = ref<string | null>(null)
const imageError = ref(false)
const zoom = ref(1)
const rotation = ref(0)

const MIN_ZOOM = 0.1
const MAX_ZOOM = 10

// Once the SDK is connected, build the image URL
watch(
  () => client.value,
  async (c) => {
    if (!c || !context.value) return
    try {
      const blob = await c.files.readContent(context.value.file.path)
      imageUrl.value = URL.createObjectURL(blob)
    } catch (e: any) {
      console.error('[ImageViewer] Failed to load image:', e)
      imageError.value = true
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value)
  }
})

function zoomIn() {
  zoom.value = Math.min(zoom.value * 1.25, MAX_ZOOM)
}

function zoomOut() {
  zoom.value = Math.max(zoom.value / 1.25, MIN_ZOOM)
}

function resetView() {
  zoom.value = 1
  rotation.value = 0
}

function rotateRight() {
  rotation.value = (rotation.value + 90) % 360
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    if (event.deltaY < 0) {
      zoomIn()
    } else {
      zoomOut()
    }
  }
}

const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`)

const imageTransform = computed(() =>
  `scale(${zoom.value}) rotate(${rotation.value}deg)`,
)
</script>

<template>
  <div class="flex h-screen flex-col bg-background">
    <!-- Loading -->
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center gap-2 text-muted-foreground"
    >
      <icon name="lucide:loader-2" class="size-5 animate-spin" />
      <span class="text-sm">Loading image...</span>
    </div>

    <!-- SDK Error -->
    <div
      v-else-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <icon name="lucide:triangle-alert" class="size-8 text-destructive" />
      <p class="text-sm font-medium">Failed to connect</p>
      <p class="text-xs text-muted-foreground">{{ error }}</p>
    </div>

    <!-- Image Error -->
    <div
      v-else-if="imageError"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <icon name="lucide:image-off" class="size-8 text-muted-foreground" />
      <p class="text-sm font-medium">Could not load image</p>
      <p v-if="context" class="text-xs text-muted-foreground">{{ context.file.name }}</p>
    </div>

    <!-- Image viewer -->
    <template v-else-if="imageUrl">
      <!-- Toolbar -->
      <div class="flex items-center justify-between border-b px-3 py-1.5">
        <span class="text-xs text-muted-foreground">
          {{ context?.file.name }}
        </span>
        <div class="flex items-center gap-1">
          <button
            class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Zoom out"
            @click="zoomOut"
          >
            <icon name="lucide:zoom-out" class="size-4" />
          </button>
          <span class="min-w-[3rem] text-center text-xs text-muted-foreground">
            {{ zoomPercent }}
          </span>
          <button
            class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Zoom in"
            @click="zoomIn"
          >
            <icon name="lucide:zoom-in" class="size-4" />
          </button>
          <div class="mx-1 h-4 w-px bg-border" />
          <button
            class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Rotate"
            @click="rotateRight"
          >
            <icon name="lucide:rotate-cw" class="size-4" />
          </button>
          <button
            class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Reset view"
            @click="resetView"
          >
            <icon name="lucide:maximize" class="size-4" />
          </button>
        </div>
      </div>

      <!-- Canvas -->
      <div
        class="flex flex-1 items-center justify-center overflow-auto bg-muted/30"
        @wheel="onWheel"
      >
        <img
          :src="imageUrl"
          :alt="context?.file.name ?? 'Image'"
          class="max-w-none object-contain transition-transform duration-150"
          :style="{ transform: imageTransform }"
          draggable="false"
        >
      </div>
    </template>
  </div>
</template>
