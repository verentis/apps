import { defineNuxtConfig } from 'nuxt/config'

const certificate = process.env.NUXT_HTTPS_CERT
const privateKey = process.env.NUXT_HTTPS_KEY
if (Boolean(certificate) !== Boolean(privateKey)) {
  throw new Error('Nuxt dev HTTPS requires both NUXT_HTTPS_CERT and NUXT_HTTPS_KEY.')
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  devtools: { enabled: false },
  typescript: { strict: true },
  runtimeConfig: { public: { createOnlyApiUrl: '' } },
  app: { head: { title: 'Excalidraw', htmlAttrs: { lang: 'en' } } },
  css: ['~/assets/app.css'],
  devServer: {
    port: 3303,
    ...(certificate && privateKey ? { https: { cert: certificate, key: privateKey } } : {}),
  },
  vite: {
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: { include: ['react', 'react-dom/client', '@excalidraw/excalidraw'] },
  },
})
