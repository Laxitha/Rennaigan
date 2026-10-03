import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle everything up front so the dev server never re-optimizes mid-session.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'gsap', 'gsap/ScrollTrigger', '@gsap/react', 'three', '@phosphor-icons/react'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    // three.js is ~530 kB minified and is only fetched lazily by the 3D lens
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('gsap/ScrollTrigger')) return 'scrolltrigger'
          if (id.includes('node_modules/gsap') || id.includes('@gsap')) return 'gsap'
          if (id.includes('node_modules/react')) return 'react'
        },
      },
    },
  },
})
