import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    outDir: mode === 'native' ? 'dist-native' : 'dist',
  },
  worker: {
    rollupOptions: {
      output: { entryFileNames: 'assets/worker-[hash].js' },
    },
  },
  plugins: [
    react(),
    ...(mode === 'native' ? [] : [VitePWA({
      manifest: false,
      injectRegister: 'script-defer',
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{css,html,js,png,svg,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    })]),
  ],
}))
