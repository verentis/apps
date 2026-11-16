import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NUXT_HTTPS_CERT', undefined)
  vi.stubEnv('NUXT_HTTPS_KEY', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Nuxt development configuration', () => {
  it('preserves ordinary HTTP development without an injected certificate pair', async () => {
    const { default: config } = await import('../nuxt.config')
    expect(config.devServer).toEqual({ port: 3303 })
  })
  it('passes the exact injected certificate and key paths to the HTTPS listener', async () => {
    vi.stubEnv('NUXT_HTTPS_CERT', '/owned-local/certificate.pem')
    vi.stubEnv('NUXT_HTTPS_KEY', '/owned-local/private-key.pem')
    const { default: config } = await import('../nuxt.config')
    expect(config.devServer).toEqual({
      port: 3303,
      https: { cert: '/owned-local/certificate.pem', key: '/owned-local/private-key.pem' },
    })
    expect(config.runtimeConfig?.public?.createOnlyApiUrl).toBe('')
  })
  it('rejects incomplete injected pairs instead of silently falling back to HTTP', async () => {
    for (const variable of ['NUXT_HTTPS_CERT', 'NUXT_HTTPS_KEY'] as const) {
      vi.resetModules()
      vi.stubEnv('NUXT_HTTPS_CERT', undefined)
      vi.stubEnv('NUXT_HTTPS_KEY', undefined)
      vi.stubEnv(variable, '/owned-local/incomplete.pem')
      await expect(import('../nuxt.config')).rejects.toThrow(
        'Nuxt dev HTTPS requires both NUXT_HTTPS_CERT and NUXT_HTTPS_KEY.',
      )
    }
  })
  it('resolves hoisted editor and renderer imports to the same app-owned React instance', async () => {
    const { default: config } = await import('../nuxt.config')
    expect(config.vite?.resolve?.dedupe).toEqual(['react', 'react-dom'])
    const root = process.cwd()
    // Exercise Vite in Node, outside happy-dom's transformed dependency environment.
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import { createRequire } from 'node:module'
      import { createServer } from 'vite'
      const root = process.cwd()
      const appRequire = createRequire(root + '/package.json')
      const server = await createServer({
        configFile: false, root, cacheDir: root + '/.cache/vite-react-resolution',
        logLevel: 'silent', resolve: { dedupe: JSON.parse(process.argv[1]) },
        server: { middlewareMode: true, watch: null, hmr: false },
        optimizeDeps: { noDiscovery: true, include: [] },
      })
      try {
        for (const importer of [appRequire.resolve('@excalidraw/excalidraw'), appRequire.resolve('react-dom/client')]) {
          assert.equal((await server.pluginContainer.resolveId('react', importer))?.id, appRequire.resolve('react'))
          assert.equal((await server.pluginContainer.resolveId('react-dom/client', importer))?.id, appRequire.resolve('react-dom/client'))
        }
        console.log('Shared React instance verified.')
      } finally {
        await server.close()
      }
    `, JSON.stringify(config.vite?.resolve?.dedupe)], { cwd: root, encoding: 'utf8', timeout: 15_000 })
    expect(output.trim()).toBe('Shared React instance verified.')
  })
})
