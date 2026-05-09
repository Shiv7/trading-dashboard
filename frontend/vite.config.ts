import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Split heavy vendor libs into separate chunks so the initial bundle shrinks from
    // 2.1 MB (540 KB gz) to ~500 KB per chunk. Observed impact 2026-04-24: LCP 18.2s → target <4s
    // on mobile 4G by parallelizing downloads + avoiding a single-file parse blocker.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'chart-vendor': ['recharts'],
          'ui-vendor': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
    allowedHosts: ['kotsin.in', 'sinkot.in', 'localhost', '127.0.0.1', '15.207.173.82'],
    proxy: {
      '/api': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error(`[PROXY ERROR] ${req.url}:`, err.message)
          })
        },
      },
      // #47 fix 2026-04-26: use regex (leading ^) so /ws matches exactly /ws
      // or /ws/... but NOT /ws-audit (which is a React SPA route, not a WS
      // endpoint). Without this, /ws-audit was prefix-matched here and forwarded
      // to dashboard :8085 which returned 404 Whitelabel.
      '^/ws($|/)': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: 3001,
    host: '0.0.0.0',
    allowedHosts: ['kotsin.in', 'sinkot.in', 'localhost', '127.0.0.1', '15.207.173.82'],
    proxy: {
      '/api': {
        target: 'http://localhost:8085',
        changeOrigin: true,
      },
      // #47 fix 2026-04-26: use regex (leading ^) so /ws matches exactly /ws
      // or /ws/... but NOT /ws-audit (which is a React SPA route, not a WS
      // endpoint). Without this, /ws-audit was prefix-matched here and forwarded
      // to dashboard :8085 which returned 404 Whitelabel.
      '^/ws($|/)': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

