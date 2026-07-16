import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://yuraive.com',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'never',
  },
})
