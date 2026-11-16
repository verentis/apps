import { vi } from 'vitest'

// Upstream feature detection needs a 2D context even for serializer-only tests.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  filter: 'none',
  measureText: (text: string) => ({ width: text.length * 8 }),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext

vi.stubGlobal('FontFace', class {
  family: string
  status = 'loaded'
  constructor(family: string) { this.family = family }
  async load() { return this }
})
