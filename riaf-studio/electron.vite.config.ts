import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('packages/shared/src') },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('packages/main/src/index.ts') },
        external: ['better-sqlite3'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('packages/shared/src') },
    },
    build: {
      rollupOptions: {
        input: { preload: resolve('packages/preload/src/preload.ts') },
      },
    },
  },
  renderer: {
    root: resolve('packages/renderer'),
    plugins: [react()],
    resolve: {
      // Prefer TypeScript sources over stale tsc emit (.js) in src/
      extensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.json'],
      alias: {
        '@': resolve('packages/renderer/src'),
        '@shared': resolve('packages/shared/src'),
      },
    },
    css: {
      postcss: resolve('packages/renderer/postcss.config.js'),
    },
    build: {
      rollupOptions: {
        input: resolve('packages/renderer/index.html'),
      },
    },
  },
})
