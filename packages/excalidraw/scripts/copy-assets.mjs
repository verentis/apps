import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const entry = require.resolve('@excalidraw/excalidraw')
const assets = join(dirname(entry), 'fonts')
await mkdir('public/excalidraw-assets', { recursive: true })
await cp(assets, 'public/excalidraw-assets/fonts', { recursive: true })
// Upstream 0.18 bundles GPL-era Liberation 1.05. Use the metric-compatible
// OFL-licensed 2.1.5 face without changing the editor engine.
await cp('vendor/fonts/VerentisSans-Regular.woff2', 'public/excalidraw-assets/fonts/Liberation/LiberationSans-Regular.woff2')
await cp('licenses', 'public/excalidraw-assets/licenses', { recursive: true })
