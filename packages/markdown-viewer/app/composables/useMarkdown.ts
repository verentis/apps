import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'

export interface TocEntry {
  level: number
  id: string
  text: string
}

export interface RenderedMarkdown {
  /** Raw (unsanitised) HTML — callers MUST sanitise before injecting into the DOM. */
  html: string
  /** Flat list of headings, in document order, for building a table of contents. */
  toc: TocEntry[]
}

/**
 * Build a GitHub-style slug for a heading. Shared between the anchor plugin
 * (which assigns the heading `id`) and the table-of-contents extraction so the
 * two always agree.
 */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

let instance: MarkdownIt | null = null

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlight(code: string, lang: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : ''
  let body: string
  if (language) {
    try {
      body = hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      body = escapeHtml(code)
    }
  } else {
    body = escapeHtml(code)
  }
  const label = escapeHtml(language || 'text')
  return `<pre class="code-block" data-lang="${label}"><code class="hljs">${body}</code></pre>`
}

function getMarkdownIt(): MarkdownIt {
  if (instance) return instance

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight,
  })

  md.use(anchor, {
    slugify,
    permalink: anchor.permalink.linkInsideHeader({
      symbol: '#',
      placement: 'before',
      ariaHidden: true,
    }),
  })

  md.use(taskLists, { label: true, labelAfter: true })

  instance = md
  return md
}

/** Pull headings (level/id/text) out of parsed tokens for a table of contents. */
function extractToc(tokens: ReturnType<MarkdownIt['parse']>): TocEntry[] {
  const toc: TocEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token?.type !== 'heading_open') continue
    const level = Number(token.tag.slice(1))
    const id = token.attrGet('id') ?? ''
    const inline = tokens[i + 1]
    let text = ''
    if (inline?.type === 'inline') {
      text = (inline.children ?? [])
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('')
        .trim()
    }
    if (id && text) toc.push({ level, id, text })
  }
  return toc
}

/**
 * Markdown rendering composable. Configures a single shared markdown-it
 * instance (GFM tables, task lists, autolinks, heading anchors, syntax
 * highlighting) and exposes a `render()` that returns both the HTML and a
 * table of contents derived from the same parse pass.
 */
export function useMarkdown() {
  const md = getMarkdownIt()

  function render(source: string): RenderedMarkdown {
    const env: Record<string, unknown> = {}
    const tokens = md.parse(source ?? '', env)
    const html = md.renderer.render(tokens, md.options, env)
    return { html, toc: extractToc(tokens) }
  }

  return { render, slugify }
}
