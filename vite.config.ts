import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      name: 'DataArrayVue',
      fileName: 'dataarray',
      formats: ['umd']
    },
    rollupOptions: {
      output: {
        globals: {
          vue: 'Vue'
        }
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false
  }
})
