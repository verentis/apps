<script setup lang="ts">
import DOMPurify from 'dompurify'
import type { VerentisClient } from '@verentis/sdk'

const props = defineProps<{
  /** Raw (unsanitised) HTML produced by `useMarkdown().render()`. */
  html: string
  /** Path of the markdown file being viewed — used to resolve relative links/images. */
  basePath?: string
  /** Connected SDK client — used to fetch relative images and navigate relative links. */
  client?: VerentisClient | null
}>()

const root = ref<HTMLElement | null>(null)
let objectUrls: string[] = []

function cleanupObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls = []
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')
}

/** Resolve a relative reference against the directory of the current file. */
function resolvePath(baseDir: string, ref: string): string {
  let target = ref.split(/[?#]/)[0] ?? ref
  if (!target) return ''
  if (target.startsWith('/')) {
    target = target.slice(1)
  } else {
    target = (baseDir ? `${baseDir}/` : '') + target
  }
  const parts: string[] = []
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function onAnchorClick(event: Event) {
  const anchor = event.currentTarget as HTMLAnchorElement
  const id = decodeURIComponent((anchor.getAttribute('href') ?? '').slice(1))
  if (!id) return
  event.preventDefault()
  root.value?.querySelector(`#${cssEscape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function addCopyButton(pre: HTMLElement) {
  if (pre.querySelector('.copy-btn')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'copy-btn'
  button.setAttribute('aria-label', 'Copy code')
  button.textContent = 'Copy'
  button.addEventListener('click', async () => {
    const code = pre.querySelector('code')?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(code)
      button.textContent = 'Copied'
      button.classList.add('copied')
      setTimeout(() => {
        button.textContent = 'Copy'
        button.classList.remove('copied')
      }, 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  })
  pre.appendChild(button)
}

function enhanceLinks(el: HTMLElement) {
  el.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? ''

    if (href.startsWith('#')) {
      anchor.addEventListener('click', onAnchorClick)
      return
    }

    if (isAbsoluteUrl(href)) {
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      return
    }

    if (anchor.classList.contains('header-anchor')) return

    // Relative link to another workspace file — ask the host to navigate.
    anchor.addEventListener('click', (event) => {
      event.preventDefault()
      const target = resolvePath(dirname(props.basePath ?? ''), href)
      if (target) props.client?.bridge?.navigate(`/${target}`)
    })
  })
}

async function resolveImages(el: HTMLElement) {
  const images = Array.from(el.querySelectorAll('img'))
  for (const img of images) {
    const src = img.getAttribute('src') ?? ''
    if (!src || isAbsoluteUrl(src) || src.startsWith('data:') || src.startsWith('blob:')) continue

    if (!props.client || !props.basePath) {
      img.classList.add('img-unresolved')
      continue
    }

    const path = resolvePath(dirname(props.basePath), src)
    try {
      const blob = await props.client.files.readContent(path)
      const url = URL.createObjectURL(blob)
      objectUrls.push(url)
      img.src = url
    } catch {
      img.classList.add('img-unresolved')
      img.setAttribute('title', `Could not load image: ${src}`)
    }
  }
}

async function renderContent() {
  const el = root.value
  if (!el) return
  cleanupObjectUrls()
  el.innerHTML = DOMPurify.sanitize(props.html)
  enhanceLinks(el)
  el.querySelectorAll<HTMLElement>('pre.code-block').forEach(addCopyButton)
  await resolveImages(el)
}

onMounted(renderContent)
watch(() => props.html, renderContent)
watch(() => props.basePath, renderContent)
onUnmounted(cleanupObjectUrls)
</script>

<template>
  <div ref="root" class="markdown-body" />
</template>
