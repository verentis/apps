// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // The app runs inside an iframe hosted by the Verentis workspace.
  // In development mode, it can also run standalone with an API key.
  ssr: false,

  runtimeConfig: {
    public: {
      // Standalone dev mode: set these in .env to point at a Verentis API
      verentisApiUrl: process.env.NUXT_PUBLIC_VERENTIS_API_URL || '',
      verentisApiKey: process.env.NUXT_PUBLIC_VERENTIS_API_KEY || '',
    },
  },

  modules: [
    '@nuxtjs/tailwindcss',
    'shadcn-nuxt',
    '@nuxt/icon',
    '@nuxt/fonts',
    '@nuxtjs/i18n',
    '@nuxtjs/color-mode',
  ],

  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
    },
  },

  colorMode: {
    preference: 'system',
    fallback: 'light',
    classSuffix: '',
  },

  fonts: {
    provider: 'npm',
    npm: { remote: false },
    families: [
      { name: 'Inter', global: true, weights: [400, 500, 600, 700] },
    ],
  },

  i18n: {
    locales: [
      { code: 'en-US', name: 'English (US)', language: 'en-US' },
    ],
    defaultLocale: 'en-US',
  },

  shadcn: {
    prefix: '',
    componentDir: '@/components/ui',
  },

  devServer: {
    port: 3302,
    // Serve over HTTPS when the AppHost provides the shared mkcert cert (embedded in the
    // Verentis workspace iframe over https). Falls back to HTTP for standalone `npm run dev`.
    https: process.env.NUXT_HTTPS_CERT && process.env.NUXT_HTTPS_KEY
      ? { cert: process.env.NUXT_HTTPS_CERT, key: process.env.NUXT_HTTPS_KEY }
      : false,
  },

  vite: {
    server: {
      allowedHosts: true,
    },
    optimizeDeps: {
      include: ['monaco-editor'],
    },
  },
})
